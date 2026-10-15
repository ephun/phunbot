import crypto from "node:crypto";

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const terminal = (goal) => ["COMPLETED", "CANCELLED"].includes(goal.status);
const conflict = (error) => /412|409/.test(error.message);

/** Durable admission and bounded execution leases. Nextcloud remains authoritative. */
export class GoalQueue {
  constructor(
    nc,
    { owner = crypto.randomUUID(), leaseMs = 720000, maxActive = 2 } = {},
  ) {
    this.lastAdmission = 0;
    this.nc = nc;
    this.owner = owner;
    this.leaseMs = leaseMs;
    this.maxActive = maxActive;
  }

  async optional(id) {
    try {
      return await this.nc.get(id);
    } catch (error) {
      if (/404/.test(error.message)) return null;
      throw error;
    }
  }

  async admit({ conversationId, requestId, text, model, images = [] }) {
    if (
      typeof conversationId !== "string" ||
      !conversationId ||
      typeof requestId !== "string" ||
      !requestId ||
      requestId.length > 200 ||
      typeof text !== "string" ||
      !text.trim()
    )
      throw Error("Valid conversation, request ID and text required");
    const id = digest(JSON.stringify([conversationId, requestId])).slice(0, 32);
    const requestHash = digest(JSON.stringify([text, model, images]));
    let existing = await this.optional(id);
    if (!existing) {
      try {
        existing = await this.nc.put({
          id,
          kind: "goal",
          conversationId,
          requestId,
          requestHash,
          title: text.slice(0, 150),
          request: text,
          model,
          status: "NEEDS-ACTION",
          created: new Date(
            (this.lastAdmission = Math.max(Date.now(), this.lastAdmission + 1)),
          ).toISOString(),
          execution: { state: "queued", nextRunAt: 0, lastRunAt: 0 },
        });
      } catch (error) {
        if (!conflict(error)) throw error;
        existing = await this.nc.get(id);
      }
    }
    if (existing.requestHash !== requestHash)
      throw Error(
        "Idempotency conflict: request ID already has different content",
      );
    return existing;
  }

  async claim(now = Date.now(), conversationIds) {
    // One short CAS-guarded dispatcher transaction prevents cross-goal races.
    const lockId = "phunbot-dispatch-lease";
    const oldLock = await this.optional(lockId);
    if (oldLock?.lease?.until > now) return null;
    const token = crypto.randomUUID();
    try {
      await this.nc.put(
        {
          id: lockId,
          kind: "coordination",
          title: "phunbot execution admission lease",
          status: "NEEDS-ACTION",
          lease: { token, owner: this.owner, until: now + 120000 },
        },
        oldLock?.etag,
      );
    } catch (error) {
      if (conflict(error)) return null;
      throw error;
    }
    try {
      const goals = (await this.nc.list()).filter((g) => g.kind === "goal");
      const active = goals.filter((g) => !terminal(g) && g.lease?.until > now);
      if (active.length >= this.maxActive) return null;
      const busyConversations = new Set(active.map((g) => g.conversationId));
      const ready = goals.filter(
        (g) =>
          !terminal(g) &&
          g.conversationId &&
          (!conversationIds || conversationIds.has(g.conversationId)) &&
          !busyConversations.has(g.conversationId) &&
          (!g.lease || g.lease.until <= now) &&
          (!g.blocker ||
            (g.blocker.kind === "dependency" &&
              now - Date.parse(g.blocker.lastProbeAt || g.blocker.at) >=
                300000)) &&
          (g.execution?.nextRunAt || 0) <= now,
      );
      ready.sort(
        (a, b) =>
          (a.execution?.lastRunAt || 0) - (b.execution?.lastRunAt || 0) ||
          a.created.localeCompare(b.created) ||
          a.id.localeCompare(b.id),
      );
      const goal = ready[0];
      if (!goal) return null;
      return await this.nc.put(
        {
          ...goal,
          execution: { ...goal.execution, state: "running", lastRunAt: now },
          lease: {
            token: crypto.randomUUID(),
            owner: this.owner,
            until: now + this.leaseMs,
          },
        },
        goal.etag,
      );
    } finally {
      const lock = await this.nc.get(lockId);
      if (lock.lease?.token === token)
        await this.nc.put(
          { ...lock, lease: { ...lock.lease, until: 0 } },
          lock.etag,
        );
    }
  }

  async valid(id, token, now = Date.now()) {
    const goal = await this.nc.get(id);
    return (
      !terminal(goal) && goal.lease?.token === token && goal.lease.until > now
    );
  }

  async release(id, token, execution, now = Date.now()) {
    const goal = await this.nc.get(id);
    if (terminal(goal) || goal.lease?.token !== token) return goal;
    return this.nc.put(
      {
        ...goal,
        lease: null,
        execution: { ...goal.execution, ...execution, endedAt: now },
      },
      goal.etag,
    );
  }
}
