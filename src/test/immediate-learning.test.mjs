import { test } from "node:test";
import assert from "node:assert/strict";
import * as learning from "../memory-review.mjs";
test("immediate learning independently checks atomicity and real goal evidence before accepting a note", async () => {
  assert.equal(typeof learning.reviewImmediateObservation, "function");
  let seen;
  const rt = {
    completeSimple: async (_m, input) => {
      seen = JSON.parse(input.messages[0].content[0].text);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              supported: true,
              durable: true,
              atomic: true,
              reason: "Explicit stable owner preference",
            }),
          },
        ],
      };
    },
  };
  const proposal = {
    id: "rollback",
    title: "Rollback preference",
    body: "The owner prefers targeted rollback copies for small changes.",
  };
  const goal = {
    id: "goal-real",
    request:
      "For future work, I prefer targeted rollback copies instead of full backups for small changes.",
  };
  const result = await learning.reviewImmediateObservation(
    rt,
    { id: "independent-reviewer" },
    goal,
    [],
    proposal,
    { maintenance: { reviewTimeoutMs: 1000 } },
  );
  assert.equal(result.accepted, true);
  assert.equal(seen.request, goal.request);
  assert.equal(seen.goalId, goal.id);
  assert.equal(
    result.source,
    "Goal goal-real; explicit owner request; independent durable-knowledge review",
  );
});
test('pre-write knowledge admission explicitly separates supported preference from future storage completion',async()=>{
 const proposal={id:'utc-note',title:'Incident timestamp preference',body:'The owner prefers incident timestamps written in UTC.'};
 const runtime={completeSimple:async(_model,input)=>{const data=JSON.parse(input.messages[0].content[0].text);assert.equal(data.reviewPhase,'pre_write_knowledge_admission');assert.match(input.systemPrompt,/not.*(?:task|storage).*complet/i);return {content:[{type:'text',text:JSON.stringify({supported:true,durable:true,atomic:true,reason:'Explicit owner preference is primary evidence; note persistence is not under review.'})}]};}};
 const result=await learning.reviewImmediateObservation(runtime,{}, {id:'g',request:'For future work I prefer incident timestamps written in UTC. Remember that as one note, then verify it was stored.'},[],proposal,{maintenance:{reviewTimeoutMs:1000}});assert.equal(result.accepted,true);
});

test("immediate learning rejects filler and unsupported knowledge without storing it", async () => {
  assert.equal(typeof learning.reviewImmediateObservation, "function");
  let calls = 0;
  const rt = {
    completeSimple: async () => {
      calls++;
      return {
        content: [
          {
            type: "text",
            text: '{"supported":false,"durable":true,"atomic":true,"reason":"No evidence"}',
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      learning.reviewImmediateObservation(
        rt,
        {},
        { id: "g", request: "Hello" },
        [],
        {
          id: "filler",
          title: "Greeting",
          body: "Thanks, I will work on this.",
        },
        { maintenance: {} },
      ),
    /low.value|filler|temporary/i,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      learning.reviewImmediateObservation(
        rt,
        {},
        { id: "g", request: "What is recursion?" },
        [],
        {
          id: "made-up",
          title: "Invented server",
          body: "The server has a verified backup every minute.",
        },
        { maintenance: {} },
      ),
    /supported|evidence/i,
  );
  assert.equal(calls, 1);
});
