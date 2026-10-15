import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ICAL from 'ical.js';

const UID = /^[a-zA-Z0-9-]+$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_BRACKET = /^\[(?:[0-9a-fA-F:]+)\]$/;

function isHostIdentifier(v) { return v && !IPV4_RE.test(v) && !IPV6_BRACKET.test(v); }

function invalidConfig(message) {
  throw new Error(`Invalid Nextcloud configuration: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Invalid Nextcloud configuration: unable to read credentials');
  }
}

export class Nextcloud {
  constructor(root) {
    this.root = root;
    const secret = readJson(`${root}/config/secrets/nextcloud.json`);
    if (!secret || typeof secret !== 'object') invalidConfig('credentials must be an object');
    if (typeof secret.baseUrl !== 'string') invalidConfig('baseUrl is required');
    let base;
    try { base = new URL(secret.baseUrl); } catch { invalidConfig('baseUrl must be a URL'); }
    if (base.protocol !== 'https:') invalidConfig('baseUrl must use HTTPS');
    if (base.username || base.password || base.search || base.hash) invalidConfig('baseUrl must not contain credentials or a query');
    if (typeof secret.username !== 'string' || !secret.username || typeof secret.password !== 'string') invalidConfig('username and password are required');
    if (secret.serverName !== undefined && (typeof secret.serverName !== 'string' || !secret.serverName || /[\x00-\x20/\\]/.test(secret.serverName))) invalidConfig('serverName is invalid');
    if (secret.calendarPath !== undefined && (typeof secret.calendarPath !== 'string' || !secret.calendarPath.startsWith('/') || secret.calendarPath.includes('?') || secret.calendarPath.includes('#'))) invalidConfig('calendarPath must be an absolute path without query or fragment');
    if (secret.calendarName !== undefined && (typeof secret.calendarName !== 'string' || !secret.calendarName)) invalidConfig('calendarName must be a non-empty string');

    this.secret = secret;
    this.baseUrl = base;
    // Only set SNI servername for DNS hostnames. Node.js rejects IP addresses
    // in the servername option (ERR_INVALID_ARG_VALUE). For IP-based connects
    // identity still flows through checkServerIdentity below.
    this.serverName = isHostIdentifier(secret.serverName ?? base.hostname) ? secret.serverName ?? base.hostname : undefined;
    this.calendar = secret.calendarPath
      ? secret.calendarPath.replace(/\/+$/, '') + '/'
      : `/remote.php/dav/calendars/${encodeURIComponent(secret.username)}/${encodeURIComponent(secret.calendarName ?? 'phunbot-goals')}/`;
  }

  async request(method, path, body = '', headers = {}, signal) {
    let target;
    try { target = new URL(path, this.baseUrl); } catch { throw new Error('Nextcloud request rejected: invalid path'); }
    if (target.origin !== this.baseUrl.origin || !path || typeof path !== 'string' || /^[a-z][a-z\d+.-]*:/i.test(path)) {
      throw new Error('Nextcloud request rejected: cross-origin path');
    }

    let ca;
    try { ca = fs.readFileSync(`${this.root}/config/nextcloud-ca.pem`); } catch { throw new Error('Nextcloud TLS configuration unavailable'); }
    let pin;
    try { pin = this.secret.certificateFingerprint256 ?? new crypto.X509Certificate(ca).fingerprint256; } catch { throw new Error('Nextcloud TLS configuration invalid'); }
    if (typeof pin !== 'string' || !/^[a-f0-9:]{95}$/i.test(pin)) throw new Error('Nextcloud TLS configuration invalid');
    const auth = `Basic ${Buffer.from(`${this.secret.username}:${this.secret.password}`).toString('base64')}`;
    return await new Promise((resolve, reject) => {
      const req = https.request(target, {
        method,
        ca,
        // Only include servername (SNI) when it's a valid DNS hostname;
        // never set it to an IP address — use the connection's host for SNI instead.
        ...(this.serverName ? { servername: this.serverName } : {}),
        signal,
        // CA validation and hostname validation both remain mandatory. Pinning
        // is an additional check, never a replacement for identity validation.
        checkServerIdentity: (host, cert) => {
          const identityError = tls.checkServerIdentity(this.serverName || host, cert);
          if (identityError) return identityError;
          if (cert.fingerprint256.toLowerCase() !== pin.toLowerCase()) return new Error('certificate pin mismatch');
          return undefined;
        },
        headers: { ...headers, Host: target.host, Authorization: auth },
        timeout: 20000,
      }, response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          // Do not follow redirects — credentials must not leak to another origin.
          if (response.statusCode >= 300 && response.statusCode < 400) return reject(new Error('Nextcloud request rejected: redirect'));
          if (response.statusCode >= 400) return reject(new Error(`External service request failed (${response.statusCode})`));
          resolve({ status: response.statusCode, body: data, etag: response.headers.etag });
        });
      });
      req.on('error', error => {
        // Don't reveal credentials or server names in transport-layer errors.
        if (error?.name === 'AbortError') return reject(error);
        const message = error?.message ?? '';
        if (/certificate|hostname|identity|pin/i.test(message)) return reject(new Error('TLS verification failed'));
        reject(new Error('Request failed'));
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.end(body);
    });
  }

  async initialize() {
    try {
      await this.request('PROPFIND', this.calendar, '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>', { Depth: '0' });
    } catch (error) {
      if (!/404/.test(error.message)) throw error;
      await this.request('MKCALENDAR', this.calendar, '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>phunbot Goals</d:displayname></d:prop></d:set></c:mkcalendar>');
    }
    await this.list();
  }

  component(data) {
    const c = new ICAL.Component(['vcalendar', [], []]);
    c.addPropertyWithValue('version', '2.0');
    c.addPropertyWithValue('prodid', '-//phunbot//Goals//EN');
    const t = new ICAL.Component('vtodo');
    for (const [k, v] of Object.entries({ uid: data.id, summary: data.title, status: data.status || 'NEEDS-ACTION', description: JSON.stringify(data), dtstamp: ICAL.Time.now() })) {
      t.addPropertyWithValue(k, v);
    }
    if (data.parent) t.addPropertyWithValue('related-to', data.parent);
    if (data.status === 'COMPLETED') {
      t.addPropertyWithValue('percent-complete', 100);
      t.addPropertyWithValue('completed', ICAL.Time.now());
    }
    c.addSubcomponent(t);
    return c.toString();
  }

  decode(body, etag) {
    try {
      const t = new ICAL.Component(ICAL.parse(body)).getFirstSubcomponent('vtodo');
      if (!t) throw Error('missing VTODO');
      const raw = t.getFirstPropertyValue('description');
      if (typeof raw !== 'string') throw Error('missing description');
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !['goal', 'criterion', 'coordination'].includes(d.kind)) throw Error('invalid phunbot task');
      return { ...d, status: t.getFirstPropertyValue('status') || d.status, etag };
    } catch (error) {
      // Sanitize — do not leak full body; keep reason short.
      const safe = error.message.length <= 200 ? error.message : error.message.slice(0, 200);
      return { invalid: true, invalidReason: `parse error: ${safe}`, etag };
    }
  }

  async get(id, signal) {
    if (typeof id !== 'string' || !UID.test(id)) throw new Error('Invalid UID');
    const r = await this.request('GET', `${this.calendar}${id}.ics`, '', {}, signal);
    const result = this.decode(r.body, r.etag);
    if (!result.invalid && result.id !== id) throw Error('UID mismatch');
    return result;
  }

  async put(d, etag, signal) {
    if (typeof d.id !== 'string' || !UID.test(d.id)) throw Error('Invalid UID');
    signal?.throwIfAborted();
    await this.request('PUT', `${this.calendar}${d.id}.ics`, this.component(d), {
      'Content-Type': 'text/calendar; charset=utf-8',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' })
    }, signal);
    return this.get(d.id, signal);
  }

  async list(signal) {
    const r = await this.request('REPORT', this.calendar,
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>',
      { Depth: '1' }, signal);
    const unescape = x => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const rows = [];

    // Parse the CALDAV multistatus <response> blocks.
    const responses=[...r.body.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)].map(m => m[1]);

    for (const section of (responses.length ? responses : [r.body])) {
      const data = section.match(/<(?:[\w-]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/i);
      if (!data) continue;
      const etag = section.match(/<(?:[\w-]+:)?getetag[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?getetag>/i)?.[1]?.trim();
      rows.push(this.decode(unescape(data[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')), etag ? unescape(etag) : etag));
    }
    return rows;
  }
}
