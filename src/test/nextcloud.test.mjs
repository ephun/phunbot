import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { Nextcloud } from '../nextcloud.mjs';

function client(body) { const n = Object.create(Nextcloud.prototype); n.request = async () => ({ body, etag: undefined }); return n; }

test('list preserves each item etag and isolates malformed human tasks', async () => {
  const body = `<d:response xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:propstat><d:prop><d:getetag>&quot;good-etag&quot;</d:getetag><c:calendar-data>BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:good\nDESCRIPTION:{&quot;id&quot;:&quot;good&quot;,&quot;kind&quot;:&quot;criterion&quot;,&quot;parent&quot;:&quot;g&quot;}\nSTATUS:NEEDS-ACTION\nEND:VTODO\nEND:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response><d:response xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:propstat><d:prop><d:getetag>"bad-etag"</d:getetag><c:calendar-data>BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:human\nSUMMARY:Human task\nEND:VTODO\nEND:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response>`;
  const n = client(body); const rows = await n.list(); assert.equal(rows.length, 2); assert.equal(rows[0].etag, '"good-etag"'); assert.equal(rows[1].invalid, true);
});

test('unsupported http_status is rejected at planning boundary', async () => { const { Controller } = await import('../controller.mjs'); const nc = { async get() { return { id: 'g', status: 'NEEDS-ACTION' }; }, async list() { return []; } }; const c = new Controller('/tmp/phunbot-nextcloud-test', nc); await assert.rejects(() => c.plan('g', [{ title: 'x', verifier: { kind: 'http_status', url: 'https://example.com' } }]), /verifier/i); });

function tlsFixture({ baseUrl = 'https://localhost', serverName, fingerprint } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phunbot-nextcloud-tls-'));
  const key = path.join(root, 'key.pem'); const cert = path.join(root, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const pem = fs.readFileSync(cert); const actualFingerprint = new crypto.X509Certificate(pem).fingerprint256;
  fs.mkdirSync(path.join(root, 'config', 'secrets'), { recursive: true }); fs.copyFileSync(cert, path.join(root, 'config', 'nextcloud-ca.pem'));
  fs.writeFileSync(path.join(root, 'config', 'secrets', 'nextcloud.json'), JSON.stringify({ baseUrl, username: 'alice@example', password: 'not-a-real-secret', calendarName: 'team goals', ...(serverName ? { serverName } : {}), ...(fingerprint ? { certificateFingerprint256: fingerprint } : {}) }));
  const requests = []; const server = https.createServer({ key: fs.readFileSync(key), cert: pem }, (req, res) => { requests.push({ url: req.url, host: req.headers.host, servername: req.socket.servername }); res.writeHead(200); res.end('ok'); });
  return { root, server, requests, actualFingerprint };
}

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('HTTPS baseUrl supplies Host/SNI and derives encoded calendar path', async () => {
  const f = tlsFixture(); const port = await listen(f.server);
  try {
    const n = new Nextcloud(f.root); n.baseUrl = new URL(`https://localhost:${port}`); // keep the fixture certificate and use the live ephemeral port
    await n.request('PROPFIND', n.calendar);
    assert.equal(f.requests[0].host, `localhost:${port}`); assert.equal(f.requests[0].servername, 'localhost');
    assert.equal(n.calendar, '/remote.php/dav/calendars/alice%40example/team%20goals/');
  } finally { await close(f.server); }
});

test('explicit serverName validates TLS identity when connecting to an IP', async () => {
  const f = tlsFixture({ baseUrl: 'https://127.0.0.1', serverName: 'localhost' }); const port = await listen(f.server);
  try { const n = new Nextcloud(f.root); n.baseUrl = new URL(`https://127.0.0.1:${port}`); await n.request('GET', '/health'); assert.equal(f.requests[0].servername, 'localhost'); }
  finally { await close(f.server); }
});

test('hostname mismatch and pin mismatch are rejected without leaking response or credentials', async () => {
  const host = tlsFixture({ baseUrl: 'https://127.0.0.1' }); const port = await listen(host.server);
  try { const n = new Nextcloud(host.root); n.baseUrl = new URL(`https://127.0.0.1:${port}`); await assert.rejects(n.request('GET', '/health'), /TLS|IP address/); }
  finally { await close(host.server); }
  const pin = tlsFixture({ fingerprint: 'AA:'.repeat(31) + 'AA' }); const pinPort = await listen(pin.server);
  try { const n = new Nextcloud(pin.root); n.baseUrl = new URL(`https://localhost:${pinPort}`); await assert.rejects(n.request('GET', '/health'), /TLS verification failed/); }
  finally { await close(pin.server); }
});

test('invalid config and cross-origin paths fail closed', async () => {
  const f = tlsFixture({ baseUrl: 'http://localhost' }); assert.throws(() => new Nextcloud(f.root), /HTTPS/);
  const good = tlsFixture(); const n = new Nextcloud(good.root); await assert.rejects(n.request('GET', 'https://other.invalid/steal'), /cross-origin/);
});
