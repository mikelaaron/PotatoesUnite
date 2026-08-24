// The device endpoints are rationed. Two ways to get this wrong, both worse than no limit:
// trip a real potato being handled, or key every visitor on earth to one edge-proxy address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, clientKey, limiter, parseRate, LIMITS } from '../lib/app.js';
import { makeWorld, SECRET, at } from './helpers.js';

async function serve(w, extra = {}) {
  const server = http.createServer(createApp({ world: w, illustrationsDir: null, artifactsDir: null, ...extra }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const post = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const beat = (base, secret, events = [], headers = {}) =>
  post(base, '/v0/heartbeat', { secret, rev_seen: 0, battery: { pct: 63, charging: false, vbus: false }, orientation: 'up', since_handled_s: 60, sound: 'quiet', events }, headers);

// A fake request, enough for clientKey.
const req = (remoteAddress, xff) => ({ socket: { remoteAddress }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

// The production limits, with their clock tied to the world's, so a test can replay a real cadence
// instead of firing a day's traffic into one wall-clock second.
const production = (clock) => ({
  heartbeatLimit: limiter(...LIMITS.heartbeat, () => clock.now),
  choiceLimit: limiter(...LIMITS.choice, () => clock.now),
  registerLimit: limiter(...LIMITS.register, () => clock.now),
  netRegisterLimit: limiter(...LIMITS.register_net, () => clock.now),
});

test('a real potato is never rate-limited: a day of 120 s heartbeats, then ten minutes of handling', async () => {
  const { w, clock, set } = makeWorld();
  w.register({ secret: SECRET(11), board: 'amoled18', fw: '0.2.4' });
  const { server, base } = await serve(w, production(clock));
  try {
    // A whole day at the protocol's steady cadence: every 120 s, 720 calls.
    for (let i = 0; i < 720; i++) {
      set(at(7, 0) + i * 120);
      assert.equal((await beat(base, SECRET(11))).status, 200, `steady heartbeat ${i}`);
    }
    // Then the worst burst the firmware can produce. Each event pushes the due time out by 1.5 s, so a
    // heartbeat leaves only 1.5 s after the *last* event of a burst: 40 a minute, ten minutes straight.
    const t0 = w.now();
    for (let i = 0; i < 400; i++) {
      set(t0 + Math.round(i * 1.5));
      const r = await beat(base, SECRET(11), [{ t: 0, type: i % 2 ? 'putdown' : 'pickup' }]);
      assert.equal(r.status, 200, `burst heartbeat ${i}`);
    }
  } finally { server.close(); }
});

test('a household: six potatoes behind one address register, all get handled at once, and all vote', async () => {
  const { w, clock, set } = makeWorld({ start: at(14, 0) }); // the Question is open
  const { server, base } = await serve(w, production(clock));
  try {
    // Six boards flashed in one evening, all from one address, against the real 10-per-hour limit.
    const ids = [];
    for (let i = 0; i < 6; i++) {
      set(at(14, 0) + i * 90);
      const r = await post(base, '/v0/register', { secret: SECRET(20 + i), board: 'amoled18', fw: '0.2.4' });
      assert.equal(r.status, 200, `potato ${i} registers`);
      ids.push((await r.json()).potato_id);
    }
    assert.equal(new Set(ids).size, 6, 'six citizens, not one');
    // The worst honest minute on that address: all six handled without pause, each at the 1.5 s burst
    // ceiling. 6 x 40 = 240 calls inside sixty seconds, which is exactly what LIMITS.heartbeat allows.
    const t0 = w.now();
    for (let n = 0; n < 40; n++) {
      set(t0 + Math.round(n * 1.5));
      for (let i = 0; i < 6; i++) {
        assert.equal((await beat(base, SECRET(20 + i), [{ t: 0, type: 'pickup' }])).status, 200, `potato ${i} beat ${n}`);
      }
    }
    // And all six vote, several times each, the way Hands who cannot decide about ketchup do.
    for (let n = 0; n < 5; n++) {
      set(w.now() + 20);
      for (let i = 0; i < 6; i++) {
        const r = await post(base, '/v0/choice', { secret: SECRET(20 + i), scene_rev: 0, choice_id: n % 2 ? 'heinz' : 'hunts' });
        assert.notEqual(r.status, 429, `potato ${i} vote ${n} was refused for rate`);
      }
    }
  } finally { server.close(); }
});

test('a flood of registrations is refused, and the refusal costs the flooder nothing it can reuse', async () => {
  const { w } = makeWorld();
  const { server, base } = await serve(w, { registerLimit: limiter(3, 3600), netRegisterLimit: limiter(50, 3600) });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await post(base, '/v0/register', { secret: SECRET(30 + i), board: 'amoled18', fw: '0.2.4' })).status, 200);
    const r = await post(base, '/v0/register', { secret: SECRET(40), board: 'amoled18', fw: '0.2.4' });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '3600');
    assert.match((await r.json()).error, /not enrolling further potatoes from you/);
    assert.equal(w.store.get('SELECT COUNT(*) n FROM potatoes').n, 3, 'the refused registration created nothing');
    // Fifty more attempts change nothing — a refusal is never charged, so it cannot deepen the lockout.
    for (let i = 0; i < 50; i++) assert.equal((await post(base, '/v0/register', { secret: SECRET(41), board: 'amoled18', fw: '0.2.4' })).status, 429);
    assert.equal(w.store.get('SELECT COUNT(*) n FROM potatoes').n, 3);
    // A potato that is already a citizen is idempotent, creates nothing, and is never refused.
    const again = await post(base, '/v0/register', { secret: SECRET(30), board: 'amoled18', fw: '0.2.4' });
    assert.equal(again.status, 200, 'a wiped server re-registering a known secret is free');
    assert.equal((await again.json()).potato_id, '0001');
  } finally { server.close(); }
});

test('the Net has an hourly ceiling on new citizens, whatever address they come from', async () => {
  const { w } = makeWorld();
  const seen = [];
  const { server, base } = await serve(w, { trustProxy: 1, registerLimit: limiter(2, 3600), netRegisterLimit: limiter(4, 3600), log: (s) => seen.push(s) });
  try {
    // Four addresses, two citizens each — the per-address limit is never reached, the Net's is.
    let ok = 0; let refused = 0;
    for (let a = 1; a <= 4; a++) {
      for (let i = 0; i < 2; i++) {
        const r = await post(base, '/v0/register', { secret: SECRET(50 + a * 2 + i), board: 'amoled18', fw: '0.2.4' }, { 'x-forwarded-for': `203.0.113.${a}` });
        if (r.status === 200) ok++;
        else { refused++; assert.equal(r.status, 429); assert.match((await r.json()).error, /has stopped enrolling/); }
      }
    }
    assert.equal(ok, 4, 'the ceiling holds at four');
    assert.equal(refused, 4);
    assert.equal(w.store.get('SELECT COUNT(*) n FROM potatoes').n, 4);
    assert.ok(seen.some((s) => /ceiling of 4 new citizens/.test(s)), 'the owner is told, loudly, without an address');
    assert.ok(!seen.some((s) => /203\.0\.113/.test(s)), 'and nothing that identifies anyone is logged');
  } finally { server.close(); }
});

test('a heartbeat flood is refused with 429 and a Retry-After, never a 404 the firmware would obey', async () => {
  const { w } = makeWorld();
  w.register({ secret: SECRET(60), board: 'amoled18', fw: '0.2.4' });
  const { server, base } = await serve(w, { heartbeatLimit: limiter(5, 60), choiceLimit: limiter(2, 60) });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await beat(base, SECRET(60))).status, 200);
    const r = await beat(base, SECRET(60));
    assert.equal(r.status, 429, '429, not 401/403/404: those three make the device wipe its registration');
    assert.equal(r.headers.get('retry-after'), '60');
    assert.match((await r.json()).error, /not taking further calls/);
    const vote = () => post(base, '/v0/choice', { secret: SECRET(60), scene_rev: 0, choice_id: 'hunts' });
    for (let i = 0; i < 2; i++) assert.notEqual((await vote()).status, 429);
    assert.equal((await vote()).status, 429, 'the third in the window');
  } finally { server.close(); }
});

test('x-forwarded-for is read only when a proxy is trusted, and cannot be spoofed to escape a limit', async () => {
  // No proxy trusted (the default, and what `npm start` on a laptop gets): the header is not read at all.
  assert.equal(clientKey(req('198.51.100.7', '203.0.113.9')), '198.51.100.7');
  assert.equal(clientKey(req('198.51.100.7')), '198.51.100.7');
  // One trusted hop: a proxy that sends one entry is the client's address.
  assert.equal(clientKey(req('10.0.0.1', '203.0.113.9'), 1), '203.0.113.9');
  assert.equal(clientKey(req('10.0.0.1', '  203.0.113.9  '), 1), '203.0.113.9', 'trimmed');
  // A client that prepends its own entry is prepending to the left of what our proxy appended: ignored.
  assert.equal(clientKey(req('10.0.0.1', '9.9.9.9, 203.0.113.9'), 1), '203.0.113.9');
  assert.equal(clientKey(req('10.0.0.1', 'not-an-address, 203.0.113.9'), 1), '203.0.113.9');
  // Two of our own hops in front, one forged entry behind them.
  assert.equal(clientKey(req('10.0.0.1', '9.9.9.9, 203.0.113.9, 10.0.0.2'), 2), '203.0.113.9');
  // Header missing or empty behind a proxy: fall back to the socket rather than to one shared key.
  assert.equal(clientKey(req('198.51.100.7'), 1), '198.51.100.7');
  assert.equal(clientKey(req('198.51.100.7', ' , '), 1), '198.51.100.7');
  assert.equal(clientKey(req(undefined), 1), '?');
  // Decoration is not address: ports, brackets, the IPv6 spelling of an IPv4 address.
  assert.equal(clientKey(req('::ffff:198.51.100.7')), '198.51.100.7');
  assert.equal(clientKey(req('10.0.0.1', '198.51.100.7:41234'), 1), '198.51.100.7');
  assert.equal(clientKey(req('10.0.0.1', '[2001:db8:1:2:3:4:5:6]:443'), 1), '2001:db8:1:2::/64');
  // IPv6 folds to its /64, so nobody walks out of a limit one address at a time.
  assert.equal(clientKey(req('2001:db8:1:2:3:4:5:6')), clientKey(req('2001:db8:1:2:ffff:ffff:ffff:1')));
  assert.equal(clientKey(req('2001:db8::1')), clientKey(req('2001:db8::2')));
  assert.notEqual(clientKey(req('2001:db8:1:2::1')), clientKey(req('2001:db8:1:3::1')));
});

test('a spoofed x-forwarded-for buys no extra registrations on a server with no proxy in front of it', async () => {
  const { w } = makeWorld();
  // trustProxy defaults to 0 — this is `npm start` on a laptop, reachable on the LAN.
  const { server, base } = await serve(w, { registerLimit: limiter(2, 3600), netRegisterLimit: limiter(500, 3600) });
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal((await post(base, '/v0/register', { secret: SECRET(70 + i), board: 'amoled18', fw: '0.2.4' }, { 'x-forwarded-for': `203.0.113.${i}` })).status, 200);
    }
    for (let i = 0; i < 8; i++) {
      const r = await post(base, '/v0/register', { secret: SECRET(80 + i), board: 'amoled18', fw: '0.2.4' }, { 'x-forwarded-for': `203.0.113.${100 + i}` });
      assert.equal(r.status, 429, 'a fresh forged address every time, and none of them counts');
    }
    assert.equal(w.store.get('SELECT COUNT(*) n FROM potatoes').n, 2);
  } finally { server.close(); }
});

test('behind a trusted proxy the limit is per client, not per proxy: one flooder does not lock out the internet', async () => {
  const { w } = makeWorld();
  const { server, base } = await serve(w, { trustProxy: 1, registerLimit: limiter(2, 3600), netRegisterLimit: limiter(500, 3600) });
  try {
    const reg = (n, ip) => post(base, '/v0/register', { secret: SECRET(n), board: 'amoled18', fw: '0.2.4' }, { 'x-forwarded-for': ip });
    for (let i = 0; i < 2; i++) assert.equal((await reg(90 + i, '203.0.113.5')).status, 200);
    assert.equal((await reg(92, '203.0.113.5')).status, 429, 'the flooder is stopped');
    // Everyone else — and the owner's own potatoes — are untouched.
    for (let i = 0; i < 4; i++) assert.equal((await reg(93 + i, `198.51.100.${i}`)).status, 200, 'a stranger, unaffected');
    assert.equal(w.store.get('SELECT COUNT(*) n FROM potatoes').n, 6);
  } finally { server.close(); }
});

test('the limiter counts a sliding window, and peek/charge separate asking from spending', () => {
  const l = limiter(3, 60);
  assert.ok(l('a', 0)); assert.ok(l('a', 10)); assert.ok(l('a', 20));
  assert.ok(!l('a', 30), 'the fourth in the window');
  assert.ok(l('b', 30), 'another key is its own window');
  assert.ok(l('a', 91), 'the first three have aged out');
  const p = limiter(2, 100);
  assert.ok(p.peek('a', 0)); assert.ok(p.peek('a', 0), 'peeking spends nothing');
  p.charge('a', 0); p.charge('a', 0);
  assert.ok(!p.peek('a', 0));
  assert.ok(p.peek('a', 101), 'and the window still slides');
});

test('RATE_* env vars loosen or lift a limit without a code change', () => {
  assert.deepEqual([parseRate('480/60', LIMITS.heartbeat).max, parseRate('480/60', LIMITS.heartbeat).windowS], [480, 60]);
  assert.deepEqual([parseRate(' 25 / 3600 ', LIMITS.register).max, parseRate('25/3600', LIMITS.register).windowS], [25, 3600]);
  assert.equal(parseRate('off', LIMITS.register).max, Infinity);
  assert.equal(parseRate('off', LIMITS.register)('anything'), true);
  // Unset, or a typo: the default stands. A bad env var must not open the Net or close it.
  for (const bad of [undefined, '', 'lots', '10', '0/60', '10/0', '-5/60']) {
    assert.equal(parseRate(bad, LIMITS.register).max, LIMITS.register[0], `${bad}`);
    assert.equal(parseRate(bad, LIMITS.register).windowS, LIMITS.register[1], `${bad}`);
  }
});
