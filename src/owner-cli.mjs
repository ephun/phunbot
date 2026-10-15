import path from "node:path";
import { fileURLToPath } from "node:url";
import { Nextcloud } from "./nextcloud.mjs";
import { Permissions, classify } from "./permissions.mjs";
import { OwnerAuthority, effectHash } from "./owner-authority.mjs";

// Run locally as the owner. This command never accepts a chat bearer or returns key material.
export async function runOwnerCommand(root, argv, { ncClient } = {}) {
  const [command, goalId, requestId, ...flags] = argv;
  if (!["init", "pending", "approve", "deny"].includes(command)) {
    throw Error(
      "Usage: owner-cli.mjs init | pending | approve GOAL REQUEST [--ack-sensitive] | deny GOAL REQUEST",
    );
  }
  const owner = new OwnerAuthority(root);
  if (command === "init") {
    if (argv.length !== 1) throw Error("init takes no arguments");
    return owner.initialize();
  }
  const nc = ncClient || new Nextcloud(root);
  if (command === "pending") {
    if (argv.length !== 1) throw Error("pending takes no arguments");
    return (await nc.list())
      .filter((g) => g.kind === "goal" && g.status === "NEEDS-ACTION")
      .flatMap((g) =>
        (g.authorizations || [])
          .filter((a) => a.state === "pending")
          .map((a) => ({ goalId: g.id, ...a })),
      );
  }
  if (!goalId || !requestId || flags.some((flag) => flag !== "--ack-sensitive"))
    throw Error("Exact goal and request IDs and known flags required");
  const goal = await nc.get(goalId);
  const item = goal.authorizations?.find(
    (a) => a.id === requestId && a.state === "pending",
  );
  if (!item) throw Error("Authorization request is not pending");
  let proof;
  if (command === "approve") {
    const permission = classify(item.tool, item.args);
    const risk = permission.operation?.risk;
    if (
      permission.mode !== "approval" ||
      risk !== item.risk ||
      effectHash(item.tool, item.args) !== item.hash
    ) {
      throw Error(
        "Pending operation identity or risk does not match current policy",
      );
    }
    if (risk === "sensitive" && !flags.includes("--ack-sensitive"))
      throw Error(
        "Sensitive operation requires explicit --ack-sensitive acknowledgement",
      );
    proof = owner.sign({
      kind: "exact",
      goalId,
      requestId,
      hash: item.hash,
      risk,
      expiresAt: Date.now() + 10 * 60 * 1000,
      ...(risk === "sensitive" ? { acknowledgedSensitive: true } : {}),
    });
  }
  const permissions = new Permissions(nc, {}, { root });
  const readback = await permissions.decide(
    goalId,
    requestId,
    command === "approve",
    proof,
  );
  const updated = readback.authorizations.find((a) => a.id === requestId);
  return {
    goalId,
    requestId,
    tool: updated.tool,
    risk: updated.risk,
    state: updated.state,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runOwnerCommand(
      process.env.PHUNBOT_ROOT || "/data",
      process.argv.slice(2),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
