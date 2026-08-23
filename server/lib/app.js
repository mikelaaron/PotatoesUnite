// Routing. server.js listens; this is everything it serves, so tests can mount it on any port.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './world.js';
import { renderBoard, renderFile, renderMessage, renderAbout } from './pages.js';
import { storyToHtml, mimeFor } from './markdown.js';

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

export function createApp({ world, illustrationsDir, artifactsDir, githubUrl = '', log = () => {} }) {
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

    if (m === 'GET' && p === '/') return html(res, 200, renderBoard(world.board()));
    if (m === 'GET' && p === '/about') return html(res, 200, renderAbout(storyToHtml(world.data.story, { githubUrl, illustrationsDir, artifactsDir })));
    if (m === 'GET' && p === '/health') return json(res, 200, { ok: true, t: world.now() });

    let fm = p.match(/^\/illustrations\/([^/]+)$/);
    if (m === 'GET' && fm) return illustration(res, fm[1]);

    fm = p.match(/^\/file\/([A-Za-z0-9-]{3,16})$/);
    if (m === 'GET' && fm) {
      const f = world.file(fm[1]);
      if (!f) return html(res, 404, renderMessage('NO SUCH FILE', 'The Council has no record of that claim code.'));
      return html(res, 200, renderFile(f));
    }
    fm = p.match(/^\/file\/([A-Za-z0-9-]{3,16})\/ack$/);
    if (m === 'POST' && fm) {
      if (!world.ack(fm[1])) return html(res, 404, renderMessage('NO SUCH FILE', 'The Council has no record of that claim code.'));
      return html(res, 303, '', { location: `/file/${fm[1].toUpperCase()}` });
    }
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
