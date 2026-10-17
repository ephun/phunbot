// Real app HTTP + canonical Pi fixture. No production endpoints or provider calls.
import {
  chromium
} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  fileURLToPath
} from 'node:url';
import {
  prototypeFixture,
  conversationId
} from '../test/prototype-fixture.mjs';
const out = path.resolve(process.env.UI_EVIDENCE_DIR || '../docs/ui-evidence');
fs.mkdirSync(out, {
  recursive: true
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? {
    executablePath: process.env.CHROMIUM_EXECUTABLE
  } : {})
});
const fixture = await prototypeFixture();
const checks = [],
  errors = [],
  consoleErrors = [];
const check = (name) => checks.push(name);
const until = async fn => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw Error('Fixture state did not settle');
};
const capture = async (page, name) => {
  await page.screenshot({
    path: path.join(out, name + '.png')
  });
};
const rect = async (page, selector) => page.locator(selector).first().evaluate(e => {
  const r = e.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
});
try {
  const reference = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1000
    },
    reducedMotion: 'reduce'
  });
  await reference.goto(new URL('../test/fixtures/prototype-ui.html', import.meta.url).href);
  await capture(reference, 'reference-desktop-conversation');
  const referenceRects = {
    app: await rect(reference, '.app'),
    sidebar: await rect(reference, '.sidebar'),
    messages: await rect(reference, '.messages'),
    user: await rect(reference, '.message.user'),
    composer: await rect(reference, '.composer')
  };
  await reference.evaluate(() => showGoals('all'));
  await capture(reference, 'reference-desktop-goals');
  await reference.evaluate(() => showGoal('minecraft'));
  await capture(reference, 'reference-desktop-goal');
  await reference.evaluate(() => toggleEvents('minecraft-1'));
  await reference.locator('.event details').first().evaluate(e => e.open = true);
  await capture(reference, 'reference-desktop-events');
  await reference.setViewportSize({
    width: 390,
    height: 844
  });
  await reference.evaluate(() => showChat('minecraft'));
  await capture(reference, 'reference-mobile-conversation');
  const mobileReference = {
    messages: await rect(reference, '.messages'),
    user: await rect(reference, '.message.user'),
    composer: await rect(reference, '.composer')
  };
  await reference.evaluate(() => openSidebar());
  await capture(reference, 'reference-mobile-sidebar');
  await reference.close();
  await fixture.server.resumeGoals();
  await until(async () => (await fixture.api('ui/goals')).find(g => g.id === 'mph').liveExecution.state === 'running');
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1000
    },
    reducedMotion: 'reduce'
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() === 401) console.error(JSON.stringify({unexpected401:new URL(response.url()).pathname,resource:response.request().resourceType(),hasAuthorization:Boolean(response.request().headers().authorization)}));});
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('status of 400')) {consoleErrors.push(m.text());console.error(JSON.stringify({browserConsoleError:m.text(),location:m.location()}));}
  });
  await page.goto(fixture.base);
  await page.locator('#token').fill('fixture');
  await page.locator('#login-form').evaluate(e => e.requestSubmit());
  await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('The proxy responds locally'));
  assert.equal(await page.locator('.message.assistant').evaluateAll(nodes => nodes.every(n => n.textContent.trim())), true);
  assert.equal(await page.locator('.copy-message').count(), await page.locator('.message.assistant').count());
  check('No empty assistant bubbles or orphan copy controls on desktop');
  await page.mouse.move(1400, 800);
  await capture(page, 'implemented-desktop-conversation');
  const implementedRects = {
    app: await rect(page, '.app'),
    sidebar: await rect(page, '.sidebar'),
    messages: await rect(page, '.messages'),
    user: await rect(page, '.message.user'),
    composer: await rect(page, '.composer')
  };
  assert.deepEqual(implementedRects, referenceRects);
  check('Desktop geometry matches original app/sidebar/messages/user/composer exactly');
  assert.equal(await page.locator('#navcount .working').count(), 1);
  check('Live executing goal and blocked goals show separate truthful badges');
  await page.locator('#goalsnav').click();
  await page.waitForSelector('.goalrow');
  assert.equal(await page.locator('.goalrow').count(), 7);
  await capture(page, 'implemented-desktop-goals');
  await page.locator('.goalrow').first().click();
  await page.waitForSelector('.child');
  assert.equal(await page.locator('.child').count(), 4);
  assert.equal(await page.locator('.event details[open]').count(), 0);
  await capture(page, 'implemented-desktop-goal');
  check('Global goals show authoritative goals, separate acceptance criteria and collapsed activity');
  await page.locator('.child').nth(1).locator('.details-toggle').click();
  await page.waitForSelector('.event details');
  assert.equal(await page.locator('.event').count(), 4);
  await page.locator('.event summary').first().click();
  await capture(page, 'implemented-desktop-events');
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.event details[open]').count(), 1);
  check('Execution history API expansion and nested event details survive polling');
  await page.reload();
  await page.waitForSelector('.child');
  assert.match(page.url(), /#goal\/minecraft/);
  check('Goal selection survives refresh via URL, not browser goal storage');
  await page.locator('#goalmeta button').click();
  await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('The proxy responds locally'));
  await page.setViewportSize({
    width: 390,
    height: 844
  });
  await capture(page, 'implemented-mobile-conversation');
  assert.equal(await page.locator('.message.assistant').evaluateAll(nodes => nodes.every(n => n.textContent.trim())), true);
  assert.equal(await page.locator('.copy-message').count(), await page.locator('.message.assistant').count());
  check('No empty assistant bubbles or orphan copy controls on mobile');
  const mobileRects = {
    messages: await rect(page, '.messages'),
    user: await rect(page, '.message.user'),
    composer: await rect(page, '.composer')
  };
  assert.deepEqual(mobileRects, mobileReference);
  check('Mobile conversation geometry matches the original exactly at 390x844');
  await page.locator('#menu-button').click();
  await capture(page, 'implemented-mobile-sidebar');
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#sidebar.open').count(), 1);
  await page.locator('.chatlink').filter({
    hasText: 'Define MCP'
  }).click();
  await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('standardizes'));
  assert.equal(await page.locator('#sidebar.open').count(), 0);
  check('Mobile drawer remains open through polling and closes on conversation selection');
  await page.setViewportSize({
    width: 1440,
    height: 1000
  });
  await page.locator('#search-button').click();
  await page.locator('#searchinput').fill('standardizes');
  await page.waitForSelector('.searchresult');
  assert.ok((await page.locator('#searchresults').innerText()).includes('Define MCP'));
  await page.locator('.searchresult').first().click();
  check('Search finds canonical message text, then navigates to its real conversation');
  // Folder controls exercise actual authenticated HTTP and persisted metadata.
  page.once('dialog', d => d.accept('Research'));
  await page.locator('#new-folder').click();
  await until(async () => (await fixture.api('folders')).some(f => f.name === 'Research'));
  const answers = ['MCP notes', 'Research'];
  const answer = d => d.accept(answers.shift());
  page.on('dialog', answer);
  await page.locator('#organize').click();
  await until(async () => (await fixture.api('sessions')).find(r => r.id === conversationId('mcp')).folder === 'Research');
  page.off('dialog', answer);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#viewtitle').textContent === 'MCP notes');
  await page.locator('.folder-row').filter({
    hasText: 'Research'
  }).hover();
  page.once('dialog', d => d.accept('Studies'));
  await page.getByRole('button', {
    name: 'Rename Research',
    exact: true
  }).click();
  await until(async () => (await fixture.api('sessions')).find(r => r.id === conversationId('mcp')).folder === 'Studies');
  page.once('dialog', d => d.accept('Temporary'));
  await page.locator('#new-folder').click();
  await until(async () => (await fixture.api('folders')).some(f => f.name === 'Temporary'));
  await page.locator('.folder-row').filter({
    hasText: 'Temporary'
  }).hover();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', {
    name: 'Delete Temporary',
    exact: true
  }).click();
  await until(async () => !(await fixture.api('folders')).some(f => f.name === 'Temporary'));
  await page.locator('#model').selectOption('fixture-deep');
  await until(async () => (await fixture.api('sessions')).find(r => r.id === conversationId('mcp')).model === 'fixture-deep');
  await page.locator('#model').selectOption('fixture');
  await until(async () => (await fixture.api('sessions')).find(r => r.id === conversationId('mcp')).model === 'fixture');
  check('Model selection writes the actual session model through the API');
  check('Folder create, move, rename, delete and membership persist across refresh');
  // Canonical tool result and thinking canary: only public projection is displayed.
  const manager = fixture.managers.get(conversationId('mcp'));
  manager.appendMessage({
    role: 'assistant',
    content: [{
      type: 'thinking',
      thinking: 'NEVER_DISPLAY_THOUGHT'
    }, {
      type: 'toolCall',
      id: 'fixture-tool',
      name: 'memory_read',
      arguments: {
        id: 'fixture-note'
      }
    }],
    timestamp: Date.now(),
    api: 'test',
    provider: 'fixture',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      totalTokens: 0
    },
    stopReason: 'toolUse'
  });
  manager.appendMessage({
    role: 'toolResult',
    toolName: 'memory_read',
    toolCallId: 'fixture-tool',
    content: [{
      type: 'text',
      text: 'Controlled tool result'
    }],
    timestamp: Date.now(),
    isError: false
  });
  assert.equal(await page.locator('.message.assistant:has-text("NEVER_DISPLAY_THOUGHT")').count(), 0);
  assert.ok(!(await page.locator('body').textContent()).includes('memory_read'));
  check('Internal thinking/tool chatter is audit-only and absent from the normal transcript');
  // Actual image input, removal, then real send/admission, not a fake UI acknowledgement.
  const image = {
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAkoAAAAASUVORK5CYII=', 'base64')
  };
  await page.locator('#attachment-input').setInputFiles(image);
  await page.getByRole('button', {
    name: 'Remove pixel.png'
  }).click();
  assert.equal(await page.locator('.attachment-chip').count(), 0);
  check('Attachment add/remove controls work');
  await page.locator('#new-chat').click();
  await page.waitForFunction(() => document.querySelector('#viewtitle').textContent === 'New conversation');
  const newId = decodeURIComponent(new URL(page.url()).hash.slice(6));
  await page.locator('#attachment-input').setInputFiles(image);
  await page.locator('#composeinput').fill('Explain the controlled fixture with this image.');
  await page.locator('.send').click();
  await until(async () => (await fixture.api('ui/goals')).some(g => g.session?.id === newId && g.liveExecution.state === 'running'));
  const concurrent = await fixture.api('ui/goals');
  assert.equal(concurrent.filter(g => g.liveExecution.state === 'running').length, 2);
  check('Actual HTTP admission and two simultaneous executing conversations/goals');
  const admitted = concurrent.find(g => g.session?.id === newId);
  assert.equal(JSON.parse(fs.readFileSync(fixture.root + '/state/executions/' + admitted.id + '.json')).inputImages[0].mimeType, 'image/png');
  await page.waitForSelector('.attachment-image');
  assert.equal(await page.locator('.attachment-image').count(), 1);
  check('Image payload reaches real admission checkpoint and canonical transcript rendering');
  await fixture.api('sessions/' + newId + '/cancel', 'POST', {
    goalId: admitted.id
  });
  await until(async () => (await fixture.api('ui/goals')).find(g => g.id === admitted.id).persistentStatus === 'CANCELLED');
  await page.locator('#goalsnav').click();
  await page.getByRole('button', {
    name: 'Cancelled',
    exact: true
  }).click();
  await until(async () => (await page.locator('.goalrow').count()) === 1);
  check('Real cancellation transitions persistent goal state and global filter');
  const mc = await fixture.nc.get('minecraft');
  await fixture.nc.put({
    ...mc,
    authorizations: [{
      id: 'fixture-approval',
      state: 'pending',
      hash: 'fixture'
    }]
  }, mc.etag);
  await page.getByRole('button', {
    name: 'All',
    exact: true
  }).click();
  await page.locator('.goalrow').filter({
    hasText: 'Restore external Minecraft'
  }).click();
  assert.equal(await page.locator('.authorization').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Deny', exact: true }).count(), 0);
  assert.match(await page.locator('.wait-strip').innerText(), /Waiting for your response/);
  assert.equal(await page.locator('.wait-strip button').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 1);
  check('No authorization controls; waiting status links to chat and lifecycle controls remain');
  const touch = await browser.newContext({
    viewport: {
      width: 390,
      height: 844
    },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  });
  await touch.addInitScript(() => sessionStorage.setItem('phunbot-token', 'fixture'));
  const phone = await touch.newPage();
  await phone.goto(fixture.base + '/#chat/' + conversationId('minecraft'));
  await phone.waitForFunction(() => document.querySelector('#messages').textContent.includes('The proxy responds locally'));
  await phone.locator('#menu-button').tap();
  await phone.locator('.chatlink').filter({
    hasText: 'Design personal agent harness'
  }).tap();
  await phone.waitForFunction(() => document.querySelector('#viewtitle').textContent === 'Design personal agent harness');
  assert.equal(await phone.locator('#sidebar.open').count(), 0);
  await touch.close();
  check('Real mobile touch context navigates drawer and conversation');
  await page.evaluate(id => location.hash = '#chat/' + id, conversationId('minecraft'));
  await page.waitForFunction(() => document.querySelector('#viewtitle').textContent === 'Server troubleshooting');
  check('Direct hash navigation updates the rendered view');
  let releaseOld;
  const gate = new Promise(resolve => releaseOld = resolve);
  let held = false;
  const olderURL = '**/api/sessions/' + conversationId('backups') + '/messages';
  await page.route(olderURL, async route => {
    const response = await route.fetch();
    if (!held) {
      held = true;
      await gate;
    }
    await route.fulfill({
      response
    });
  });
  await page.locator('.chatlink').filter({
    hasText: 'Off-site backups'
  }).click();
  await until(() => held);
  await page.locator('.chatlink').filter({
    hasText: 'Server troubleshooting'
  }).click();
  await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('The proxy responds locally'));
  releaseOld();
  await page.waitForTimeout(100);
  await page.unroute(olderURL);
  assert.equal(await page.locator('#viewtitle').textContent(), 'Server troubleshooting');
  assert.ok(!(await page.locator('#messages').textContent()).includes('Which off-site destination'));
  check('A delayed real API response cannot overwrite a newer conversation selection');
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  check('No browser JavaScript errors or unexpected console errors');
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({
    passed: true,
    checks,
    referenceRects,
    implementedRects,
    mobileReference,
    mobileRects,
    browser: browser.version(),
    viewports: [{
      width: 1440,
      height: 1000
    }, {
      width: 390,
      height: 844
    }],
    fixtures: 'Controlled HTTP app; in-memory Nextcloud test double; canonical Pi sessions; no live provider or production access'
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    passed: true,
    checks,
    screenshots: 12
  }, null, 2));
} finally {
  await browser.close();
  await fixture.close();
}
