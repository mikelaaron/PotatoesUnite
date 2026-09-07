// Routing. server.js listens; this is everything it serves, so tests can mount it on any port.
import fs from 'node:fs';
import closure from '../data/closure.json' with { type: 'json' };
import path from 'node:path';
import { HttpError } from './world.js';
import { renderBoard, renderFile, renderMessage, renderAbout, renderEditions, renderAcknowledged, renderFlash, renderFlashAgent } from './pages.js';
import { BOARDS } from './boards.js';
import { potatoSvg } from './portrait.js';
import { renderMarkdown } from './markdown.js';
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

const json = (res, status, body, extra = {}) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store', ...extra });
  res.end(res.headOnly ? undefined : s);
};
const html = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(res.headOnly ? undefined : body);
};

const NO_SUCH_CODE = 'The Council has no record of that claim code.';
const TOO_MANY = 'The Council is not taking further attempts from you this minute.';
const TOO_FAST = 'The Council is not taking further calls from you.';
const ENOUGH_FROM_YOU = 'The Council is not enrolling further potatoes from you.';
const REGISTER_CLOSED = 'The Council has stopped enrolling. It does not explain itself.';

// Ten claim attempts per address per minute. In memory; the Council keeps no longer record of who tried.
//
// Calling it records an attempt and answers whether that attempt was inside the limit — the shape the
// claim routes have always used. `peek` asks without recording and `charge` records without asking, so a
// quota can be spent on what actually happened (a citizen created) rather than on the asking, and a
// refusal never extends its own lockout.
export function limiter(max = 10, windowS = 60, clock = () => Date.now() / 1000) {
  const seen = new Map();
  const live = (key, now) => { const arr = (seen.get(key) || []).filter((t) => now - t < windowS); seen.set(key, arr); return arr; };
  const sweep = (now) => { if (seen.size > 10000) for (const [k, v] of seen) if (!v.some((t) => now - t < windowS)) seen.delete(k); };
  const f = (key, now = clock()) => { const arr = live(key, now); arr.push(now); sweep(now); return arr.length <= max; };
  f.peek = (key, now = clock()) => live(key, now).length < max;
  f.charge = (key, now = clock()) => { live(key, now).push(now); sweep(now); };
  f.max = max; f.windowS = windowS;
  return f;
}

// Configured off: the Council counts nothing and refuses nothing.
const openLimit = () => Object.assign(() => true, { peek: () => true, charge: () => {}, max: Infinity, windowS: 0 });

// `RATE_*` env vars, in "max/windowSeconds" form — "10/3600". "off" removes the limit. Anything else
// unparseable keeps the default: a typo in an env var must not silently open the Net or close it.
export function parseRate(spec, [max, windowS]) {
  const s = String(spec ?? '').trim().toLowerCase();
  if (!s) return limiter(max, windowS);
  if (s === 'off' || s === 'none') return openLimit();
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? limiter(Number(m[1]), Number(m[2])) : limiter(max, windowS);
}

// What a legitimate potato actually does (docs/PROTOCOL.md, "Heartbeat timing"), and how many of them
// can sit behind one household address. These are the ceilings a shell loop hits, not the ceilings a
// potato hits: every one of them is at least an order of magnitude above the worst honest traffic.
export const LIMITS = {
  // A device heartbeats every 120 s, and 1.5 s after the *last* event of a burst — each event pushes the
  // due time out again, so sustained handling is capped at one call per 1.5 s, i.e. 40/min for one
  // potato. Six potatoes in one office, all being handled without pause for a solid minute, is 240.
  // Idle, those six cost 3/min. Heartbeats do not vote, so this is about storage and writes, not the Count.
  heartbeat: [240, 60],
  // A vote is one POST per potato per Question, plus however many times the Hands change their mind
  // before the close. Losing one to a 429 loses a vote outright (the firmware drops it, see below), so
  // this stays loose: the Count is defended by rationing identities, not choices — one potato, one vote,
  // so hammering /v0/choice from one secret only ever rewrites that potato's own vote.
  choice: [60, 60],
  // Registering happens once in a device's life, plus again if the server ever forgets it. Ten new
  // citizens from one address in an hour is already an office unboxing a crate.
  register: [10, 3600],
  // The backstop, across all addresses: a botnet or a cloud fleet has more addresses than the per-address
  // limit can see. The Net has two desks on it; sixty new citizens in an hour is far past any honest
  // week. The owner would rather the door shut for an hour than have the Counts decided by a stranger.
  register_net: [60, 3600],
  claim: [10, 60],
};

// Strip what is decoration rather than address: brackets, a port, the IPv6 spelling of an IPv4 address.
function normalizeIp(s) {
  let a = String(s || '').trim().toLowerCase();
  if (a.startsWith('[')) a = a.slice(1, a.indexOf(']') > 0 ? a.indexOf(']') : undefined);
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(':'));
  if (a.startsWith('::ffff:')) a = a.slice(7);
  return a;
}

// An IPv6 address folded to its /64. One subscriber is handed the whole block, so a household's potatoes
// share a key (which is what the household limit wants) and nobody walks out of a limit one address at a
// time (which is what the register limit wants).
function v6net(a) {
  if (!a.includes(':')) return a;
  const [head = '', tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  if (!a.includes('::')) return h.length === 8 ? `${h.slice(0, 4).join(':')}::/64` : a;
  const t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.length === 8 ? `${full.slice(0, 4).join(':')}::/64` : a;
}

// The address the Council holds responsible for a burst. Two opposite failures to avoid.
//
// Behind an edge proxy (Railway), `remoteAddress` is the proxy's and is identical for every visitor on
// earth: a limit keyed on it locks out the internet, the owner's own potatoes included, in the first busy
// minute. In front of one, `x-forwarded-for` is whatever the caller typed and keying on it is no limit
// at all. So `trustProxy` states how many hops in front of us are ours:
//
//   0 — the default, and what `npm start` on a laptop gets — ignores the header completely. No header a
//       stranger sends can change their key.
//   N — reads the address the Nth-from-last hop saw. Our proxy appends what it saw, so anything the
//       client prepended sits to the *left* of that and is discarded. Left-most is only trusted when the
//       proxy sent a single entry, which is the ordinary case.
//
// Never logged, never stored.
export function clientKey(req, trustProxy = 0) {
  let addr = normalizeIp(req.socket && req.socket.remoteAddress);
  if (trustProxy > 0) {
    const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',').map((s) => normalizeIp(s)).filter(Boolean);
    if (fwd.length) addr = fwd[Math.max(0, fwd.length - trustProxy)];
  }
  return v6net(addr) || '?';
}

const retryAfter = (l) => ({ 'retry-after': String(l.windowS || 60) });

function readForm(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 4096) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', reject);
  });
}

export function createApp({
  world, illustrationsDir, artifactsDir,
  vendorDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor'),
  githubUrl = '', tuberUrl = '', log = () => {},
  trustProxy = 0,
  projectClosed = false,
  claimLimit = limiter(...LIMITS.claim),
  heartbeatLimit = limiter(...LIMITS.heartbeat),
  choiceLimit = limiter(...LIMITS.choice),
  registerLimit = limiter(...LIMITS.register),
  netRegisterLimit = limiter(...LIMITS.register_net),
}) {
  // The short code on the device buys a long token; the File lives at the token. Never at the code.
  function claim(req, res, code) {
    if (!claimLimit(clientKey(req, trustProxy))) { req.resume(); return html(res, 429, renderMessage('NOT NOW', TOO_MANY), retryAfter(claimLimit)); }
    const p = world.byClaim(String(code || '').trim().toUpperCase());
    if (!p) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE));
    const token = world.mintToken(p);
    res.writeHead(302, { location: `/file/${token}`, 'cache-control': 'no-store' });
    res.end();
  }

  // The web-flash manifest for a board, and whether this deploy actually carries it. The /flash page asks
  // before it offers a Connect button: a public deploy ships no images until 0.3.0, and a button that 404s
  // is worse than a page that says nothing has been issued.
  const webflashManifest = (board) => (world.data.releasesDir ? path.join(world.data.releasesDir, board, 'webflash.json') : null);
  const hasWebflash = (board) => {
    const file = webflashManifest(board);
    try { return !!file && fs.statSync(file).isFile(); } catch { return false; }
  };

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

    // Close fresh installations without interrupting existing device heartbeats or OTA.
    if (projectClosed && m === 'GET') {
      if (p === '/flash' || p.startsWith('/flash/')) return html(res, 410, renderMessage(closure.title, closure.message));
      if (/^\/releases\/[a-z0-9]+\/webflash(?:\.json|-[^/]+\.bin)$/.test(p)) return json(res, 410, { error: closure.title, message: closure.message });
    }

    // The device endpoints, rationed. A potato is bursty by design, so the windows are wide (see LIMITS):
    // what they stop is a shell loop, not a potato being handled. Refusals are 429 — never 401/403/404,
    // which the firmware reads as "this server has forgotten me" and answers by wiping its registration.
    if (m === 'POST' && p === '/v0/register') {
      const body = await readJson(req);
      // Only a NEW citizen is permanent state, and only permanent state is worth rationing. A device
      // re-registering its own secret (a wiped server, a serial `netReregister`) is idempotent and free.
      const fresh = !world.bySecret(String(body.secret || '').toLowerCase());
      const key = fresh ? clientKey(req, trustProxy) : null;
      if (fresh) {
        if (projectClosed) return json(res, 410, { error: closure.title, message: closure.message });
        if (!netRegisterLimit.peek('*')) {
          log(`register refused: the Net is at its ceiling of ${netRegisterLimit.max} new citizens per ${netRegisterLimit.windowS}s`);
          return json(res, 429, { error: REGISTER_CLOSED }, retryAfter(netRegisterLimit));
        }
        if (!registerLimit.peek(key)) {
          log(`register refused: one address is over ${registerLimit.max} new citizens per ${registerLimit.windowS}s`);
          return json(res, 429, { error: ENOUGH_FROM_YOU }, retryAfter(registerLimit));
        }
      }
      const out = world.register(body);
      // Charged once the citizen exists, never on the asking — so a refused device retrying every 15 s,
      // which is exactly what the firmware does, can never talk itself into a longer lockout.
      if (fresh) { registerLimit.charge(key); netRegisterLimit.charge('*'); }
      return json(res, 200, out);
    }
    if (m === 'POST' && p === '/v0/heartbeat') {
      // Drained, not parsed: a refusal must not leave a half-read body on a kept-alive connection,
      // and must not spend CPU on JSON it has already decided to ignore.
      if (!heartbeatLimit(clientKey(req, trustProxy))) { req.resume(); return json(res, 429, { error: TOO_FAST }, retryAfter(heartbeatLimit)); }
      return json(res, 200, world.heartbeat(await readJson(req)));
    }
    if (m === 'POST' && p === '/v0/choice') {
      if (!choiceLimit(clientKey(req, trustProxy))) { req.resume(); return json(res, 429, { error: TOO_FAST }, retryAfter(choiceLimit)); }
      const r = world.choice(await readJson(req));
      return json(res, r.status, r.scene);
    }

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
    let rm = p.match(/^\/releases\/([a-z0-9]+)\/webflash\.json$/);
    if (m === 'GET' && rm) {
      const file = webflashManifest(rm[1]);
      let st = null;
      try { st = file && fs.statSync(file); } catch { st = null; }
      if (!st || !st.isFile()) return json(res, 404, { error: 'no such manifest' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': st.size, 'cache-control': 'no-store' });
      if (res.headOnly) return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    rm = p.match(/^\/releases\/([a-z0-9]+)\/([^/]+)$/);
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
      return html(res, 200, renderBoard(b, { tuberUrl, projectClosed, flashOpen: !projectClosed && Object.keys(BOARDS).some(hasWebflash) }));
    }
    if (m === 'GET' && p === '/flash') {
      const boards = Object.entries(BOARDS).map(([id, b]) => {
        const variety = world.data.variety(b.variety) || world.data.varieties[0] || {};
        return { id, ...b, webflash: hasWebflash(id), portrait: potatoSvg(variety, 77 + id.length, { name: b.citizen, size: 96 }) };
      });
      return html(res, 200, renderFlash({ boards, githubUrl, tuberUrl }));
    }
    if (m === 'GET' && p === '/flash/agent') {
      world.data.reload();
      if (!world.data.flashAgent) return html(res, 404, renderMessage('NOT FOUND', 'Nothing here. The plant may know more.'));
      return html(res, 200, renderFlashAgent(renderMarkdown(world.data.flashAgent)));
    }
    let vm = p.match(/^\/vendor\/esp-web-tools\/([A-Za-z0-9._-]+\.js)$/);
    if (m === 'GET' && vm) {
      const file = path.join(vendorDir, 'esp-web-tools', vm[1]);
      let st = null;
      try { st = fs.statSync(file); } catch { st = null; }
      if (!st || !st.isFile()) return json(res, 404, { error: 'no such module' });
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': st.size, 'cache-control': 'public, max-age=3600' });
      if (res.headOnly) return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    if (m === 'GET' && p === '/about') return html(res, 200, renderAbout(storyToHtml(world.data.story, { githubUrl, tuberUrl, illustrationsDir, artifactsDir, projectClosed }), { tuberUrl, projectClosed }));
    // Every edition carries the Question its day was put; the page prints it so a Count reads cold.
    if (m === 'GET' && p === '/editions') { world.tick(); return html(res, 200, renderEditions(world.editions().map((e) => world.withQuestion(e)), { tuberUrl, projectClosed })); }
    let em = p.match(/^\/editions\/(\d{4}-\d{2}-\d{2})\/(morning|evening)$/);
    if (m === 'GET' && em) {
      world.tick();
      const e = world.withQuestion(world.bulletin(em[1], em[2]));
      if (!e) return html(res, 404, renderMessage('NO SUCH EDITION', 'The Council did not print that one.'));
      return html(res, 200, renderEditions([e], { single: true, tuberUrl, projectClosed }));
    }
    if (m === 'GET' && p === '/health') return json(res, 200, { ok: true, t: world.now() });
    if (m === 'GET' && p === '/v0/fleet') return json(res, 200, { fleet: world.fleet() });

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
    fm = p.match(/^\/file\/([a-f0-9]{48})\/vote$/);
    if (m === 'POST' && fm) {
      if (!claimLimit(clientKey(req, trustProxy))) { req.resume(); return html(res, 429, renderMessage('NOT NOW', TOO_MANY), retryAfter(claimLimit)); }
      const body = await readForm(req);
      const r = world.voteFromFile(fm[1], body.choice_id);
      if (!r) return html(res, 404, renderMessage('NO SUCH FILE', NO_SUCH_CODE));
      const f = world.file(fm[1]);
      f.key = fm[1];
      if (r.status === 200) f.informed = r.line;
      return html(res, r.status === 200 ? 200 : r.status, renderFile(f));
    }
    fm = p.match(/^\/file\/([a-f0-9]{48})\/ack$/);
    if (m === 'POST' && fm) {
      if (!claimLimit(clientKey(req, trustProxy))) { req.resume(); return html(res, 429, renderMessage('NOT NOW', TOO_MANY), retryAfter(claimLimit)); }
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
