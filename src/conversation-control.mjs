import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {GoalQueue} from "./goal-queue.mjs";

const CONTROL = new Map([
  ["pause", { kind: "lifecycle", action: "pause" }],
  ["continue", { kind: "lifecycle", action: "resume" }],
  ["resume", { kind: "lifecycle", action: "resume" }],
  ["cancel this", { kind: "lifecycle", action: "cancel" }],
  ["we're done", { kind: "lifecycle", action: "complete" }],
  ["we’re done", { kind: "lifecycle", action: "complete" }],
]);
const YES = /^yes(?:\s+([A-Za-z0-9_-]+))?$/i;
const NO = /^no(?:\s+([A-Za-z0-9_-]+))?$/i;

export function parseConversationTurn(text) {
  if (typeof text !== "string") return null;
  const normalized = text.trim().replace(/[.!]+$/g, "").trim();
  const exact = CONTROL.get(normalized.toLowerCase());
  if (exact) return { ...exact };
  if (/^(?:yes|yes please|yep|yeah|sure|approve|approved|go ahead|proceed|do it)$/i.test(normalized))
    return {kind:"approval",approve:true,pendingId:null};
  if (/^(?:no|no thanks|no thank you|nope|deny|do not|don't)$/i.test(normalized))
    return {kind:"approval",approve:false,pendingId:null};
  const yes = normalized.match(YES);
  if (yes) return { kind: "approval", approve: true, pendingId: yes[1] || null };
  const no = text.trim().match(NO);
  if (no) return { kind: "approval", approve: false, pendingId: no[1] || null };
  return null;
}

function validIdentity(input) {
  return input?.authenticated === true && input?.principal === "authenticated-owner" &&
    typeof input.conversationId === "string" && typeof input.requestId === "string" &&
    input.requestId.length > 0 && input.requestId.length <= 200;
}
function receiptKey(input, parsed) {
  return { requestId: input.requestId, goalId:input.goalId, conversationId: input.conversationId, kind: parsed.kind,
    action: parsed.action, approve: parsed.approve, pendingId: parsed.pendingId || null };
}
function sameReceipt(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function goalSummary(goal) { return {id:goal.id,revision:goal.revision,status:goal.status,paused:goal.paused,execution:goal.execution}; }

export class ConversationControl {
  constructor({ root, nc, lifecycle, permissions, publish, now = () => Date.now() } = {}) {
    this.root = root; this.nc = nc; this.lifecycle = lifecycle; this.permissions = permissions; this.publish = publish; this.now = now;
    this.file = root && path.join(root, "state", "conversation-control-receipts.json");
    this.receipts = new Map();
    if (this.file && fs.existsSync(this.file)) {
      try { for (const r of JSON.parse(fs.readFileSync(this.file, "utf8"))) this.receipts.set(r.key?.requestId || r.requestId, r); } catch {}
    }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${crypto.randomUUID()}`;
    fs.writeFileSync(tmp, JSON.stringify([...this.receipts.values()]), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  async handle(input) {
    if (!validIdentity(input)) throw Error("Authenticated conversation identity required");
    const parsed = parseConversationTurn(input.text);
    if (!parsed) return { kind: "ordinary" };
    return new GoalQueue(this.nc).withConversationAdmissionLock(input.conversationId, admission => this.handleLocked(input, parsed, admission));
  }
  async handleLocked(input, parsed, admission) {
    // Both ordinary admission and controls use this same conversation CAS lock.
    const all=(await this.nc.list()).filter(g=>g.kind==="goal" && g.conversationId===input.conversationId);
    for(const g of all) {
      if ((g.requestReceipts || []).some(r=>r.requestId===input.requestId) || g.requestId===input.requestId)
        throw Error("Request ID already belongs to a goal request");
      if(g.id!==input.goalId && (g.controlReceipts || []).some(r=>(r.requestId || r.key?.requestId)===input.requestId))
        throw Error("Request ID already controls a different goal");
    }
    const prior = this.receipts.get(input.requestId);
    const key = receiptKey(input, parsed);
    if (prior) {
      if (!sameReceipt(prior.key, key)) throw Error("Request ID already controls a different operation");
      return { ...prior.result, replayed: true };
    }
    let goal, reservation;
    const reservationToken = crypto.randomUUID();
    for (let attempt=0; attempt<50; attempt++) {
      goal = await this.nc.get(input.goalId);
      if (!goal || goal.conversationId !== input.conversationId) throw Error("Wrong conversation");
      const authoritative = (goal.controlReceipts || []).find(r => (r.requestId || r.key?.requestId) === input.requestId);
      if (authoritative) {
        if (!sameReceipt(authoritative.key, key)) throw Error("Request ID already controls a different operation");
        if (authoritative.result) {
          this.receipts.set(input.requestId, authoritative);
          return { ...authoritative.result, goal: goalSummary(goal), replayed: true };
        }
        if (authoritative.phase === "dispatching")
          throw Object.assign(Error("Control dispatch outcome is uncertain; reconcile it before submitting a new operation"),{statusCode:409});
        if (authoritative.reservedUntil > this.now()) {
          await new Promise(resolve=>setTimeout(resolve,20));
          continue;
        }
      }
      if ((goal.requestReceipts || []).some(r=>r.requestId===input.requestId))
        throw Error("Request ID already belongs to a goal request");
      reservation = {requestId:input.requestId,key,token:reservationToken,reservedUntil:this.now()+120000};
      try {
        goal = await this.nc.put({...goal,controlReceipts:[...(goal.controlReceipts || []).filter(r=>(r.requestId || r.key?.requestId)!==input.requestId),reservation]},goal.etag);
        break;
      } catch(error) { if(!/409|412/.test(error.message))throw error; }
    }
    if (!goal?.controlReceipts?.some(r=>r.token===reservationToken))
      throw Object.assign(Error("This control request is still being processed; retry with the same request ID"),{statusCode:409});
    // Irreversible at-most-once dispatch fence. Expired reservations can be
    // reclaimed only BEFORE this CAS, never after an uncertain side effect.
    await admission.assertCurrent();
    const current=await this.nc.get(input.goalId);
    const owned=(current.controlReceipts || []).find(r=>r.token===reservationToken);
    if(!owned || owned.reservedUntil<=this.now()) throw Error("Control reservation expired before dispatch");
    goal=await this.nc.put({...current,controlReceipts:current.controlReceipts.map(r=>r.token===reservationToken?{...r,phase:"dispatching"}:r)},current.etag);
    let result;
    if (parsed.kind === "lifecycle") {
      const updated = await this.lifecycle(input.goalId, parsed.action);
      result = { kind: "ack", content: parsed.action === "pause" ? "Paused." : parsed.action === "resume" ? "Continuing." : parsed.action === "cancel" ? "Cancelled." : "Marked done.", goal: updated };
    } else {
      const revision = goal.revision || 1;
      const pending = (goal.authorizations || []).filter(x => x.state === "pending" && x.goalRevision === revision && x.conversationId === input.conversationId);
      if (!pending.length) result = { kind: "question", content: "There is no current pending permission request." };
      else if (!parsed.pendingId && pending.length !== 1) result = { kind: "question", content: "Which pending request should I use? " + pending.map(x => x.id).join(", ") };
      else {
        const item = pending.find(x => x.id === (parsed.pendingId || pending[0].id));
        if (!item) result = { kind: "question", content: "That pending request is not current. Choose one of: " + pending.map(x => x.id).join(", ") };
        else if (parsed.approve && !item.presented?.messageId) {
          result = {kind:"question",pendingId:item.id,content:this.permissions.question(item)};
        } else {
          const decided = await this.permissions.decideConversation(input.goalId, item.id, parsed.approve, {
            authenticated: true, principal: "authenticated-owner", conversationId: input.conversationId,
            requestId: input.requestId, text: parsed.approve ? "Yes" : "No", sourceText: input.text,
          });
          result = { kind: "ack", content: parsed.approve ? "Approved." : "Denied. I will use a safer alternative or stop.", goal: decided };
        }
      }
    }
    const durable = { requestId:input.requestId, key, result:{kind:result.kind,content:result.content,...(result.pendingId?{pendingId:result.pendingId}:{})}, recordedAt: new Date(this.now()).toISOString() };
    let stored = false;
    for (let attempt=0;attempt<5;attempt++) {
      const latest = await this.nc.get(input.goalId);
      const existing = (latest.controlReceipts || []).find(r => (r.requestId || r.key?.requestId) === input.requestId);
      if (!existing || !sameReceipt(existing.key,key) || (existing.token && existing.token !== reservationToken))
        throw Error("Control request reservation changed");
      try {
        const saved=await this.nc.put({...latest,controlReceipts:(latest.controlReceipts || []).map(r=>(r.requestId || r.key?.requestId)===input.requestId?durable:r)},latest.etag);
        if(!saved.controlReceipts?.some(r=>r.requestId===input.requestId && r.result))throw Error("Control receipt readback failed");
        stored=true; break;
      } catch(error) {if(!/409|412/.test(error.message))throw error;}
    }
    if(!stored)throw Error("Control receipt publication deferred; retry with the same request ID");
    this.receipts.set(input.requestId, durable); this.save();
    return {...result,...(result.goal?{goal:goalSummary(result.goal)}:{})};
  }
}
