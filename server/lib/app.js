// Routing. server.js listens; this is everything it serves, so tests can mount it on any port.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './world.js';
import { renderBoard, renderFile, renderMessage, renderAbout, renderEditions, renderAcknowledged } from './pages.js';
import { storyToHtml, mimeFor, findIllustration } from './markdown.js';
import { offer, BOARD_RE, BIN_RE } from './releases.js';

const BODY_LIMIT = 64 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
  res.end(res.headOnly ? undefined : s);
};
const html = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(res.headOnly ? undefined : body);
};

const NO_SUCH_CODE = 'The Council has no record of that claim code.';
const TOO_MANY = 'The Council is not taking further attempts from you this minute.';

// Ten claim attempts per address per minute. In memory; the Council keeps no longer record of who tried.
function limiter(max = 10, windowS = 60) {
  const seen = new Map();
  return (ip, now = Date.now() / 1000) => {
    const arr = (seen.get(ip) || []).filter((t) => now - t < windowS);
    arr.push(now); seen.set(ip, arr);
    if (seen.size > 10000) for (const [k, v] of seen) if (!v.some((t) => now - t < windowS)) seen.delete(k);
    return arr.length <= max;
  };
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 4096) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', reject);
  });
}

export function createApp({ world, illustrationsDir, artifactsDir, githubUrl = '', tuberUrl = '', log = () => {}, claimLimit = limiter() }) {
  // The short code on the device buys a long token; the File lives at the token. Never at the code.
  function claim(req, res, code) {
    const ip = (req.socket && req.socket.remoteAddress) || '?';
    if (!claimLimit(ip)) return html(res, 429, renderMessage('NOT NOW', TOO_MANY), { 'retry-after': '60' });
    const p = world.byClaim(String(code || '').trim().toUpperCase());
    if (!p) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE));
    const token = world.mintToken(p);
    res.writeHead(302, { location: `/file/${token}`, 'cache-control': 'no-store' });
    res.end();
  }

  // docs/illustrations, read-only, one hour of cache. Names are slugs only; nothing else is reachable.
  function illustration(res, name) {
    const m = name.match(/^([a-z0-9-]+)\.(png|jpg|jpeg|webp)$/);
    const file = m && illustrationsDir ? path.join(illustrationsDir, `${m[1]}.${m[2]}`) : null;
    let st = null;
    try { st = file && fs.statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) return html(res, 404, renderMessage('NOT FOUND', 'No such illustration. The Council has not drawn it.'));
    res.writeHead(200, { 'content-type': mimeFor(m[2]), 'content-length': st.size, 'cache-control': 'public, max-age=3600', 'last-modified': st.mtime.toUTCString() });
    if (res.headOnly) return res.end();
    fs.createReadStream(file).pipe(res);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://potato');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    res.headOnly = req.method === 'HEAD';
    const m = res.headOnly ? 'GET' : req.method;

    if (m === 'POST' && p === '/v0/register') return json(res, 200, world.register(await readJson(req)));
    if (m === 'POST' && p === '/v0/heartbeat') return json(res, 200, world.heartbeat(await readJson(req)));
    if (m === 'POST' && p === '/v0/choice') { const r = world.choice(await readJson(req)); return json(res, r.status, r.scene); }

    // Firmware: the device asks once a day. No secret: an image is not a secret and the device is not yet trusted to be itself.
    if (m === 'GET' && p === '/v0/firmware') {
      const board = String(url.searchParams.get('board') || '').toLowerCase();
      const fw = String(url.searchParams.get('fw') || '0.0.0');
      if (!BOARD_RE.test(board)) throw new HttpError(400, 'board must be a slug');
      world.data.reload();
      const o = offer(world.data.releases[board], board, fw);
      log(`firmware check board=${board} fw=${fw} → ${o ? o.version : 'nothing newer'}`);
      if (!o) { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
      return json(res, 200, o);
    }
    let rm = p.match(/^\/releases\/([a-z0-9]+)\/([^/]+)$/);
    if (m === 'GET' && rm && BIN_RE.test(rm[2])) {
      const file = world.data.releasesDir ? path.join(world.data.releasesDir, rm[1], rm[2]) : null;
      let st = null;
      try { st = file && fs.statSync(file); } catch { st = null; }
      if (!st || !st.isFile()) return json(res, 404, { error: 'no such image' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'cache-control': 'public, max-age=300', 'last-modified': st.mtime.toUTCString() });
      if (res.headOnly) return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    if (p.startsWith('/releases/')) return json(res, 404, { error: 'no such image' });

    if (m === 'GET' && p === '/') {
      const b = world.board();
      const ill = b.incident ? findIllustration(illustrationsDir, b.incident) : null;
      b.incidentSrc = ill ? ill.src : null;
      return html(res, 200, renderBoard(b, { tuberUrl }));
    }
    if (m === 'GET' && p === '/about') return html(res, 200, renderAbout(storyToHtml(world.data.story, { githubUrl, illustrationsDir, artifactsDir }), { tuberUrl }));
    if (m === 'GET' && p === '/editions') { world.tick(); return html(res, 200, renderEditions(world.editions(), { tuberUrl })); }
    let em = p.match(/^\/editions\/(\d{4}-\d{2}-\d{2})\/(morning|evening)$/);
    if (m === 'GET' && em) {
      world.tick();
      const e = world.bulletin(em[1], em[2]);
      if (!e) return html(res, 404, renderMessage('NO SUCH EDITION', 'The Council did not print that one.'));
      return html(res, 200, renderEditions([e], { single: true, tuberUrl }));
    }
    if (m === 'GET' && p === '/health') return json(res, 200, { ok: true, t: world.now() });

    let fm = p.match(/^\/illustrations\/([^/]+)$/);
    if (m === 'GET' && fm) return illustration(res, fm[1]);

    fm = p.match(/^\/claim\/([^/]{1,16})$/);
    if (m === 'GET' && fm) return claim(req, res, decodeURIComponent(fm[1]));
    if (m === 'POST' && p === '/claim') return claim(req, res, (await readForm(req)).code);

    fm = p.match(/^\/file\/([a-f0-9]{48})$/);
    if (m === 'GET' && fm) {
      const f = world.file(fm[1]);
      if (!f) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE));
      f.key = fm[1];
      return html(res, 200, renderFile(f));
    }
    fm = p.match(/^\/file\/([a-f0-9]{48})\/ack$/);
    if (m === 'POST' && fm) {
      const line = world.ack(fm[1]);
      if (!line) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE));
      return html(res, 200, renderAcknowledged(line));
    }
    if (p.startsWith('/file/')) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE)); // short codes no longer resolve
    if (p.startsWith('/card/')) return json(res, 501, { error: 'cards are not printed yet. The Tuber is hiring.' });
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.startsWith('/v0/')) return json(res, 404, { error: 'no such endpoint' });
    return html(res, 404, renderMessage('NOT FOUND', 'Nothing here. The plant may know more.'));
  }

  return async function handler(req, res) {
    const started = Date.now();
    try {
      await route(req, res);
    } catch (e) {
      if (e instanceof HttpError) json(res, e.status, e.body);
      else { log('error:', e.stack || e.message); json(res, 500, { error: 'BLIGHT. THE COUNCIL IS AWARE.' }); }
    } finally {
      const safePath = req.url.replace(/\/file\/[^/?]+/, '/file/***');
      log(`${req.method} ${safePath} ${res.statusCode} ${Date.now() - started}ms`);
    }
  };
}
