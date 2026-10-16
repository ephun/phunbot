// Static initialization smoke test: no backend, provider or synthetic API responses.
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  chromium
} from 'playwright';
const files = new Map([
  ['/', 'index.html'],
  ['/ui.js', 'ui.js'],
  ['/ui.css', 'ui.css'],
  ['/presentation.mjs', 'presentation.mjs'],
  ['/request-identity.mjs', 'request-identity.mjs'],
  ['/assets/marked.js', 'node_modules/marked/lib/marked.umd.js'],
  ['/assets/purify.js', 'node_modules/dompurify/dist/purify.min.js'],
  ['/assets/sha256.js', 'node_modules/js-sha256/build/sha256.min.js'],
]);
const server = http.createServer((req, res) => {
  const file = files.get(req.url);
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(fs.readFileSync(new URL(file, import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PHUNBOT_CHROMIUM ? {
      executablePath: process.env.PHUNBOT_CHROMIUM
    } : {}),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage(),
    errors = [],
    apiRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (r.url().includes('/api/')) apiRequests.push(r.url());
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => typeof document.getElementById('new-chat').onclick === 'function');
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  assert.equal(await page.locator('#login').isVisible(), true);
  for (const id of ['new-chat', 'goalsnav', 'attach-button', 'organize', 'model'])
    assert.equal(await page.locator('#' + id).evaluate(e => typeof(e.onchange || e.onclick)), 'function');
  assert.equal(await page.locator('#composer').evaluate(e => typeof e.onsubmit), 'function');
  assert.equal(await page.getByRole('button', {
    name: 'Approve',
    exact: true
  }).count(), 0);
  console.log(JSON.stringify({
    passed: true,
    scope: 'Static control initialization; no backend/API data',
    checks: ['Module imports', 'Authentication gate', 'Composer and control handlers', 'No automatic API calls before authentication', 'No ordinary bearer approval control']
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
