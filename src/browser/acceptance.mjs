// Browser presentation acceptance uses real HTTP/Pi history and a controlled UI fixture.
// It is not provider, Nextcloud, AMP, or production acceptance.
import {
  chromium
} from "playwright";
import {
  SessionManager
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  start
} from "../app.mjs";
import { appendConversationOutput } from "../conversation-output.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "phunbot-browser-"));
const output =
  process.env.PHUNBOT_BROWSER_OUTPUT ||
  path.join(os.tmpdir(), "phunbot-browser-artifacts");
fs.mkdirSync(output, {
  recursive: true
});
fs.mkdirSync(root + "/config");
fs.mkdirSync(root + "/state");
fs.writeFileSync(
  root + "/config/policy.json",
  JSON.stringify({
    roles: {
      executor: "fleet-fast",
      reviewer: "fleet-deep",
      vision: "fleet-vision",
    },
    limits: {
      maxActiveGoals: 1
    },
  }),
);
const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
fs.writeFileSync(
  root + "/state/conversations.json",
  JSON.stringify(
    ids.map((id, i) => ({
      id,
      title: ["A clear answer", "Research notes", "Validation fixture"][i],
      folder: ["Conversations", "Research", "Validation"][i],
      model: "fleet-fast",
      execution: "idle",
    })),
  ),
);
const managers = new Map();
for (const id of ids) {
  const manager = SessionManager.inMemory();
  manager.appendMessage({
    role: "user",
    timestamp: 1000,
    content: [{
      type: "text",
      text: "Explain recursion with an example."
    }],
  });
  appendConversationOutput(manager, "answer", "## A clear answer\n\nRecursion solves **smaller instances** of the same problem.\n\n| Part | Purpose |\n|---|---|\n| Base case | Stop |\n| Recursive step | Reduce |\n\n```javascript\nconst answer = 42;\n```\n\n[Reference](https://example.org)\n<script>window.PHUNBOT_UNSAFE=1</script>");
  manager.appendCustomMessageEntry("goal-controller", "Internal controller state — inspect only", true);
  manager.appendMessage({
    role: "toolResult",
    timestamp: 3000,
    toolCallId: "fixture-tool",
    toolName: "fixture_read",
    content: [{
      type: "text",
      text: '{"fixture":true,"result":"readback"}'
    }],
    isError: false,
  });
  managers.set(id, manager);
}
const nc = {
  data: new Map(),
  async get(id) {
    if (!this.data.has(id)) throw Error("Nextcloud 404");
    return structuredClone(this.data.get(id));
  },
  async list() {
    return [...this.data.values()].map((x) => structuredClone(x));
  },
  async put(value) {
    this.data.set(value.id, structuredClone(value));
    return structuredClone(value);
  },
};
nc.data.set("browser-goal", {
  id: "browser-goal",
  kind: "goal",
  conversationId: ids[0],
  title: "Controlled pending operation",
  description: "Inspect the exact controlled pending operation before an independent owner decision.",
  status: "NEEDS-ACTION",
  planRevisions: [{revision:1,previousDescription:'Historical controlled plan',criteria:[{id:'historical-criterion',title:'Historical readback',disposition:'superseded',accepted:true,verifier:{kind:'evidence_review'},evidence:{verificationId:'historical-receipt',evidenceIds:['historical-observation'],reason:'Independent historical readback'}}]}],
  blocker: {
    kind: "information",
    reason: "Waiting for your response in this conversation.",
  },
});
nc.data.set("provisional-criterion", {
  id: "provisional-criterion",
  kind: "criterion",
  parent: "browser-goal",
  title: "Provisional readback awaits parent acceptance",
  status: "COMPLETED",
  evidence: {
    verifiedAt: new Date().toISOString(),
    verificationId: "unaccepted-fixture",
  },
});
const server = await start({
  root,
  token: "browser-fixture",
  port: 0,
  ncClient: nc,
  planner: async (_runtime,_policy,goal) => ({title:goal.title,description:goal.request,criteria:[{title:"Controlled browser fixture response",verifier:{kind:"evidence_review"}}],subgoals:[],changes:["Controlled browser plan"],execution:"continue"}),
  sessionFactory: async (row, {
    controller: c
  }) => {
    const manager = managers.get(row.id) || SessionManager.inMemory();
    managers.set(row.id, manager);
    const runtime = {
      busy: false,
      session: {
        sessionManager: manager,
        modelRuntime: {
          getAvailable: async () => ["fleet-fast", "fleet-deep", "fleet-vision"].map((id) => ({
            id,
            input: ["text"],
          })),
          getModel: (_provider, id) => ({
            id,
            input: ["text"]
          }),
        },
        setModel: async () => {},
        abort: async () => {},
        sendCustomMessage: async (message, {
          triggerTurn = false
        } = {}) => {
          manager.appendCustomMessageEntry(
            message.customType,
            message.content,
            message.display,
          );
          if (triggerTurn) await managers.get(row.id).phunbotFixturePrompt();
        },
        dispose() {},
        prompt: async (text, {
          images = []
        } = {}) => {
          manager.appendMessage({
            role: "user",
            timestamp: Date.now(),
            content: [{
              type: "text",
              text
            }, ...images],
          });
          const goal = await nc.get(row.goalId);
          if (!goal.planReady)
            await c.plan(goal.id, [{
              title: "Controlled browser fixture response",
              verifier: {
                kind: "evidence_review"
              },
            }, ]);
          const response =
            "Controlled browser fixture response. This is not a provider or live service result.";
          manager.appendMessage({
            role: "assistant",
            timestamp: Date.now(),
            content: [{
              type: "text",
              text: response
            }],
          });
          const event = c.record(
            goal.id,
            "controlled_browser_fixture", {}, {
              synthetic: true
            },
          );
          const planned = await nc.get(goal.id);
          await c.verify(goal.id, planned.expectedChildIds[0], async () => ({
            pass: true,
            reason: "Controlled presentation fixture emitted its response",
            evidenceIds: [event.id],
          }));
        },
      },
    };
    manager.phunbotFixturePrompt = () => runtime.session.prompt("Controlled request delivered through canonical Pi history");
    return runtime;
  },
});
let browser, page;
const errors = [];
const checks = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    executablePath: process.env.PHUNBOT_CHROMIUM || undefined,
  });
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.locator("#token").fill("browser-fixture");
  await page.locator("#login-form").evaluate(form => form.requestSubmit());
  await page.locator(".message.assistant h2").waitFor();
  assert.equal(await page.locator('.message.assistant').evaluateAll(nodes => nodes.every(n => n.textContent.trim())), true);
  assert.equal(await page.locator('.copy-message').count(), await page.locator('.message.assistant').count());
  checks.push('No empty assistant bubbles or orphan copy controls desktop');
  assert.equal(await page.locator(".message.assistant table").count(), 1);
  checks.push("Markdown heading and table");
  assert.match(await page.locator(".message.assistant pre code").innerText(), /const answer = 42/);
  checks.push("Code fence");
  await page.getByRole("button", {
    name: "Copy message",
    exact: true
  }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Recursion/);
  checks.push("Message copy");
  await page.getByRole("button", {
    name: "Copy code",
    exact: true
  }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /const answer = 42/);
  checks.push("Code copy");
  assert.equal(await page.evaluate(() => window.PHUNBOT_UNSAFE), undefined);
  checks.push("Sanitized Markdown");
  assert.equal(await page.locator(".message.assistant").evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  checks.push("Unboxed assistant text");
  const research = page.locator('.folder-row').filter({
    hasText: 'Research'
  });
  await research.locator('.folder').click();
  assert.equal(await page.locator('.chatlink').filter({
    hasText: 'Research notes'
  }).count(), 0);
  await page.screenshot({
    path: output + '/desktop-collapsed.png',
    fullPage: true
  });
  await research.locator('.folder').click();
  checks.push('Collapsible folders');
  assert.equal(await page.locator('.chatlink').filter({
    hasText: 'Validation fixture'
  }).count(), 0);
  checks.push('Validation history hidden by default');
  assert.equal(await page.locator('#messages').getByText('Internal controller state', {
    exact: false
  }).count(), 0);
  checks.push('Internal controller state stays out of normal conversation history');
  const responses = ['Renamed conversation', 'Research'];
  const respond = dialog => dialog.accept(responses.shift());
  page.on('dialog', respond);
  await page.locator('#organize').click();
  await page.waitForFunction(() => document.querySelector('#viewtitle').textContent === 'Renamed conversation');
  page.off('dialog', respond);
  checks.push('Rename and folder movement');
  await page.locator('#goalsnav').click();
  await page.locator('.goalrow').filter({
    hasText: 'Controlled pending operation'
  }).click();
  assert.equal(await page.locator('.authorization').count(), 0);
  assert.match(await page.locator('.wait-strip').innerText(), /Waiting for your response/);
  assert.equal(await page.locator('.wait-strip button').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Deny', exact: true }).count(), 0);
  checks.push('No authorization controls; waiting chat link and lifecycle controls remain');
  assert.match(await page.locator('#goalcontent').innerText(), /Not yet accepted/);
  assert.equal(await page.locator('.child .goal-icon.completed').count(), 0);
  assert.equal(await page.locator('.authorization').count(), 0);
  checks.push('Current criterion status remains unaccepted and no historical authorization panel leaks');
  await page.screenshot({
    path: output + '/progress.png',
    fullPage: true
  });
  checks.push('Waiting progress inspection');
  await page.locator('#goalmeta button').click();
  await page.locator('.message.assistant h2').waitFor();
  await page.screenshot({
    path: output + '/desktop.png',
    fullPage: true
  });
  await page.reload();
  await page.locator('.message.assistant h2').waitFor();
  checks.push('Canonical history after reload');
  page.once('dialog', dialog => dialog.accept('Empty folder'));
  await page.locator('#new-folder').click();
  await page.locator('.folder-row').filter({hasText:'Empty folder'}).locator('xpath=following-sibling::div[1]').getByText('No conversations yet', {
    exact: true
  }).waitFor();
  checks.push('Empty folder creation');
  await page.locator('#goalsnav').click();
  await page.locator('.goalrow').filter({
    hasText: 'Controlled pending operation'
  }).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
  assert.equal(nc.data.get('browser-goal').paused,true);
  checks.push('Pause persists and exposes the retained Resume button');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {
    name: 'Cancel',
    exact: true
  }).click();
  await page.locator('#goalmeta').getByText('Cancelled', {
    exact: true
  }).waitFor();
  checks.push('Exact goal cancellation');
  await page.locator('#goalmeta button').click();
  await page.locator('.message.assistant h2').waitFor();
  const modelChanged = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/sessions/' + ids[0]));
  await page.locator('#model').selectOption('fleet-vision');
  await modelChanged;
  const image = {
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64')
  };
  await page.locator('#attachment-input').setInputFiles(image);
  await page.locator('#attachments').getByText('fixture.png', {
    exact: true
  }).waitFor();
  await page.locator('#composeinput').fill('Inspect this controlled browser fixture image.');
  let admittedResolve;
  const admitted = new Promise(resolve => admittedResolve = resolve),
    submissionIds = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/send')) submissionIds.push(request.postDataJSON().requestId);
  });
  await page.route('**/api/sessions/*/send', async route => {
    const response = await route.fetch();
    const result = await response.json();
    assert.equal(result.accepted, true);
    await route.abort('failed');
    admittedResolve(result);
  });
  await page.getByRole('button', {
    name: 'Send message',
    exact: true
  }).click();
  const firstAdmission = await admitted;
  await page.unroute('**/api/sessions/*/send');
  await page.reload();
  await page.locator('.message.assistant h2').waitFor();
  await page.locator('#attachment-input').setInputFiles(image);
  await page.locator('#composeinput').fill('Inspect this controlled browser fixture image.');
  const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/send'));
  await page.getByRole('button', {
    name: 'Send message',
    exact: true
  }).click();
  const secondAdmission = await (await retryResponse).json();
  assert.equal(submissionIds.length, 2);
  assert.equal(submissionIds[1], submissionIds[0]);
  assert.equal(secondAdmission.goalId, firstAdmission.goalId);
  checks.push('Ambiguous admitted response retries with the same request and goal after reload');
  await page.locator('.attachment-image').waitFor();
  checks.push('Attachment control, durable admission and native image history');
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await page.locator('#menu-button').click();
  await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().left >= 0);
  await page.screenshot({
    path: output + '/narrow-sidebar.png',
    fullPage: true
  });
  await page.locator('#scrim').click({
    position: {
      x: 370,
      y: 300
    }
  });
  await page.waitForFunction(() => !document.getElementById('sidebar').classList.contains('open'));
  checks.push('Narrow-screen navigation');
  await page.screenshot({
    path: output + '/narrow.png',
    fullPage: true
  });
  assert.equal(await page.locator('.message.assistant').evaluateAll(nodes => nodes.every(n => n.textContent.trim())), true);
  assert.equal(await page.locator('.copy-message').count(), await page.locator('.message.assistant').count());
  checks.push('No empty assistant bubbles or orphan copy controls mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('Narrow viewport has no horizontal overflow');
  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(
    output + "/report.json",
    JSON.stringify({
        passed: true,
        scope: "Controlled browser fixture, not live-service acceptance",
        checks,
        errors,
        screenshots: [
          "desktop.png",
          "desktop-collapsed.png",
          "narrow.png",
          "narrow-sidebar.png",
          "progress.png",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({
    passed: true,
    checks,
    output
  }, null, 2));
} catch (error) {
  if (page)
    await page.screenshot({
      path: output + "/failure.png",
      fullPage: true
    });
  console.error(
    JSON.stringify({
      root,
      notice: page ? await page.locator("#notice").innerText() : null,
      status: page ? await page.locator("#headstatus").innerText() : null,
      goals: await nc.list(),
    }),
  );
  fs.writeFileSync(
    output + "/failure.json",
    JSON.stringify({
        passed: false,
        error: String(error),
        checks,
        errors
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
