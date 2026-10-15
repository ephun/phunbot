import crypto from "node:crypto";
import fs from "node:fs";
import { operation, scopeMatches, operationRegistry } from "./operations.mjs";
import {
  OwnerAuthority,
  effectHash,
  secureAmpTransport,
} from "./owner-authority.mjs";

const unraidReads = {
  system: new Set([
    "overview",
    "array",
    "network",
    "metrics",
    "network_metrics",
    "services",
    "online",
    "server",
    "server_time",
    "timezones",
    "network_interfaces",
  ]),
  disk: new Set(["shares", "disks", "disk_details", "log_files", "logs"]),
  vm: new Set(["list"]),
  health: new Set(["test_connection"]),
  help: new Set([""]),
};
const native = new Set([
  "read",
  "write",
  "edit",
  "tool_search",
  "goal_plan",
  "memory_observe",
  "goal_state",
  "goal_verify",
  "goal_blocker",
  "goal_unblock",
]);
const phunbot = new Set([
  "memory_search",
  "memory_read",
  "memory_link",
  "nextcloud_goals",
  "n8n_workflows",
  "web_fetch",
  "service_probe",
]);

export function classify(name, args = {}) {
  if (
    [
      "read_mcp_resource",
      "list_mcp_resources",
      "list_mcp_resource_templates",
    ].includes(name)
  )
    return {
      mode: "deny",
      reason:
        "Infrastructure resource passthrough is not enabled; use scoped typed tools.",
    };
  if (!name.startsWith("mcp__"))
    return {
      mode: native.has(name) ? "read" : "deny",
      reason: "Unknown native capability is not authorized",
    };
  if (name.startsWith("mcp__phunbot__"))
    return {
      mode: phunbot.has(name.slice("mcp__phunbot__".length)) ? "read" : "deny",
      reason: "Unregistered capability is not authorized",
    };
  if (name.startsWith("mcp__amp__")) {
    const op = operation(name, args);
    return {
      mode:
        op.risk === "routine"
          ? "read"
          : op.risk === "denied"
            ? "deny"
            : "approval",
      operation: op,
      reason: op.reason,
    };
  }
  if (name === "mcp__unraid__unraid") {
    if (args.action === "docker")
      return {
        mode: "deny",
        reason:
          "Docker administration remains operator-only; no raw control-plane passthrough.",
      };
    if (
      ["key", "oidc", "connect", "onboarding"].includes(args.action) ||
      (args.action === "setting" && args.subaction === "update_ssh")
    )
      return {
        mode: "deny",
        reason:
          "Credential, authentication, SSH and public-ingress changes require an independent operator.",
      };
    if (unraidReads[args.action]?.has(args.subaction || ""))
      return { mode: "read" };
    return {
      mode: "approval",
      operation: {
        name,
        args,
        risk: "sensitive",
        effect: "Host-level administrative operation",
      },
    };
  }
  return { mode: "deny", reason: "Unregistered capability is not authorized" };
}

export function capabilityInventory(registered) {
  return registered.map((tool) => {
    const op = tool.name.startsWith("mcp__amp__")
      ? operationRegistry[tool.name.slice("mcp__amp__".length)]
      : null;
    let authorization;
    if (tool.name === "bash") authorization = "denied";
    else if (op)
      authorization =
        op.risk === "routine" ? "scoped_routine" : "independent_owner";
    else {
      const permission = classify(tool.name);
      authorization =
        permission.mode === "deny"
          ? "denied"
          : permission.mode === "approval"
            ? "independent_owner"
            : "scoped_routine";
    }
    return {
      name: tool.name,
      description: tool.description || "",
      registered: true,
      authorization,
      ...(op ? { risk: op.risk, effect: op.effect } : {}),
      constraints:
        op && op.risk !== "routine"
          ? "Current management policy, secure transport, exact instance scope and independent signed approval are required. Each call is rechecked."
          : "Runtime argument, cancellation and path restrictions still apply; registration is not blanket authorization.",
    };
  });
}
export class Permissions {
  constructor(nc, controller, { root, policy = {} } = {}) {
    this.nc = nc;
    this.controller = controller;
    this.root = root;
    this.policy = policy;
    this.owner = root ? new OwnerAuthority(root) : null;
    this.locks = new Map();
  }
  async lock(id, fn) {
    if (this.controller.lock) return this.controller.lock(id, fn);
    const prior = this.locks.get(id) || Promise.resolve();
    const job = prior.catch(() => {}).then(fn);
    this.locks.set(id, job);
    try {
      return await job;
    } finally {
      if (this.locks.get(id) === job) this.locks.delete(id);
    }
  }
  scopes() {
    if (!this.root || !this.owner?.available()) return [];
    const file = this.root + "/config/owner-scopes.json";
    if (!fs.existsSync(file)) return [];
    const scopes = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(scopes))
      throw Error("Invalid owner scope configuration");
    return scopes.filter(
      (scope) => this.owner.verify(scope) && scope.kind === "scope",
    );
  }
  async check(name, args, goalId) {
    const policy = classify(name, args),
      op = policy.operation;
    const configuration =
      this.root && fs.existsSync(this.root + "/config/permissions.json")
        ? JSON.parse(
            fs.readFileSync(this.root + "/config/permissions.json", "utf8"),
          )
        : this.policy;
    if (name.startsWith("mcp__amp__") && policy.mode === "approval") {
      let transport = false;
      try {
        transport = secureAmpTransport(
          JSON.parse(
            fs.readFileSync(this.root + "/config/secrets/mcp.json", "utf8"),
          ).amp?.env?.AMP_URL,
        );
      } catch {
        /* Missing/malformed transport configuration fails closed. */
      }
      if (
        configuration.ampManagement !== true ||
        !this.owner?.available() ||
        !transport
      )
        return {
          allowed: false,
          reason:
            "AMP management requires current explicit policy, independent owner authority and secure transport",
        };
    }
    if (
      name.startsWith("mcp__amp__") &&
      configuration.ampInstances !== undefined &&
      (!Array.isArray(configuration.ampInstances) ||
        configuration.ampInstances.some(
          (instance) => typeof instance !== "string" || !instance.trim(),
        ))
    )
      return {
        allowed: false,
        reason: "AMP instance scope configuration is invalid; refusing the operation",
      };
    if (
      op?.instanceId &&
      Array.isArray(configuration.ampInstances) &&
      !configuration.ampInstances.includes(op.instanceId)
    )
      return {
        allowed: false,
        reason: "This AMP instance is outside the configured operational scope",
      };
    if (policy.mode === "read") return { allowed: true, operation: op };
    if (policy.mode === "deny") {
      if (goalId)
        this.controller.record(
          goalId,
          name,
          args,
          { policy: "safety_denial", reason: policy.reason },
          true,
        );
      return { allowed: false, reason: "Safety: " + policy.reason };
    }
    if (!goalId)
      return {
        allowed: false,
        reason: "Authorization requires an active Nextcloud goal",
      };
    return this.lock(goalId, async () => {
      const goal = await this.nc.get(goalId);
      if (goal.status !== "NEEDS-ACTION")
        return { allowed: false, reason: "Goal is not open" };
      if (name.endsWith("amp_take_backup") && !/\bbackup\b/i.test(goal.request))
        return {
          allowed: false,
          reason:
            "Full AMP backups require an explicit backup request; use a targeted reversible alternative",
        };
      const hash = effectHash(name, args),
        items = goal.authorizations || [];
      if (items.some((item) => item.hash === hash && item.state === "denied"))
        return {
          allowed: false,
          reason: "Owner explicitly denied this exact operation",
        };
      const scope = this.scopes().find((scope) => scopeMatches(scope, op));
      if (scope) {
        await this.controller.assertExecution?.(goalId);
        this.controller.record(
          goalId,
          "owner_scope_used",
          { tool: name, instanceId: op.instanceId },
          { scopeId: scope.id, operationHash: hash },
          false,
        );
        return { allowed: true, authorizationId: scope.id, operation: op };
      }
      const approved = items.find(
        (item) =>
          item.hash === hash &&
          item.state === "approved" &&
          item.ownerProof?.kind === "exact" &&
          item.ownerProof?.risk === op.risk &&
          (op.risk !== "sensitive" ||
            item.ownerProof?.acknowledgedSensitive === true) &&
          item.ownerProof?.goalId === goalId &&
          item.ownerProof?.requestId === item.id &&
          item.ownerProof?.hash === hash &&
          this.owner?.verify(item.ownerProof),
      );
      if (approved) {
        await this.controller.assertExecution?.(goalId);
        approved.state = "consumed";
        approved.consumedAt = new Date().toISOString();
        const readback = await this.nc.put(
          { ...goal, authorizations: items },
          goal.etag,
        );
        if (
          !readback.authorizations?.some(
            (item) => item.id === approved.id && item.state === "consumed",
          )
        )
          throw Error("Approval consumption readback failed");
        return { allowed: true, authorizationId: approved.id, operation: op };
      }
      let pending = items.find(
        (item) => item.hash === hash && item.state === "pending",
      );
      if (!pending) {
        if (items.filter((item) => item.state === "pending").length >= 5)
          return {
            allowed: false,
            reason: "Authorization queue is full; reconsider the strategy",
          };
        pending = {
          id: crypto.randomUUID(),
          tool: name,
          args,
          hash,
          risk: op?.risk || "sensitive",
          effect: op?.effect,
          state: "pending",
          requestedAt: new Date().toISOString(),
        };
        items.push(pending);
        await this.controller.assertExecution?.(goalId);
        await this.nc.put({ ...goal, authorizations: items }, goal.etag);
      }
      this.controller.record(
        goalId,
        name,
        args,
        {
          policy: "owner_authorization",
          requestId: pending.id,
          reason: "Independent signed owner authorization required",
        },
        true,
      );
      return {
        allowed: false,
        requestId: pending.id,
        reason:
          "Independent owner authorization required for exact operation " +
          pending.id +
          ". Inspect it in the browser; approve through the local owner CLI, never the ordinary chat bearer. Continue safe diagnostics or preserve the pending goal.",
      };
    });
  }
  async decide(goalId, requestId, approve, proof) {
    return this.lock(goalId, async () => {
      const goal = await this.nc.get(goalId);
      if (goal.status !== "NEEDS-ACTION") throw Error("Goal is not open");
      const items = goal.authorizations || [],
        item = items.find((item) => item.id === requestId);
      if (!item || item.state !== "pending")
        throw Error("Authorization request is not pending");
      if (
        approve &&
        (!this.owner?.verify(proof) ||
          proof.kind !== "exact" ||
          proof.goalId !== goalId ||
          proof.requestId !== requestId ||
          proof.hash !== item.hash ||
          (item.risk === "sensitive" && proof.acknowledgedSensitive !== true))
      )
        throw Error(
          "Independent signed owner approval required; ordinary browser/chat authorization is insufficient",
        );
      item.state = approve ? "approved" : "denied";
      if (approve) {
        item.approvedAt = new Date().toISOString();
        item.ownerProof = proof;
      }
      const updated = { ...goal, authorizations: items };
      if (goal.blocker?.kind === "authorization") delete updated.blocker;
      const readback = await this.nc.put(updated, goal.etag);
      if (
        !readback.authorizations?.some(
          (entry) => entry.id === requestId && entry.state === item.state,
        )
      )
        throw Error("Owner decision readback failed");
      return readback;
    });
  }
}
