// Potatoes Unite — the Net. One process, zero dependencies. Protocol v0 (docs/PROTOCOL.md).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, HttpError } from './lib/world.js';
import { renderBoard, renderFile, renderMessage } from './lib/pages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(here, 'data', 'potatoes.db');
const TICK_MS = 30_000;
const BODY_LIMIT = 64 * 1024;

// Logs never carry secrets, claim codes, or anything that maps a potato to a person.
const log = (...a) => console.log(new Date().toISOString(), ...a);

const world = new World({ dbPath: DB_PATH, dataDir: path.join(here, 'data'), assetsDir: path.join(here, '..', 'assets'), log });
world.data.start();
world.tick();
const ticker = setInterval(() => { try { world.tick(); } catch (e) { log('tick failed:', e.message); } }, TICK_MS);

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

async function route(req, res) {
  const url = new URL(req.url, 'http://potato');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  res.headOnly = req.method === 'HEAD';
  const m = res.headOnly ? 'GET' : req.method;

  if (m === 'POST' && p === '/v0/register') return json(res, 200, world.register(await readJson(req)));
  if (m === 'POST' && p === '/v0/heartbeat') return json(res, 200, world.heartbeat(await readJson(req)));
  if (m === 'POST' && p === '/v0/choice') { const r = world.choice(await readJson(req)); return json(res, r.status, r.scene); }

  if (m === 'GET' && p === '/') return html(res, 200, renderBoard(world.board()));
  if (m === 'GET' && p === '/health') return json(res, 200, { ok: true, t: world.now() });

  let fm = p.match(/^\/file\/([A-Za-z0-9-]{3,16})$/);
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

const server = http.createServer(async (req, res) => {
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
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  log(`POTATOES UNITE! The Net is open on http://${HOST}:${PORT}`);
  for (const ip of lan) log(`  LAN: http://${ip}:${PORT}   (point a device at this)`);
  log(`  db: ${DB_PATH}`);
});

const shutdown = () => { clearInterval(ticker); server.close(); world.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
