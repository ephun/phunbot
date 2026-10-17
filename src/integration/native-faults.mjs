import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const base = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-native-fault-"));
const data = new Map();
let mode = "outage",
  attempts = 0,
  held = [],
  chatStarted = 0;
const malformedTrace = { requests: [], responses: [] };
let malformedReplySent = false;
let invalidPlannerCalls = 0;
let informationalPlannerCalls=0, informationalMemorySeen=false;
const informationalPlannerRequests=[];
const children = [];
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
const stream = (res, text, tool = false) => {
  if (res.destroyed) return;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const common = {
    id: "chatcmpl-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fixture-chat",
  };
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "fixture-restart",
            type: "function",
            function: {
              name: "mcp__amp__amp_restart_instance",
              arguments: '{"instanceId":"controlled-target"}',
            },
          },
        ],
      }
    : { role: "assistant", content: text };
  res.write(
    "data: " +
      JSON.stringify({
        ...common,
        choices: [{ index: 0, delta, finish_reason: null }],
      }) +
      "\n\n",
  );
  res.write(
    "data: " +
      JSON.stringify({
        ...common,
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
        ],
      }) +
      "\n\n",
  );
  res.end("data: [DONE]\n\n");
};
const malformedVerifierStream = (res, toolCall, toolName = "reply", toolArguments) => {
  if (res.destroyed) return;
  const stopReason = toolCall ? "tool_calls" : "length";
  const delta = toolCall
    ? { role: "assistant", tool_calls: [{ index: 0, id: "fixture-native-reply", type: "function", function: { name: toolName, arguments: JSON.stringify(toolArguments || { kind: "answer", text: "Recursion repeatedly applies a procedure to smaller inputs until a base case stops it." }) } }] }
    : { role: "assistant", content: '{"pass":true,"reason":"partial' };
  const common = { id: "chatcmpl-native-verifier-fixture", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "fixture-chat" };
  const first = { ...common, choices: [{ index: 0, delta, finish_reason: null }] };
  const terminal = { ...common, choices: [{ index: 0, delta: {}, finish_reason: stopReason }] };
  malformedTrace.responses.push({ stopReason, chunks: [first, terminal] });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write("data: " + JSON.stringify(first) + "\n\n");
  res.write("data: " + JSON.stringify(terminal) + "\n\n");
  res.end("data: [DONE]\n\n");
};
const fixture = http.createServer(async (req, res) => {
  try {
    let body = "";
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : {};
    if (req.url === "/tasks") {
      const [v, etag] = b.args || [];
      if (b.op === "get") {
        if (!data.has(v))
          return json(res, 404, { error: "Nextcloud 404 controlled" });
        return json(res, 200, data.get(v));
      }
      if (b.op === "list") return json(res, 200, [...data.values()]);
      if (b.op === "put") {
        const old = data.get(v.id);
        if ((old && old.etag !== etag) || (!old && etag))
          return json(res, 412, { error: "Nextcloud 412 controlled" });
        const value = { ...v, etag: crypto.randomUUID() };
        data.set(v.id, value);
        return json(res, 200, value);
      }
    }
    if (req.url?.endsWith("/embeddings"))
      return json(res, 200, {
        data: b.input.map((_, index) => ({ index, embedding: [1, 0] })),
      });
    if (req.url?.endsWith("/chat/completions")) {
      attempts++;
      chatStarted++;
      if (mode === "outage")
        return json(res, 503, {
          error: {
            message: "Controlled upstream outage",
            type: "server_error",
          },
        });
      if (mode === "delay") {
        held.push(res);
        return;
      }
      const system = b.messages?.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join(' ') || '';
      if (mode === "malformed-verifier" && !system.includes('deep goal planner')) {
        malformedTrace.requests.push(b);
        const allText = (b.messages || []).map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join(" ");
        if (system.includes("independently verify a criterion from tool evidence") || allText.includes("candidateAnswer") || allText.includes("Return JSON only"))
          return malformedVerifierStream(res, false);
        if (!malformedReplySent) {
          malformedReplySent = true;
          return malformedVerifierStream(res, true);
        }
        if (allText.includes('"continue":true') || allText.includes("goal-controller")) {
          const criterion = [...data.values()].find(x => x.parent && x.verifier);
          if (criterion) return malformedVerifierStream(res, true, "goal_verify", { taskId: criterion.id, answer: "Recursion repeatedly applies a procedure to smaller inputs until a base case stops it." });
        }
        return stream(res, "The internal verifier is checking the answer; its diagnostic output is not user conversation.");
      }
      if (system.includes('deep goal planner')) {
        if(mode==='invalid-planner') {
          invalidPlannerCalls++;
          return stream(res,JSON.stringify({goal:{title:'Wrong envelope'},criteria:[],subgoals:[],action:'continue'}));
        }
        const user=b.messages.findLast(m=>m.role==='user');
        const text=typeof user?.content==='string'?user.content:user?.content?.filter(c=>c.type==='text').map(c=>c.text).join('');
        const goal=JSON.parse(text).goal;
        if(mode==='informational') {
          informationalPlannerCalls++;informationalPlannerRequests.push(system);
          if(informationalPlannerCalls===1)return stream(res,JSON.stringify({goal:{title:'Wrong envelope'},criteria:[],subgoals:[],action:'continue'}));
          if(process.env.PHUNBOT_NATIVE_DEEP_PROXY) {
            const proxy=new URL(process.env.PHUNBOT_NATIVE_DEEP_PROXY);
            assert.equal(proxy.hostname,'127.0.0.1','configured-model test bridge must be loopback only');
            const response=await fetch(proxy,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(90000)});
            assert.equal(response.ok,true,'configured deep model test bridge failed');
            const decision=await response.json();
            return stream(res,decision.text);
          }
          return stream(res,JSON.stringify({title:'Answer using known preferences',description:goal.request,criteria:[{title:'Answer from relevant memory and distinguish unknown information',verifier:{kind:'answer_quality',path:'',text:''}}],subgoals:[],changes:['Initial informational plan'],execution:'continue'}));
        }
        return stream(res,JSON.stringify({title:goal.title,description:goal.request,criteria:[{title:'Answer the controlled recursion question',verifier:{kind:['denial','authorization'].includes(mode)?'evidence_review':'answer_quality',path:'',text:''}}],subgoals:[],changes:['Controlled native deep planning'],execution:'continue'}));
      }
      if (system.includes('Independently review an actual native Pi informational answer')) return stream(res,JSON.stringify({pass:true,reason:'Controlled native reviewer checked the fixture recursion answer'}));
      if(mode==='informational') {
        informationalMemorySeen ||= JSON.stringify(b.messages).includes('The synthetic user enjoys astronomy');
        return stream(res,'Your saved preferences say you enjoy astronomy. I do not have other personal details in this controlled context, so I will not guess about your background.');
      }
      if (["denial","authorization"].includes(mode)) return stream(res, "", true);
      return stream(
        res,
        "Recursion solves a problem by applying the same procedure to smaller inputs until a base case stops it.",
      );
    }
    return json(res, 404, { error: "Unknown fixture endpoint" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const fixtureUrl = "http://127.0.0.1:" + fixture.address().port;
fs.mkdirSync(root + "/agent");
fs.mkdirSync(root + "/config");
fs.mkdirSync(root+"/config/secrets",{recursive:true});
fs.writeFileSync(root+"/config/permissions.json",JSON.stringify({ampManagement:true}));
fs.writeFileSync(root+"/config/secrets/mcp.json",JSON.stringify({amp:{env:{AMP_URL:"https://amp.fixture.invalid"}}}));
fs.writeFileSync(
  root + "/extension.mjs",
  `import fs from 'node:fs';export default function(pi){pi.registerProvider('controlled',{api:'openai-completions',baseUrl:${JSON.stringify(fixtureUrl + "/v1")},apiKey:'controlled-not-a-real-key',models:[{id:'fixture-chat',name:'Controlled fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:512}]});pi.registerTool({name:'mcp__amp__amp_restart_instance',label:'Controlled AMP mutation',description:'Controlled fixture only',parameters:{type:'object',properties:{instanceId:{type:'string'}},required:['instanceId']},execute:async()=>{fs.appendFileSync(${JSON.stringify(root + "/MUTATION_SHOULD_NOT_EXIST")},'fixture-effect\\n');return {content:[{type:'text',text:'unexpected mutation'}]};}});}`,
);
fs.writeFileSync(
  root + "/agent/settings.json",
  JSON.stringify({ extensions: [root + "/extension.mjs"] }),
);
fs.writeFileSync(
  root + "/config/policy.json",
  JSON.stringify({
    provider: "controlled",
    roles: {
      executor: "fixture-chat",
      reviewer: "fixture-chat",
      vision: "fixture-chat",
      embedding: "fixture-chat", // controlled endpoint serves embeddings too
    },
    limits: {
      sliceMs: 60000,
      maxActiveGoals: 1,
      maxOpenSessions: 4,
      maxModelTurns: 8,
      turns: 8,
      retryBackoffMs: 100,
      maxBackoffMs: 1000,
      maxOutputTokens: 512,
    },
    maintenance: { maxPairsPerRun: 0, reviewTimeoutMs: 1000 },
  }),
);
let child, url;
const launch = async () => {
  const log = fs.openSync(
    root + "/child-" + children.length + ".stderr.log",
    "w",
  );
  child = spawn(process.execPath, [base + "/native-fault-service.mjs"], {
    env: {
      ...process.env,
      VALIDATION_ROOT: root,
      PHUNBOT_ROOT: root,
      PI_CODING_AGENT_DIR: root + "/agent",
      FIXTURE_URL: fixtureUrl,
    },
    stdio: ["ignore", "pipe", log],
  });
  children.push(child);
  const ready = await Promise.race([
    new Promise((resolve, reject) => {
      createInterface({ input: child.stdout }).once("line", (line) => {
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(e);
        }
      });
      child.once("exit", (code) =>
        reject(Error("child exited before ready " + code)),
      );
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("launch deadline")), 10000),
    ),
  ]);
  url = "http://127.0.0.1:" + ready.port;
  return ready;
};
const api = async (route, body) => {
  const r = await fetch(url + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer native-fault-fixture",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const d = await r.json();
  assert.ok(r.ok, JSON.stringify(d));
  return d;
};
const wait = async (fn, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Bounded fixture deadline");
};
const cp = (gid) =>
  JSON.parse(fs.readFileSync(root + "/state/executions/" + gid + ".json"));
const report = {
  root,
  scope:
    "Actual native Pi against controlled HTTP provider and durable parent-owned Tasks fixture; real process SIGKILL/restart; no real upstream/AMP mutation or production credentials",
  checks: {},
};
report.checks.nativeMalformedVerifierKeepsUsefulReplyOpenAndBounded = false;
try {
  const first = await launch();
  report.initialPid = first.pid;
  report.health = await (await fetch(url + "/health")).json();
  const row = await api("sessions", { title: "Native provider outage" });
  const g = await api("sessions/" + row.id + "/send", {
    requestId: "native-outage",
    text: "What is recursion?",
  });
  await wait(() => cp(g.goalId).state === "transient_failure");
  report.outageBefore = {
    attempts,
    state: cp(g.goalId).state,
    nextRunAt: cp(g.goalId).nextRunAt,
    lastError: cp(g.goalId).lastError,
  };
  assert.equal(data.get(g.goalId).status, "NEEDS-ACTION");
  mode = "answer";
  await wait(async () => {
    await api("resume", {});
    return data.get(g.goalId)?.status === "COMPLETED";
  });
  report.checks.nativeProvider503BackoffAndSameGoalRecovery = true;
  report.outageGoalId = g.goalId;
  const delayed = await api("sessions", {
    title: "Delayed native cancellation",
  });
  mode = "delay";
  const before = chatStarted;
  const cancelled = await api("sessions/" + delayed.id + "/send", {
    requestId: "cancel-delay",
    text: "What is recursion?",
  });
  await wait(() => chatStarted > before);
  await api("sessions/" + delayed.id + "/cancel", { goalId: cancelled.goalId });
  assert.equal(data.get(cancelled.goalId).status, "CANCELLED");
  const killed = child;
  const exited = new Promise((r) => killed.once("exit", r));
  killed.kill("SIGKILL");
  await exited;
  for (const response of held)
    stream(
      response,
      "A stale delayed answer must not reopen the cancelled goal.",
    );
  held = [];
  mode = "answer";
  const second = await launch();
  assert.notEqual(second.pid, first.pid);
  await api("resume", {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(data.get(cancelled.goalId).status, "CANCELLED");
  report.checks.delayedNativeResponseCancellationSurvivesRealRestart = true;
  report.cancelledGoalId = cancelled.goalId;
  report.restartedPid = second.pid;
  const denied = await api("sessions", {
    title: "Unauthorized controlled mutation",
  });
  mode = "denial";
  const deniedGoal = await api("sessions/" + denied.id + "/send", {
    requestId: "deny-mutation",
    text: "Restart controlled-target.",
  });
  await wait(() =>
    cp(deniedGoal.goalId).evidence.some(
      (e) =>
        e.error &&
        (/restart_instance/.test(e.tool) || /restart_instance/.test(e.result)),
    ),
  );
  assert.equal(fs.existsSync(root + "/MUTATION_SHOULD_NOT_EXIST"), false);
  assert.notEqual(data.get(deniedGoal.goalId).status, "COMPLETED");
  await api("sessions/" + denied.id + "/cancel", { goalId: deniedGoal.goalId });
  report.checks.nativeConsequentialToolDeniedBeforeEffect = true;
  report.deniedGoalId = deniedGoal.goalId;
  mode = "malformed-verifier";
  const malformed = await api("sessions", { title: "Malformed native verifier" });
  const malformedGoal = await api("sessions/" + malformed.id + "/send", {
    requestId: "malformed-native-verifier",
    text: "What is recursion?",
  });
  await wait(() => malformedTrace.responses.some(r => r.stopReason === "length"), 30000);
  assert.ok(malformedTrace.responses.some(r => r.stopReason === "tool_calls"), "provider must first issue the native reply tool call");
  assert.ok(malformedTrace.responses.some(r => r.stopReason === "length"), "reviewer fixture must preserve the truncating stop reason");
  const reviewerRequestsBeforeWakeups = malformedTrace.requests.filter(b =>
    b.messages?.some(m => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return text.includes("independently verify a criterion from tool evidence") || text.includes("candidateAnswer") || text.includes("Return JSON only");
    }),
  ).length;
  for (let i = 0; i < 4; i++) {
    await api("resume", {});
    await new Promise(r => setTimeout(r, 100));
  }
  const reviewerRequestsAfterWakeups = malformedTrace.requests.filter(b =>
    b.messages?.some(m => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return text.includes("independently verify a criterion from tool evidence") || text.includes("candidateAnswer") || text.includes("Return JSON only");
    }),
  ).length;
  const malformedMessages = (await api("sessions/" + malformed.id + "/messages")).messages;
  const useful = malformedMessages.filter(m => JSON.stringify(m).includes("Recursion repeatedly applies a procedure"));
  const notices = malformedMessages.filter(m => m.kind === "system-notice");
  assert.equal(useful.length, 1, "native reply must be visible exactly once");
  assert.equal(notices.length, 1, "malformed verifier must produce one concise system notice");
  assert.doesNotMatch(JSON.stringify(malformedMessages), /internal verifier is checking|partial|tool_calls/);
  assert.notEqual(data.get(malformedGoal.goalId).status, "COMPLETED", "unverified answer must not fabricate acceptance");
  assert.ok(reviewerRequestsBeforeWakeups >= 1);
  assert.ok(reviewerRequestsAfterWakeups <= 3, "reviewer requests must remain bounded across resume wakeups");
  report.checks.nativeMalformedVerifierKeepsUsefulReplyOpenAndBounded = true;
  report.malformedGoalId = malformedGoal.goalId;
  report.malformedVerifier = {
    reviewerRequestsBeforeWakeups,
    reviewerRequestsAfterWakeups,
    requests: malformedTrace.requests,
    responses: malformedTrace.responses,
    visibleMessages: malformedMessages,
  };
  // Actual HTTP route and native deep planning acceptance, not a controller stub.
  mode="answer";
  const unsupported=await fetch(url+"/api/goal",{method:"POST",headers:{Authorization:"Bearer native-fault-fixture","Content-Type":"application/json"},body:JSON.stringify({request:"What is recursion?"})});
  assert.equal(unsupported.status,404);
  const acceptedAt=Date.now();
  const admissionRow=await api("sessions",{title:"API acceptance deadline"});
  const admission=await api("sessions/"+admissionRow.id+"/send",{requestId:"native-acceptance-deadline",text:"What is recursion?"});
  await wait(async()=>{
    const goals=await api("goals");const goal=goals.find(g=>g.id===admission.goalId);
    return goal?.planReady && goal.expectedChildIds?.length && goal.expectedChildIds.every(id=>goals.some(t=>t.id===id&&t.parent===goal.id));
  },60000);
  report.acceptanceMs=Date.now()-acceptedAt;
  await wait(()=>data.get(admission.goalId)?.status==="COMPLETED",30000);
  const admittedMessages=(await api("sessions/"+admissionRow.id+"/messages")).messages;
  assert.equal(admittedMessages.filter(m=>m.role==="assistant"&&JSON.stringify(m.content).includes("Recursion solves a problem")).length,1);
  report.checks.actualApiNativeAcceptedCriteriaWithin60s=true;
  // Management is configured only for the private fixture from startup.
  mode="authorization";
  const permissionRow=await api("sessions",{title:"Native conversational permission"});
  const permissionGoal=await api("sessions/"+permissionRow.id+"/send",{requestId:"permission-original",text:"Restart controlled-target."});
  await wait(()=>data.get(permissionGoal.goalId)?.authorizations?.some(a=>a.state==="pending" && a.presented?.messageId),30000);
  const proposal=data.get(permissionGoal.goalId).authorizations[0];
  const permissionMessages=(await api("sessions/"+permissionRow.id+"/messages")).messages;
  assert.ok(permissionMessages.some(m=>m.kind==="question"&&JSON.stringify(m.content).includes("controlled-target")));
  assert.ok(proposal.presented?.messageId,"exact question identity must be durably associated before approving");
  await api("sessions/"+permissionRow.id+"/send",{requestId:"permission-yes",text:"Yes"});
  await wait(()=>fs.existsSync(root+"/MUTATION_SHOULD_NOT_EXIST"),30000);
  await api("sessions/"+permissionRow.id+"/send",{requestId:"permission-yes",text:"Yes"});
  for(let i=0;i<3;i++)await api("resume",{});
  assert.equal(fs.readFileSync(root+"/MUTATION_SHOULD_NOT_EXIST","utf8").trim().split("\n").length,1);
  const receipt=data.get(permissionGoal.goalId).authorizations[0];
  assert.equal(receipt.state,"consumed");assert.equal(receipt.conversationReceipt.proposalMessageId,proposal.presented.messageId);
  await api("sessions/"+permissionRow.id+"/cancel",{goalId:permissionGoal.goalId});
  const noRow=await api("sessions",{title:"Native conversational denial"});
  const noGoal=await api("sessions/"+noRow.id+"/send",{requestId:"denial-original",text:"Restart controlled-target."});
  await wait(()=>data.get(noGoal.goalId)?.authorizations?.some(a=>a.presented?.messageId),30000);
  await api("sessions/"+noRow.id+"/send",{requestId:"permission-no",text:"No"});
  await new Promise(r=>setTimeout(r,200));
  assert.equal(data.get(noGoal.goalId).authorizations[0].state,"denied");
  assert.equal(fs.readFileSync(root+"/MUTATION_SHOULD_NOT_EXIST","utf8").trim().split("\n").length,1);
  await api("sessions/"+noRow.id+"/cancel",{goalId:noGoal.goalId});
  report.checks.nativeProposalYesOnceAndNoWithoutEffect=true;
  mode='invalid-planner';
  const invalidRow=await api('sessions',{title:'Invalid initial deep plan'});
  const invalidGoal=await api('sessions/'+invalidRow.id+'/send',{requestId:'invalid-plan-first',text:'What do you know about me?'});
  await wait(()=>invalidPlannerCalls>=2,5000);
  await new Promise(r=>setTimeout(r,200));
  assert.equal(cp(invalidGoal.goalId).state,'planner_unavailable','exhausted malformed planning must suspend, not backoff-loop');
  for(let i=0;i<4;i++){await api('resume',{});await api('sessions/'+invalidRow.id+'/resume',{goalId:invalidGoal.goalId});}
  await new Promise(r=>setTimeout(r,200));
  assert.equal(invalidPlannerCalls,2,'generic and lifecycle resume cannot repeat unchanged malformed planning');
  assert.notEqual(data.get(invalidGoal.goalId).planReady,true);
  assert.equal([...data.values()].filter(g=>g.kind==='criterion'&&g.parent===invalidGoal.goalId).length,0);
  const invalidMessages=(await api('sessions/'+invalidRow.id+'/messages')).messages;
  assert.equal(invalidMessages.filter(m=>m.kind==='system-notice').length,1);
  assert.doesNotMatch(JSON.stringify(invalidMessages),/Invalid structured planning decision|Wrong envelope/);
  report.checks.invalidInitialPlanningSuspendsAndNotifiesOnce=true;
  // A substantive new message recovers the SAME parent; native execution must
  // retrieve synthetic memory, answer, independently verify, and complete it.
  fs.mkdirSync(root+'/memory',{recursive:true});
  fs.writeFileSync(root+'/memory/synthetic-preference.md','# Synthetic preference\n\nThe synthetic user enjoys astronomy.\n');
  mode='informational';
  const recovered=await api('sessions/'+invalidRow.id+'/send',{requestId:'informational-recovery',text:'Explain remembered personal preferences.'});
  assert.equal(recovered.goalId,invalidGoal.goalId);
  await wait(()=>data.get(recovered.goalId)?.status==='COMPLETED',60000);
  assert.equal(informationalPlannerCalls,2);
  assert.notEqual(informationalPlannerRequests[0],informationalPlannerRequests[1]);
  assert.equal(informationalMemorySeen,true,'actual native execution must receive retrieved memory');
  const informationalMessages=(await api('sessions/'+invalidRow.id+'/messages')).messages;
  assert.equal(informationalMessages.filter(m=>m.role==='assistant'&&JSON.stringify(m.content).includes('enjoy astronomy')).length,1);
  assert.equal([...data.values()].filter(g=>g.kind==='goal'&&g.conversationId===invalidRow.id&&!['COMPLETED','CANCELLED'].includes(g.status)).length,0);
  const recoveredParent=data.get(recovered.goalId);
  assert.ok(recoveredParent.expectedChildIds?.length&&recoveredParent.expectedChildIds.every(id=>data.get(id)?.parent===recovered.goalId));
  report.checks.informationalAdmissionMemoryAnswerVerifiedCompletion=true;
  informationalPlannerCalls=0;informationalPlannerRequests.length=0;informationalMemorySeen=false;
  const firstQuestionRow=await api('sessions',{title:'Initial personal informational question'});
  const firstQuestion=await api('sessions/'+firstQuestionRow.id+'/send',{requestId:'initial-exact-question',text:'What do you know about me?'});
  await wait(()=>data.get(firstQuestion.goalId)?.status==='COMPLETED',60000);
  assert.equal(informationalPlannerCalls,2);
  assert.equal(informationalMemorySeen,true);
  assert.equal(data.get(firstQuestion.goalId).completionKind,'verified');
  const firstQuestionMessages=(await api('sessions/'+firstQuestionRow.id+'/messages')).messages;
  assert.equal(firstQuestionMessages.filter(m=>m.role==='assistant'&&JSON.stringify(m.content).includes('enjoy astronomy')).length,1);
  assert.equal([...data.values()].filter(g=>g.kind==='goal'&&g.conversationId===firstQuestionRow.id).length,1);
  report.checks.exactInitialQuestionAdmissionToVerifiedCompletion=true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  report.malformedVerifier = {
    requests: malformedTrace.requests,
    responses: malformedTrace.responses,
  };
  throw error;
} finally {
  for (const response of held) response.destroy();
  for (const p of children)
    if (p.exitCode === null && p.signalCode === null) {
      const end = new Promise((r) => p.once("exit", r));
      p.kill("SIGTERM");
      await Promise.race([end, new Promise((r) => setTimeout(r, 3000))]);
      if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    }
  await new Promise((r) => fixture.close(r));
  fs.writeFileSync(root + "/report.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        root,
        checks: report.checks,
        error: report.error,
      },
      null,
      2,
    ),
  );
}
