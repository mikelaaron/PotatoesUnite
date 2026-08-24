// The world. The server owns it; the device is a thin client that reports what happened and shows what it's told.
// Deterministic first: same seed + same events → same lines. All copy comes from data/pools; none lives here.
import crypto from 'node:crypto';
import { Store } from './db.js';
import { Data } from './data.js';
import { NAMES } from './names.js';
import { hasTouch } from './boards.js';
import * as C from './clock.js';
import { h32, seedFromSecret, pick, shuffle, bagOrder } from './rng.js';
import { fill, numberWords, durShort, durWords, hourWords, fitLine, requestShort, pct, sayLabel, fewerThanFive, capitalize } from './text.js';

const { MIN, HOUR, DAY } = C;

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : JSON.stringify(body));
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}

export const EVENT_TYPES = new Set([
  'pickup', 'putdown', 'facedown_start', 'facedown_end', 'inverted_start', 'inverted_end', 'shake', 'drop', 'tap',
  'transit_start', 'transit_end', 'charge_start', 'charge_end', 'battery_low', 'dormant_resume', 'wifi_restore', 'loud',
  'request_done', 'request_expired',
]);
const HANDLING = new Set(['pickup', 'putdown', 'facedown_start', 'facedown_end', 'inverted_start', 'inverted_end', 'shake', 'drop', 'tap', 'transit_start', 'transit_end']);
// The ration (voice doc §15): a handling session is one entry; anything under a minute is not a record.
const RATION_S = 60;          // under a minute is not a record (the dark, a plug/unplug pair)
const EPISODE_GAP_S = 5 * MIN; // handling, taps and shakes within five minutes are one episode
const PICK_MIN_S = 4;          // a pickup under four seconds files nothing; four to nine only inside a larger episode
const PICK_ALONE_S = 10;       // a lone pickup needs ten seconds to be a record
const MATTERS = new Set(['request_done', 'request_expired', 'neighbor_assigned', 'no_neighbor', 'question_present', 'question_absent', 'question_withdrawn', 'event_vote', 'event_absent', 'power', 'sprouted']);
const IDLE_STEPS = [[4 * HOUR, '4h'], [8 * HOUR, '8h'], [DAY, '24h'], [2 * DAY, '48h'], [3 * DAY, '72h'], [7 * DAY, '7d']];
const CLAIM_L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CLAIM_A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORIENTATIONS = new Set(['up', 'down', 'side', 'inverted']);
const SOUNDS = new Set(['quiet', 'normal', 'loud']);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const unit = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const iso = (s) => Math.floor(Date.parse(s) / 1000);

export class World {
  constructor({ dbPath = ':memory:', dataDir, assetsDir, docsDir = null, releasesDir = null, now, random = Math.random, log = () => {} } = {}) {
    this.store = new Store(dbPath);
    this.data = new Data({ dataDir, assetsDir, docsDir, releasesDir, log });
    this.now = now || (() => Math.floor(Date.now() / 1000));
    this.random = random;
    this.log = log;
    if (!this.store.meta('net_open_day')) this.store.setMeta('net_open_day', C.dayKey(this.now()));
  }

  close() { this.data.stop(); this.store.close(); }
  get pools() { return this.data.pools; }

  // ------------------------------------------------------------------ potatoes
  load(row) { if (!row) return null; row.st = JSON.parse(row.state || '{}'); return row; }
  byId(id) { return this.load(this.store.get('SELECT * FROM potatoes WHERE id = ?', id)); }
  bySecret(s) { return this.load(this.store.get('SELECT * FROM potatoes WHERE secret = ?', s)); }
  byClaim(c) { return this.load(this.store.get('SELECT * FROM potatoes WHERE claim_code = ?', String(c || '').toUpperCase())); }
  save(p) { this.store.run('UPDATE potatoes SET state = ? WHERE id = ?', JSON.stringify(p.st), p.id); }
  active(t) { return this.store.all('SELECT * FROM potatoes WHERE last_seen_t >= ? ORDER BY id', t - C.MISSING_S).map((r) => this.load(r)); }

  requirePotato(secret) {
    if (typeof secret !== 'string' || !/^[0-9a-fA-F]{16,128}$/.test(secret)) throw new HttpError(400, 'secret must be 16–128 hex characters');
    const p = this.bySecret(secret.toLowerCase());
    if (!p) throw new HttpError(404, 'unknown potato. register first.');
    return p;
  }

  newClaimCode() {
    for (;;) {
      const a = Array.from({ length: 3 }, () => CLAIM_L[crypto.randomInt(CLAIM_L.length)]).join('');
      const b = Array.from({ length: 3 }, () => CLAIM_A[crypto.randomInt(CLAIM_A.length)]).join('');
      const code = `${a}-${b}`;
      if (!this.store.get('SELECT 1 FROM potatoes WHERE claim_code = ?', code)) return code;
    }
  }

  variety(id) { return this.data.variety(id) || { id, name: id }; }

  register({ secret, board, fw } = {}) {
    if (typeof secret !== 'string' || !/^[0-9a-fA-F]{16,128}$/.test(secret)) throw new HttpError(400, 'secret must be 16–128 hex characters');
    secret = secret.toLowerCase();
    const t = this.now();
    let p = this.bySecret(secret);
    if (!p) {
      const varieties = this.data.varieties;
      if (!varieties.length) throw new HttpError(500, 'no varieties loaded');
      p = this.store.tx(() => {
        const n = Number(this.store.meta('next_id', '1'));
        const id = String(n).padStart(4, '0');
        const seed = seedFromSecret(secret);
        const name = NAMES[h32(seed, 'name') % NAMES.length];
        const variety = varieties[h32(seed, 'variety') % varieties.length].id;
        const claim = this.newClaimCode();
        this.store.run(
          `INSERT INTO potatoes(id, secret, name, variety, seed, claim_code, board, fw, created_t, last_seen_t, state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
          id, secret, name, variety, seed, claim, String(board || ''), String(fw || ''), t, t);
        this.store.setMeta('next_id', n + 1);
        return this.byId(id);
      });
      const F = this.pools.file.curing;
      this.addEntry(p, { t, kind: 'curing', text: F.text, note: this.noteFor(p, 'curing', t, F.note) });
      this.tick();
    } else {
      this.store.run('UPDATE potatoes SET board = ?, fw = ? WHERE id = ?', String(board || p.board || ''), String(fw || p.fw || ''), p.id);
    }
    return { potato_id: p.id, name: p.name, variety: p.variety, seed: p.seed, claim_code: p.claim_code };
  }

  // ------------------------------------------------------------------ the File
  unreadDays(p, t) { return Math.floor((t - Math.max(p.file_read_t || 0, p.created_t)) / DAY); }

  addEntry(p, { t, kind, text, note = '', standing = 0, dur_s = 0 }) {
    const withheld = this.unreadDays(p, t) >= 7 ? 1 : 0;
    this.store.run(
      'INSERT INTO entries(potato_id, t, kind, text, note, standing, dur_s, withheld, created_t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.id, Math.round(t), kind, text, note || '', standing, Math.round(dur_s), withheld, this.now());
  }

  fileUnread(p) { return this.store.get(`SELECT COUNT(*) n FROM entries WHERE potato_id = ? AND t > ? AND kind != 'nudge'`, p.id, p.file_read_t || 0).n; }

  standingScore(p, t, since = t - 14 * DAY) {
    return this.store.get('SELECT COALESCE(SUM(standing), 0) s FROM entries WHERE potato_id = ? AND t > ? AND t <= ?', p.id, since, t).s;
  }

  // Five labels. Never a number. Nobody will be told the formula, including us, ideally.
  standingLabel(p, t) {
    const L = this.pools.net.standing; // Exemplary · Reasonable · Under Review · Provisional · Not Discussed
    if (t - p.created_t < 2 * DAY) return L[3];
    const s = this.standingScore(p, t);
    if (s >= 6) return L[0];
    if (s >= -2) return L[1];
    if (s >= -8) return L[2];
    return L[4];
  }

  neighborRow(p, t) { return this.store.get('SELECT neighbor_id FROM neighbors WHERE week = ? AND potato_id = ?', C.weekKey(t), p.id); }
  neighborOf(p, t) { const r = this.neighborRow(p, t); return r && r.neighbor_id ? this.byId(r.neighbor_id) : null; }

  neighborEntry(p, t, kind, fields = {}) {
    const n = this.neighborOf(p, t);
    if (!n) return;
    const T = this.pools.file[kind];
    this.addEntry(n, { t, kind, text: fill(T.text, { neighbor: p.name, ...fields }), note: fill(T.note || '', fields), dur_s: fields.dur_s || 0 });
  }

  // Long bearer tokens for the File. The short claim code on the device only ever buys one of these.
  mintToken(p, t = this.now()) {
    const token = crypto.randomBytes(24).toString('hex'); // 192 bits
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    this.store.run('INSERT INTO tokens(hash, potato_id, created_t) VALUES (?, ?, ?)', hash, p.id, t);
    return token;
  }
  byToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const r = this.store.get('SELECT potato_id FROM tokens WHERE hash = ?', hash);
    return r ? this.byId(r.potato_id) : null;
  }
  // The File by token (public routes) or by claim code (internal, tests).
  resolveFile(key) { return /^[a-f0-9]{48}$/.test(String(key || '')) ? this.byToken(key) : this.byClaim(key); }

  file(code) {
    this.tick();
    const p = this.resolveFile(code);
    if (!p) return null;
    const t = this.now();
    const off = p.utc_offset_min || 0;
    const F = this.pools.file;
    const rows = this.store.all(`SELECT * FROM entries WHERE potato_id = ? AND kind != 'nudge' ORDER BY t DESC, id DESC`, p.id);
    const days = [];
    for (const r of rows) {
      const key = C.localDayKey(r.t, off);
      let d = days[days.length - 1];
      if (!d || d.key !== key) { d = { key, header: C.dayHeader(r.t, off), t: r.t, entries: [], withheld: false }; days.push(d); }
      if (r.withheld) { d.withheld = true; continue; }
      d.entries.push({ t: r.t, time: C.hm(r.t, off), text: r.text, note: r.note, kind: r.kind, unread: r.t > (p.file_read_t || 0) });
    }
    const nrow = this.neighborRow(p, t);
    const n = this.neighborOf(p, t);
    const neighborLine = n ? fill(F.header.neighbor, { neighbor: n.name, id: n.id })
      : nrow ? F.header.no_neighbor : F.header.no_neighbor_yet;
    const neighborTags = n ? [t - n.created_t < DAY ? 'CURING' : '', n.st.sprouted_t ? 'SPROUTED' : ''].filter(Boolean) : [];
    const unread = this.fileUnread(p);
    const matters = rows.filter((r) => !r.withheld && (MATTERS.has(r.kind) || (r.kind === 'dark_end' && r.dur_s >= HOUR)))
      .map((r) => ({ t: r.t, day: C.dayHeader(r.t, off), time: C.hm(r.t, off), text: r.text, note: r.note, kind: r.kind, unread: r.t > (p.file_read_t || 0) }));
    const H = F.header;
    return {
      id: p.id, name: p.name, variety: this.variety(p.variety), seed: p.seed, claim_code: p.claim_code,
      standing: this.standingLabel(p, t), neighbor: n ? { name: n.name, id: n.id, tags: neighborTags } : null, neighborLine,
      neighborAside: n ? fill(H.did_not_choose, { name: p.name }) : '',
      sprouted: !!p.st.sprouted_t, curing: t - p.created_t < DAY, expression: this.standingScore(p, t, t - 7 * DAY) < -2 ? 'aggrieved' : 'neutral',
      unread, sinceLine: unread === 0 ? H.nothing_since : unread === 1 ? H.entry_since : fill(H.entries_since, { n: unread }),
      matters, days, offsetKnown: p.utc_offset_min != null, withheldText: F.withheld, emptyText: F.empty,
      newMarker: H.new_marker, footer: H.footer, mattersEmpty: H.matters_empty, readT: p.file_read_t || 0,
      ballot: this.fileBallot(p, t), touch: hasTouch(p.board),
    };
  }

  ack(code) {
    const p = this.resolveFile(code);
    if (!p) return false;
    const t = this.now();
    const F = this.pools.file.acknowledged;
    this.addEntry(p, { t, kind: 'acknowledged', text: F.text });
    this.store.run('UPDATE potatoes SET file_read_t = ? WHERE id = ?', t, p.id);
    return fill(this.pools.file.header.acknowledged, { NAME: p.name.toUpperCase() });
  }

  // ------------------------------------------------------------------ heartbeat
  heartbeat(body = {}) {
    this.tick(); // before loading the potato: the tick may settle and save its state
    const p = this.requirePotato(body.secret);
    const t = this.now();
    const prevSeen = p.last_seen_t;
    const b = body.battery && typeof body.battery === 'object' ? body.battery : {};
    const orientation = ORIENTATIONS.has(body.orientation) ? body.orientation : p.orientation || 'up';
    const sound = SOUNDS.has(body.sound) ? body.sound : 'quiet';
    const since = Math.max(0, num(body.since_handled_s, 0));
    const off = Number.isFinite(Number(body.utc_offset_min)) ? Math.max(-840, Math.min(840, Math.round(Number(body.utc_offset_min)))) : p.utc_offset_min;
    // The running firmware and board come with every heartbeat: after an OTA the server sees which version actually stuck.
    const board = typeof body.board === 'string' && /^[a-z0-9]{1,32}$/.test(body.board) ? body.board : p.board;
    const fw = typeof body.fw === 'string' && /^[\w.+-]{1,32}$/.test(body.fw) ? body.fw : p.fw;
    this.store.run(
      `UPDATE potatoes SET last_seen_t = ?, battery_pct = ?, charging = ?, vbus = ?, orientation = ?, since_handled_s = ?, sound = ?, temp_c = ?, utc_offset_min = ?, board = ?, fw = ? WHERE id = ?`,
      t, b.pct == null ? null : Math.round(num(b.pct)), b.charging ? 1 : 0, b.vbus ? 1 : 0, orientation, since, sound,
      body.temp_c == null ? null : num(body.temp_c), off ?? null, board, fw, p.id);
    Object.assign(p, { last_seen_t: t, battery_pct: b.pct == null ? null : Math.round(num(b.pct)), charging: b.charging ? 1 : 0, vbus: b.vbus ? 1 : 0, orientation, since_handled_s: since, sound, utc_offset_min: off ?? null, board, fw });

    const events = (Array.isArray(body.events) ? body.events : [])
      .filter((e) => e && EVENT_TYPES.has(e.type))
      .map((e) => ({ ...e, t: num(e.t) > 1e9 && num(e.t) <= t + 5 * MIN ? Math.round(num(e.t)) : t }))
      .sort((a, b2) => a.t - b2.t);

    // A gap the device didn't explain is still a gap.
    const explained = events.some((e) => e.type === 'dormant_resume' || e.type === 'wifi_restore');
    if (t - prevSeen > C.DORMANT_S && !explained) this.addPower(p, t, { type: 'silent', dur_s: t - prevSeen });

    const applied = [];
    for (const ev of events) {
      const r = this.store.run(
        'INSERT OR IGNORE INTO events(potato_id, t, type, dur_s, pct, request_id, received_t) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.id, ev.t, ev.type, ev.dur_s == null ? null : Math.round(num(ev.dur_s)), ev.pct == null ? null : Math.round(num(ev.pct)),
        ev.request_id == null ? null : String(ev.request_id), t);
      if (r.changes && this.applyEvent(p, ev)) applied.push(ev);
    }
    this.settle(p, t);
    this.noteReaction(p, applied, t);
    if (p.orientation !== 'down' && p.st.dark_since && !events.some((e) => e.type === 'facedown_end')) p.st.dark_since = null;
    if (p.orientation !== 'inverted' && p.st.inverted_since && !events.some((e) => e.type === 'inverted_end')) p.st.inverted_since = null;
    this.applyIdle(p, this.sinceHandled(p, t), t);
    this.maybeIssueRequest(p, t);
    this.save(p);
    return this.scene(p, t);
  }

  // Seconds since the Hands last finished with it. Raw handling resets it; only the File is folded.
  sinceHandled(p, t) {
    const st = p.st;
    if (st.pick) return 0;
    if (st.last_handled_t) return Math.max(0, t - st.last_handled_t);
    return Math.max(0, Math.min(t - p.created_t, (p.since_handled_s || 0) + (t - p.last_seen_t)));
  }

  durSec(s) { s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
  countWords(n) { return n <= 10 ? numberWords(n) : String(n); }

  // Flavor notes land on about a third of the entries that deserve one, by seed; the rest stay bare.
  noteFor(p, kind, t, note, essential = false) {
    if (!note) return '';
    return essential || h32(p.seed, 'note', kind, Math.round(t)) % 3 === 0 ? note : '';
  }

  // The first handling of a day is presence: it reaches Standing through a hidden entry the File never shows.
  presence(p, t) {
    const day = C.dayKey(t);
    if (p.st.presence_day === day) return;
    p.st.presence_day = day;
    this.addEntry(p, { t, kind: 'nudge', text: '', standing: 1 });
  }

  handled(p, t) {
    const st = p.st;
    st.last_handled_t = Math.max(st.last_handled_t || 0, t);
    st.idle_mark = 0;
    if (st.sprouted_t && !st.sprout_clear_t) st.sprout_clear_t = t + DAY;
  }

  // Everything the ration holds back: open pickups, handling episodes, tap and shake runs, power episodes, the dark.
  settle(p, now) {
    const st = p.st, F = this.pools.file;
    if (st.pick && now - st.pick.start_t > 10 * MIN) this.endPick(p, st.pick.start_t + RATION_S, false); // never put down: duration unknown
    if (st.handling && now - st.handling.end_t > EPISODE_GAP_S) this.closeHandling(p);
    if (st.taps && now - st.taps.last_t > EPISODE_GAP_S) this.closeTaps(p);
    if (st.shakes && now - st.shakes.last_t > EPISODE_GAP_S) this.closeShakes(p);
    if (st.power && now - st.power.last_t > (st.power.dormancies.length ? 30 * MIN : 12 * HOUR)) this.closePower(p);
    if (st.charge_pending && now - st.charge_pending.t > RATION_S) { this.fileCharge(p, st.charge_pending); st.charge_pending = null; }
    if (st.dark_since && !st.dark_filed && now - st.dark_since >= RATION_S) {
      this.addEntry(p, { t: st.dark_since, kind: 'dark_start', text: F.dark_start.text });
      st.dark_filed = true;
    }
    if (st.inverted_since && !st.inverted_filed && now - st.inverted_since >= RATION_S) {
      this.addEntry(p, { t: st.inverted_since, kind: 'ceiling_start', text: F.ceiling_start.text });
      st.inverted_filed = true;
    }
  }

  // A pickup ends at its putdown (known duration) or, failing one, a minute in (unknown).
  endPick(p, t, known) {
    const st = p.st, pk = st.pick;
    st.pick = null;
    if (!pk) return;
    const session = { s: pk.start_t, e: t, dur: Math.max(0, t - pk.start_t), known };
    if (st.handling && pk.start_t - st.handling.end_t > EPISODE_GAP_S) this.closeHandling(p);
    if (!st.handling) st.handling = { start_t: pk.start_t, end_t: t, sessions: [] };
    st.handling.sessions.push(session);
    st.handling.end_t = Math.max(st.handling.end_t, t);
    this.handled(p, t);
  }

  // One entry per episode, if it earned one.
  closeHandling(p) {
    const st = p.st, ep = st.handling, F = this.pools.file;
    st.handling = null;
    if (!ep) return;
    const q = ep.sessions.filter((x) => !x.known || x.dur >= PICK_MIN_S);
    if (!q.length) return;
    if (q.length === 1) {
      const x = q[0];
      if (x.known && x.dur < PICK_ALONE_S) return; // four to nine seconds, alone: not a record
      this.addEntry(p, { t: x.s, kind: 'pickup', text: x.known ? fill(F.pickup.text_dur, { dur: this.durSec(x.dur) }) : F.pickup.text, dur_s: x.dur });
      return;
    }
    const span = Math.max(1, Math.round((ep.end_t - ep.start_t) / MIN));
    const total = q.reduce((a, x) => a + (x.known ? x.dur : 0), 0);
    this.addEntry(p, {
      t: ep.start_t, kind: 'handled', dur_s: total,
      text: fill(F.handled.text, { count: this.countWords(q.length), span: this.countWords(span), s: span === 1 ? '' : 's', total: this.durSec(total) }),
      note: this.noteFor(p, 'handled', ep.start_t, F.handled.note),
    });
  }

  // Two or more taps within five minutes are one entry; a single tap is nothing.
  closeTaps(p) {
    const st = p.st, ts = st.taps, F = this.pools.file.tap;
    st.taps = null;
    if (!ts || ts.count < 2) return;
    this.addEntry(p, { t: ts.start_t, kind: 'tap', text: fill(F.text_times, { count: capitalize(this.countWords(ts.count)) }) });
  }

  closeShakes(p) {
    const st = p.st, sh = st.shakes, F = this.pools.file.shake;
    st.shakes = null;
    if (!sh) return;
    this.addEntry(p, { t: sh.start_t, kind: 'shake', text: sh.count === 1 ? F.text : fill(F.text_times, { count: capitalize(this.countWords(sh.count)) }), standing: -sh.count });
  }

  // Power: thresholds, dormancy, the gap and the waking fold into one episode per outage.
  addPower(p, t, ev) {
    const st = p.st;
    if (st.power && t - st.power.last_t > 12 * HOUR) this.closePower(p);
    if (!st.power) st.power = { start_t: t, last_t: t, thresholds: [], dormancies: [], silent: 0 };
    const pw = st.power;
    pw.last_t = Math.max(pw.last_t, t);
    if (ev.type === 'battery_low') { pw.thresholds.push({ t, pct: ev.pct }); st.last_low_pct = ev.pct; }
    else if (ev.type === 'silent') pw.silent += ev.dur_s;
    else if (ev.type === 'dormant_resume') {
      const t0 = t - ev.dur_s;
      pw.dormancies.push({ t, dur: ev.dur_s, pct: st.last_low_pct ?? null, present: (t0 - (st.last_handled_t || 0)) < HOUR });
      st.last_low_pct = null;
    }
  }

  closePower(p) {
    const st = p.st, pw = st.power, F = this.pools.file.power;
    st.power = null;
    if (!pw) return;
    const d = pw.dormancies;
    let text, standing = 0, t = pw.last_t, dur_s = 0;
    if (d.length) {
      text = fill(F.returned, { dur: durShort(d[0].dur) });
      if (d.length >= 2) text += d[1].pct != null ? fill(F.again, { pct: d[1].pct }) : F.again_nopct;
      for (const x of d) { standing -= x.present ? 1 : 1.5; dur_s += x.dur; }
      t = d[d.length - 1].t;
    } else if (pw.silent > 0) {
      text = fill(this.pools.file.silent.text, { dur: durShort(pw.silent) }); dur_s = pw.silent;
    } else if (pw.thresholds.length) {
      text = fill(F.ran_down, { pct: Math.min(...pw.thresholds.map((x) => x.pct)) });
    } else return;
    const staged = d.length >= 2 || (d.length >= 1 && pw.thresholds.length >= 2);
    const note = d.some((x) => x.dur >= 3 * DAY) ? F.note_cellar : staged ? F.note : '';
    this.addEntry(p, { t, kind: 'power', text, note: this.noteFor(p, 'power', t, note), standing, dur_s });
  }

  fileCharge(p, pend) {
    const F = this.pools.file[pend.type];
    this.addEntry(p, { t: pend.t, kind: pend.type, text: F.text });
  }

  // Events in this heartbeat outrank steady state. The most severe one speaks; the rest are filed.
  static severity(ev) {
    const d = Math.max(0, num(ev.dur_s));
    switch (ev.type) {
      case 'drop': return 100;
      case 'facedown_end': return d >= HOUR ? 90 : 60;
      case 'inverted_end': return d >= 20 * MIN ? 80 : 60;
      case 'shake': return 70;
      case 'dormant_resume': return 65;
      case 'transit_end': return 55;
      case 'wifi_restore': return 50;
      case 'loud': return 45;
      case 'pickup': case 'putdown': case 'tap': case 'transit_start': return 40;
      case 'charge_start': case 'charge_end': case 'battery_low': return 20;
      default: return 0;
    }
  }
  // Major reactions (≥ 60) hold the line for ten minutes and outrank the Question's buttons; minor ones for two.
  reactionWindow(rx) { return rx.sev >= 60 ? 10 * MIN : 2 * MIN; }

  noteReaction(p, events, t) {
    let best = null;
    for (const ev of events) {
      const sev = World.severity(ev);
      if (sev > 0 && (!best || sev >= best.sev)) best = { at: t, type: ev.type, dur_s: Math.max(0, num(ev.dur_s)), pct: ev.pct == null ? null : Math.round(num(ev.pct)), sev };
    }
    if (!best) return;
    const cur = p.st.reaction;
    if (cur && t - cur.at < this.reactionWindow(cur) && cur.sev > best.sev) return; // a bigger grievance is still speaking
    // The reaction carries its own sequence number so the line is a pure
    // function of (seed, type, n): stable while the window holds, and the
    // pool's bag position survives a server restart with the rest of st.
    const counts = p.st.rx_n || (p.st.rx_n = {});
    best.n = counts[best.type] = (counts[best.type] || 0) + 1;
    p.st.reaction = best;
  }

  // The nth reaction of a type walks its pool as a bag: one full pass in a
  // seeded order before any line returns, and a new pass never opens with
  // the line the old one closed on. n is 1-based.
  bagLine(p, key, arr, n1) {
    if (!arr || !arr.length) return '';
    const n = arr.length;
    if (n === 1) return arr[0];
    const k = Math.max(0, (n1 || 1) - 1);
    if (n === 2) return arr[(h32(p.seed, key) + k) % 2]; // strict alternation
    const cycle = Math.floor(k / n), at = k % n;
    const order = bagOrder(n, p.seed, key, cycle);
    if (cycle > 0) {
      const prev = bagOrder(n, p.seed, key, cycle - 1);
      if (order[0] === prev[n - 1]) [order[0], order[1]] = [order[1], order[0]];
    }
    return arr[order[at]];
  }

  reactionLine(p, rx) {
    const R = this.pools.reactions, CH = this.pools.charging, st = p.st;
    const sp = (pool, ...salts) => pick((Array.isArray(pool) ? pool : [pool]).filter((x) => x), p.seed, ...salts) || '';
    switch (rx.type) {
      case 'drop': return { line: sp(R.drop, 'drop', rx.at), expression: 'aggrieved' };
      case 'facedown_end': return { line: fill(sp(R.dark.restored, 'restored', st.dark_count || 0), { duration_words: durWords(rx.dur_s) }), expression: 'aggrieved' };
      case 'inverted_end': return { line: sp(R.ceiling.restored, 'ceilrestored'), expression: 'aggrieved' };
      case 'shake': return { line: sp(R.shake, 'shake', st.shake_count || 0), expression: 'aggrieved' };
      case 'dormant_resume': return { line: rx.dur_s >= 3 * DAY ? sp(CH.waking_3d, 'wake3') : sp(CH.waking, 'wake', rx.at), expression: 'neutral' };
      case 'transit_end': return { line: sp(R.transit.settled, 'settled', rx.at), expression: 'neutral' };
      case 'transit_start': return { line: sp(R.transit.start, 'transit'), expression: 'neutral' };
      case 'wifi_restore': {
        const n = Math.floor(rx.dur_s / (12 * HOUR));
        if (n < 1) return null;
        return { line: n > 20 ? sp(R.wifi_restored_many, 'wifimany') : fill(sp(R.wifi_restored, 'wifi'), { n_words: numberWords(n) }), expression: 'neutral' };
      }
      case 'loud': return { line: h32(p.seed, 'horns') % 7 === 0 ? sp(R.loud_rare, 'loudr') : sp(R.loud, 'loud', st.loud_count || 0), expression: 'aggrieved' };
      case 'pickup': {
        // Every tenth pick-up is this potato's own rare line — the signature
        // the seed gave it. The rest walk the core pool as a bag; the bag
        // position skips the pick-ups the rare line took.
        const rare = R.pickup_rare || [];
        const n1 = rx.n || 1, ph = h32(p.seed, 'rarephase') % 10;
        if (rare.length && n1 % 10 === ph)
          return { line: rare[h32(p.seed, 'raresig') % rare.length], expression: 'neutral' };
        const rares = ph === 0 ? Math.floor(n1 / 10) : n1 >= ph ? Math.floor((n1 - ph) / 10) + 1 : 0;
        return { line: this.bagLine(p, 'pickup', R.pickup, n1 - rares), expression: 'neutral' };
      }
      case 'putdown': return { line: this.bagLine(p, 'putdown', R.putdown, rx.n), expression: 'neutral' };
      case 'tap': return { line: this.bagLine(p, 'tap', R.tap, rx.n), expression: 'neutral' };
      case 'charge_start': return { line: sp(CH.plugged, 'plugged', rx.at), expression: 'neutral' };
      case 'charge_end': return { line: sp(CH.unplugged, 'unplugged'), expression: 'neutral' };
      case 'battery_low': {
        const keys = Object.keys(CH.running_down || {}).map(Number).sort((a, b) => a - b);
        const k = keys.find((x) => x >= (rx.pct ?? 0)) ?? keys[keys.length - 1];
        return k == null ? null : { line: CH.running_down[String(k)], expression: 'neutral' };
      }
      default: return null;
    }
  }

  // Returns true when the event is a fresh reaction (it may speak); the File is folded separately.
  applyEvent(p, ev) {
    const t = ev.t, st = p.st, F = this.pools.file;
    const dur = Math.max(0, num(ev.dur_s));
    const day = C.dayKey(t);
    if (HANDLING.has(ev.type)) this.presence(p, t);

    switch (ev.type) {
      case 'pickup': {
        if (st.pick) this.endPick(p, t, true); // a second pickup ends the first; its length is known
        const fresh = !st.handling || t - st.handling.end_t > EPISODE_GAP_S;
        if (st.handling && t - st.handling.end_t > EPISODE_GAP_S) this.closeHandling(p);
        st.pick = { start_t: t };
        if (st.taps) this.closeTaps(p);
        this.handled(p, t);
        if (st.pickup_day !== day) { st.pickup_day = day; st.first_pickup_t = t; this.neighborEntry(p, t, 'neighbor_pickup'); }
        return fresh;
      }
      case 'putdown': if (st.pick) this.endPick(p, t, true); else this.handled(p, t); return false; // never a "Put down" row
      case 'tap': {
        if (st.pick) { this.handled(p, t); return false; } // a tap while held folds into the handling
        if (st.taps && t - st.taps.last_t <= EPISODE_GAP_S) { st.taps.count += 1; st.taps.last_t = t; this.handled(p, t); return false; }
        if (st.taps) this.closeTaps(p);
        st.taps = { start_t: t, last_t: t, count: 1 };
        this.handled(p, t);
        return true;
      }
      case 'facedown_start': st.dark_since = t; st.dark_filed = false; this.handled(p, t); return false;
      case 'facedown_end': {
        const d = dur || (st.dark_since ? t - st.dark_since : 0);
        const since = st.dark_since;
        st.dark_since = null;
        if (d < RATION_S) { st.dark_filed = false; return false; }
        if (!st.dark_filed) this.addEntry(p, { t: since ?? t - d, kind: 'dark_start', text: F.dark_start.text });
        st.dark_filed = false;
        st.dark_restored_t = t; st.dark_restored_dur = d;
        st.dark_count = (st.dark_count || 0) + 1;
        const note = d >= HOUR ? F.dark_end.note_long : '';
        this.addEntry(p, { t, kind: 'dark_end', text: fill(F.dark_end.text, { dur: durShort(d) }), note: this.noteFor(p, 'dark_end', t, note), standing: -Math.min(4, d / HOUR), dur_s: d });
        if (d >= HOUR) this.neighborEntry(p, t, 'neighbor_dark', { dur: durShort(d), dur_s: d });
        this.handled(p, t); return true;
      }
      case 'inverted_start': st.inverted_since = t; st.inverted_filed = false; this.handled(p, t); return false;
      case 'inverted_end': {
        const d = dur || (st.inverted_since ? t - st.inverted_since : 0);
        const since = st.inverted_since;
        st.inverted_since = null;
        if (d < RATION_S) { st.inverted_filed = false; return false; }
        if (!st.inverted_filed) this.addEntry(p, { t: since ?? t - d, kind: 'ceiling_start', text: F.ceiling_start.text });
        st.inverted_filed = false;
        st.ceiling_restored_t = t;
        const note = d >= 20 * MIN ? F.ceiling_end.note_long : '';
        this.addEntry(p, { t, kind: 'ceiling_end', text: fill(F.ceiling_end.text, { dur: durShort(d) }), note: this.noteFor(p, 'ceiling_end', t, note), standing: -Math.min(3, d / (20 * MIN)), dur_s: d });
        this.handled(p, t); return true;
      }
      case 'shake': {
        if (st.shakes && t - st.shakes.last_t <= EPISODE_GAP_S) { st.shakes.count += 1; st.shakes.last_t = t; }
        else { if (st.shakes) this.closeShakes(p); st.shakes = { start_t: t, last_t: t, count: 1 }; this.neighborEntry(p, t, 'neighbor_shake'); }
        st.shake_count = st.shakes.count;
        this.handled(p, t); return true;
      }
      case 'drop': {
        this.addEntry(p, { t, kind: 'drop', text: F.drop.text, note: this.noteFor(p, 'drop', t, F.drop.note), standing: -2 });
        this.store.setMeta('last_drop_t', t);
        this.neighborEntry(p, t, 'neighbor_drop');
        this.handled(p, t); return true;
      }
      case 'transit_start': st.transit_since = t; this.addEntry(p, { t, kind: 'transit_start', text: F.transit_start.text }); this.handled(p, t); return true;
      case 'transit_end': {
        const d = dur || (st.transit_since ? t - st.transit_since : 0);
        st.transit_since = null;
        this.addEntry(p, { t, kind: 'transit_end', text: fill(F.transit_end.text, { dur: durShort(d) }), note: this.noteFor(p, 'transit_end', t, F.transit_end.note), dur_s: d });
        this.handled(p, t); return true;
      }
      case 'charge_start': case 'charge_end': {
        if (ev.type === 'charge_end') st.last_charge_end_t = t;
        st.charge_since = ev.type === 'charge_start' ? t : null;
        const pend = st.charge_pending;
        if (pend && pend.type !== ev.type && t - pend.t <= RATION_S) {
          st.charge_pending = null;
          if (st.reaction && st.reaction.type.startsWith('charge_')) st.reaction = null;
          return false;
        }
        if (pend) this.fileCharge(p, pend);
        st.charge_pending = { type: ev.type, t };
        return true;
      }
      case 'battery_low': {
        if (st.last_charge_end_t && t - st.last_charge_end_t <= RATION_S) return false;
        this.addPower(p, t, { type: 'battery_low', pct: Math.round(num(ev.pct, 0)) });
        st.last_low_t = t;
        return true;
      }
      case 'dormant_resume': this.addPower(p, t, { type: 'dormant_resume', dur_s: dur }); return true;
      case 'wifi_restore': {
        const n = Math.floor(dur / (12 * HOUR));
        this.addEntry(p, { t, kind: 'wifi_restore', text: fill(F.wifi_restore.text, { dur: durShort(dur) }), note: n > 0 ? this.noteFor(p, 'wifi_restore', t, fill(F.wifi_restore.note, { n })) : '', dur_s: dur });
        return true;
      }
      case 'loud': {
        const horns = h32(p.seed, 'horns') % 7 === 0;
        st.loud_count = (st.loud_count || 0) + 1;
        if (horns) st.horns_count = (st.horns_count || 0) + 1;
        this.addEntry(p, { t, kind: 'loud', text: F.loud.text, note: horns ? this.noteFor(p, 'loud', t, F.loud.note_rare) : '' });
        return true;
      }
      case 'request_done': this.resolveRequest(p, ev.request_id, 'done', t); return false;
      case 'request_expired': this.resolveRequest(p, ev.request_id, 'expired', t); return false;
      default: return false;
    }
  }

  // Left alone: thresholds from the device's since_handled_s. One entry per threshold per idle stretch.
  applyIdle(p, since, t) {
    const st = p.st, Q = this.pools.file.quiet;
    if (st.sprout_clear_t && t >= st.sprout_clear_t) { st.sprouted_t = null; st.sprout_clear_t = null; }
    if (since < IDLE_STEPS[0][0]) { st.idle_mark = 0; return; }
    for (const [th, key] of IDLE_STEPS) {
      if (since < th || (st.idle_mark || 0) >= th) continue;
      const at = Math.max(p.created_t, t - (since - th));
      const T = Q[key];
      let note = T.note || '';
      if (key === '8h') {
        const again = this.store.get('SELECT 1 FROM entries WHERE potato_id = ? AND kind = ? AND t > ? AND t < ?', p.id, 'quiet_8h', at - 14 * DAY, at);
        note = again ? T.note_again : '';
      }
      if (key === '7d') {
        st.sprouted_t = at; st.sprout_clear_t = null;
        this.addEntry(p, { t: at, kind: 'sprouted', text: T.text, note, standing: -1 });
      } else {
        this.addEntry(p, { t: at, kind: `quiet_${key}`, text: T.text, note, standing: key === '8h' ? -0.25 : 0 });
      }
      st.idle_mark = th;
    }
  }

  // ------------------------------------------------------------------ requests
  requestDef(kind) { return (this.pools.requests.requests || []).find((r) => r.id === kind) || null; }
  openRequest(p, t) { return this.store.get('SELECT * FROM requests WHERE potato_id = ? AND outcome IS NULL AND expires_t > ? ORDER BY issued_t DESC LIMIT 1', p.id, t); }

  maybeIssueRequest(p, t) {
    if (this.activeBroadcast('silence', t)) return;
    if (this.openRequest(p, t)) return;
    if (p.orientation === 'down') return; // it can't see the screen
    if (p.st.sprouted_t || this.sinceHandled(p, t) >= DAY) return; // nobody is there to ask
    const st = p.st, day = C.dayKey(t), ds = C.dayStart(t);
    if (!st.req || st.req.day !== day) st.req = { day, slots: [] };
    const quota = 2 + (h32(p.seed, day, 'rq') % 2); // two or three a day
    const qOpen = this.questionOpen(t);
    for (let i = 0; i < quota; i++) {
      if (st.req.slots.includes(i)) continue;
      const slotT = ds + (7 + (h32(p.seed, day, 'slot', i) % 14)) * HOUR + (h32(p.seed, day, 'slotm', i) % 60) * MIN;
      if (t < slotT) continue;
      st.req.slots.push(i);
      if (t - slotT > 3 * HOUR) continue; // the moment passed while it was away
      const defs = (this.pools.requests.requests || []).filter((r) => !(r.choices && qOpen) && !(r.id === 'facedown' && p.orientation === 'down'));
      const def = pick(defs, p.seed, day, 'rk', i);
      if (def) this.issueRequest(p, def.id, t, i);
      return;
    }
  }

  // Ask the Hands for something. Returns the request row, or null if the kind is unknown.
  issueRequest(p, kind, t = this.now(), slot = 0) {
    const def = this.requestDef(kind);
    if (!def) return null;
    const n = Number(this.store.meta('next_request', '1'));
    this.store.setMeta('next_request', n + 1);
    const ttl = num(this.pools.requests.ttl_s, C.REQUEST_TTL_S);
    this.store.run('INSERT INTO requests(id, potato_id, kind, text, chk, for_s, issued_t, expires_t, day, slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `r${n}`, p.id, def.id, def.text, def.check, num(def.for_s), t, t + ttl, C.dayKey(t), slot);
    return this.store.get('SELECT * FROM requests WHERE id = ?', `r${n}`);
  }

  resolveRequest(p, id, outcome, t) {
    const r = this.store.get('SELECT * FROM requests WHERE id = ? AND potato_id = ?', String(id || ''), p.id);
    if (!r || r.outcome) return;
    const def = this.requestDef(r.kind) || {};
    const F = this.pools.file.request;
    this.store.run('UPDATE requests SET outcome = ?, outcome_t = ? WHERE id = ?', outcome, t, r.id);
    const done = outcome === 'done';
    const note = done ? fill(F.complied, { dur: durShort(t - r.issued_t) }) : (def.not_done ? F.declined : F.expired);
    this.addEntry(p, { t: r.issued_t, kind: `request_${outcome}`, text: fill(F.text, { request: requestShort(r.text) }), note: this.noteFor(p, `request_${outcome}`, r.issued_t, note, true), standing: done ? 1 : (def.not_done ? -1 : 0), dur_s: t - r.issued_t });
    p.st.last_request_outcome = { t, outcome, line: done ? def.done : def.not_done || '' };
  }

  expireRequests(t) {
    for (const r of this.store.all('SELECT * FROM requests WHERE outcome IS NULL AND expires_t <= ?', t)) {
      const p = this.byId(r.potato_id);
      if (!p) continue;
      this.resolveRequest(p, r.id, 'expired', r.expires_t);
      this.save(p);
    }
  }

  // ------------------------------------------------------------------ broadcasts
  activeBroadcast(type, t) {
    for (const b of this.data.broadcasts) {
      if (!b || b.type !== type) continue;
      const from = b.from ? iso(b.from) : 0, to = b.to ? iso(b.to) : Infinity;
      if (Number.isFinite(from) && t >= from && t < to) return { ...b, from_t: from, to_t: to };
    }
    return null;
  }

  // ------------------------------------------------------------------ the Question
  dayIndex(day) { return Math.round((C.dayStartOfKey(day) - C.dayStartOfKey(this.store.meta('net_open_day'))) / DAY); }
  questionRow(day) { return this.store.get('SELECT * FROM question_days WHERE day = ?', day); }
  questionFor(day) { const r = this.questionRow(day); return r && r.question_id ? this.data.question(r.question_id) : null; }
  questionOpen(t) {
    const row = this.questionRow(C.dayKey(t));
    return !!(row && row.question_id && !row.closed && t >= C.openAt(t) && t < C.closeAt(t) && !this.activeBroadcast('silence', t));
  }

  ensureDayQuestion(day, ds) {
    const existing = this.questionRow(day);
    if (existing) return existing;
    let qid = null;
    const silent = this.activeBroadcast('silence', ds + C.OPEN_H * HOUR);
    if (!silent) {
      const dropped = this.store.get('SELECT 1 FROM entries WHERE kind = ? AND t >= ? AND t < ?', 'drop', ds - DAY, ds);
      const qs = this.data.questions.filter((q) => q && q.id && Array.isArray(q.options));
      const triggered = dropped ? qs.find((q) => q.trigger === 'after_drop') : null;
      if (triggered) qid = triggered.id;
      else {
        let best = null, bestDay = null;
        for (const q of qs) {
          if (q.trigger) continue;
          const last = this.store.get('SELECT MAX(day) d FROM question_days WHERE question_id = ?', q.id).d;
          if (!best || (last || '') < (bestDay || '')) { best = q; bestDay = last; }
          if (!last) break; // never asked: file order wins
        }
        qid = best ? best.id : null;
      }
    }
    this.store.run('INSERT OR IGNORE INTO question_days(day, question_id) VALUES (?, ?)', day, qid);
    return this.questionRow(day);
  }

  closeQuestion(day, ds) {
    const row = this.questionRow(day);
    if (!row || row.closed) return;
    const q = row.question_id ? this.data.question(row.question_id) : null;
    const closeT = ds + C.CLOSE_H * HOUR;
    const F = this.pools.file;
    this.store.tx(() => {
      let tally = null;
      if (q) {
        const members = this.store.all('SELECT * FROM potatoes WHERE created_t <= ? AND last_seen_t >= ?', closeT, closeT - C.MISSING_S).map((r) => this.load(r));
        const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
        const votes = new Map();
        for (const m of members) {
          let v = this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', day, m.id);
          if (!v && q.options.length) {
            const opt = q.options[h32(m.seed, q.id, day) % q.options.length];
            this.store.run('INSERT INTO votes(day, potato_id, choice_id, by_hands, t) VALUES (?, ?, ?, 0, ?)', day, m.id, opt.id, closeT);
            v = { day, potato_id: m.id, choice_id: opt.id, by_hands: 0, t: closeT };
          }
          if (v) { counts[v.choice_id] = (counts[v.choice_id] || 0) + 1; votes.set(m.id, v); }
        }
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const max = Math.max(0, ...Object.values(counts));
        const winners = total ? q.options.filter((o) => counts[o.id] === max).map((o) => o.id) : [];
        tally = { question_id: q.id, counts, total, winners, withdrawn: !!q.withdrawn, pct: Object.fromEntries(q.options.map((o) => [o.id, pct(counts[o.id] || 0, total)])) };
        for (const m of members) {
          const v = votes.get(m.id);
          const label = v ? sayLabel((q.options.find((o) => o.id === v.choice_id) || {}).label || v.choice_id) : '';
          if (q.withdrawn || !q.options.length) {
            this.addEntry(m, { t: closeT, kind: 'question_withdrawn', text: fill(F.question_withdrawn.text, { topic: q.topic }), note: F.question_withdrawn.note });
          } else if (v.by_hands) {
            this.addEntry(m, { t: closeT, kind: 'question_present', text: fill(F.question_present.text, { topic: q.topic }), note: fill(F.question_present.note, { choice: label }), standing: winners.includes(v.choice_id) ? 0.5 : 0 });
          } else {
            this.addEntry(m, { t: closeT, kind: 'question_absent', text: F.question_absent.text, note: fill(F.question_absent.note, { choice: label }), standing: -0.5 });
          }
        }
      }
      this.store.run('UPDATE question_days SET closed = 1, tally = ? WHERE day = ?', tally ? JSON.stringify(tally) : null, day);
    });
  }

  tally(day) { const r = this.questionRow(day); return r && r.tally ? JSON.parse(r.tally) : null; }

  countOutcome(p, day) {
    const tally = this.tally(day);
    if (!tally) return null;
    const q = this.data.question(tally.question_id);
    const v = this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', day, p.id);
    if (tally.withdrawn || !q || !q.options.length) return { kind: 'withdrawn' };
    if (!v) return null;
    const opt = q.options.find((o) => o.id === v.choice_id) || { label: v.choice_id };
    const fields = { choice: sayLabel(opt.short || opt.label), pct_words: numberWords(tally.pct[v.choice_id] || 0), pct: tally.pct[v.choice_id] || 0 };
    if (!v.by_hands) return { kind: 'alone', ...fields };
    return { kind: tally.winners.includes(v.choice_id) ? 'majority' : 'minority', ...fields };
  }

  // One vote per Question or event. A re-post of the same choice is idempotent; a different one is a recount, and the Council does not do those.
  castVote(p, choice_id, t) {
    const N = this.pools.net.count;
    choice_id = String(choice_id ?? '');
    const req = this.openRequest(p, t);
    const def = req ? this.requestDef(req.kind) : null;
    if (def && def.choices && def.choices.some((c) => c.id === choice_id)) {
      this.resolveRequest(p, req.id, 'done', t);
      this.save(p);
      return { status: 200 };
    }
    const day = C.dayKey(t);
    const row = this.questionRow(day);
    const q = row && row.question_id ? this.data.question(row.question_id) : null;
    const questionLive = !!(q && q.options.length && t >= C.openAt(t) && !row.closed && t < C.closeAt(t) && !this.activeBroadcast('silence', t));
    const ev = this.activeEvent(t);
    const evChoice = ev ? ev.choices.find((c) => c.id === choice_id) : null;
    if (evChoice && !(questionLive && q.options.some((o) => o.id === choice_id))) {
      const prior = this.eventVote(p, ev);
      if (prior) return prior.choice_id === evChoice.id ? { status: 200 } : { status: 409, line: pick(N.recount, p.seed, ev.id) };
      this.recordEventVote(p, ev, evChoice, t);
      return { status: 200 };
    }
    if (!q || !q.options.length || t < C.openAt(t) || this.activeBroadcast('silence', t)) {
      return { status: 409, line: fill(N.early, { open_time: `${C.hm(C.openAt(t))} UTC` }) };
    }
    if (row.closed || t >= C.closeAt(t)) return { status: 409, line: pick(N.late, p.seed, day) };
    const opt = q.options.find((o) => o.id === choice_id);
    if (!opt) return { status: 400, error: { error: 'unknown choice_id', choices: q.options.map((o) => o.id) } };
    const prior = this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', day, p.id);
    if (prior) return prior.choice_id === opt.id ? { status: 200 } : { status: 409, line: pick(N.recount, p.seed, day) };
    this.store.run('INSERT INTO votes(day, potato_id, choice_id, by_hands, t) VALUES (?, ?, ?, 1, ?)', day, p.id, opt.id, t);
    return { status: 200 };
  }

  choice({ secret, scene_rev, choice_id } = {}) {
    this.tick();
    const p = this.requirePotato(secret);
    const t = this.now();
    const r = this.castVote(p, choice_id, t);
    if (r.status === 400) throw new HttpError(400, r.error);
    if (Number.isFinite(Number(scene_rev)) && Number(scene_rev) !== p.scene_rev) this.log(`choice from ${p.id} against rev ${scene_rev} (current ${p.scene_rev}); accepted`);
    return { status: r.status, scene: this.scene(p, t, r.line ? { line: r.line, choices: [] } : null) };
  }

  // The File's ballot: live for boards without touch, read-only otherwise. Null when nothing is on the buttons.
  fileBallot(p, t) {
    const day = C.dayKey(t);
    const row = this.questionRow(day);
    const q = row && row.question_id ? this.data.question(row.question_id) : null;
    const open = this.questionOpen(t);
    const H = this.pools.file.header;
    const touch = hasTouch(p.board);
    if (open) {
      const vote = this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', day, p.id);
      return { kind: 'question', text: q.text, options: q.options.map((o) => ({ id: o.id, label: o.label })), voted: vote ? vote.choice_id : null, closes_at: C.closeAt(t), touch, canVote: !touch && !vote,
        aside: touch ? H.cast_on_potato : fill(H.cannot_tap, { name: p.name }) };
    }
    const ev = this.activeEvent(t);
    if (ev) {
      const vote = this.eventVote(p, ev);
      return { kind: 'event', text: ev.line || '', options: ev.choices.map((c) => ({ id: c.id, label: c.label })), voted: vote ? vote.choice_id : null, closes_at: ev.to_t, touch, canVote: !touch && !vote,
        aside: touch ? H.cast_on_potato : fill(H.cannot_tap, { name: p.name }) };
    }
    return null;
  }

  // POST /file/<token>/vote — the Hands of a potato that cannot be tapped.
  voteFromFile(key, choice_id) {
    this.tick();
    const p = this.resolveFile(key);
    if (!p) return null;
    if (hasTouch(p.board)) return { status: 403, line: this.pools.file.header.cast_on_potato };
    const t = this.now();
    const r = this.castVote(p, choice_id, t);
    return { status: r.status, line: r.status === 200 ? fill(this.pools.file.header.informed, { NAME: p.name.toUpperCase() }) : r.line || '' };
  }

  // ------------------------------------------------------------------ neighbors
  ensureNeighbors(t) {
    const week = C.weekKey(t);
    const members = this.active(t);
    const rows = new Map(this.store.all('SELECT potato_id, neighbor_id FROM neighbors WHERE week = ?', week).map((r) => [r.potato_id, r.neighbor_id]));
    const newcomers = members.filter((m) => !rows.has(m.id));
    if (!newcomers.length) return;
    const lonely = members.filter((m) => rows.has(m.id) && rows.get(m.id) === null);
    const pool = shuffle([...newcomers, ...lonely], this.random);
    const F = this.pools.file;
    this.store.tx(() => {
      for (let i = 0; i + 1 < pool.length; i += 2) {
        const [a, b] = [pool[i], pool[i + 1]];
        for (const [x, y] of [[a, b], [b, a]]) {
          this.store.run('INSERT INTO neighbors(week, potato_id, neighbor_id) VALUES (?, ?, ?) ON CONFLICT(week, potato_id) DO UPDATE SET neighbor_id = excluded.neighbor_id', week, x.id, y.id);
          this.addEntry(x, { t, kind: 'neighbor_assigned', text: fill(F.neighbor_assigned.text, { neighbor: y.name, id: y.id }), note: this.noteFor(x, 'neighbor_assigned', t, F.neighbor_assigned.note) });
        }
      }
      if (pool.length % 2 === 1) {
        const odd = pool[pool.length - 1];
        if (!rows.has(odd.id)) {
          this.store.run('INSERT INTO neighbors(week, potato_id, neighbor_id) VALUES (?, ?, NULL)', week, odd.id);
          this.addEntry(odd, { t, kind: 'no_neighbor', text: F.no_neighbor.text, note: this.noteFor(odd, 'no_neighbor', t, F.no_neighbor.note) });
        }
      }
    });
  }

  // ------------------------------------------------------------------ the tick
  // Idempotent. Advances the world to now(): Questions open and close, Bulletins print, neighbors rotate, requests expire.
  tick() {
    this.data.reload();
    const t = this.now();
    const today = C.dayKey(t);
    const from = this.store.meta('last_tick_day') || today;
    for (let ds = Math.min(C.dayStartOfKey(from), C.dayStart(t)); ds <= C.dayStart(t); ds += DAY) {
      const day = C.dayKey(ds);
      const row = this.ensureDayQuestion(day, ds);
      if (t >= ds + C.OPEN_H * HOUR && !row.opened) this.store.run('UPDATE question_days SET opened = 1 WHERE day = ?', day);
      this.ensureBulletin(day, 'morning', ds, t);
      if (t >= ds + C.CLOSE_H * HOUR && !row.closed) this.closeQuestion(day, ds);
      if (this.questionRow(day).closed) this.ensureBulletin(day, 'evening', ds, t);
    }
    this.store.setMeta('last_tick_day', today);
    this.ensureNeighbors(t);
    this.expireRequests(t);
    this.settleEvents(t);
    for (const p of this.active(t)) {
      const st = p.st;
      if (!st.pick && !st.handling && !st.taps && !st.shakes && !st.power && !st.charge_pending && !(st.dark_since && !st.dark_filed) && !(st.inverted_since && !st.inverted_filed)) continue;
      this.settle(p, t);
      this.save(p);
    }
  }

  // ------------------------------------------------------------------ aggregates
  dayStats(ds) {
    const de = ds + DAY;
    const n = (sql, ...p) => this.store.get(sql, ...p).n || 0;
    const mx = (sql, ...p) => this.store.get(sql, ...p).m || 0;
    return {
      left_home: n(`SELECT COUNT(DISTINCT potato_id) n FROM entries WHERE kind = 'quiet_8h' AND t >= ? AND t < ?`, ds, de),
      dark6: n(`SELECT COUNT(DISTINCT potato_id) n FROM entries WHERE kind = 'dark_end' AND dur_s >= 21600 AND t >= ? AND t < ?`, ds, de),
      dark_hours: Math.round(n(`SELECT COALESCE(SUM(dur_s), 0) n FROM entries WHERE kind = 'dark_end' AND t >= ? AND t < ?`, ds, de) / HOUR),
      shakes: n(`SELECT COUNT(*) n FROM events WHERE type = 'shake' AND t >= ? AND t < ?`, ds, de),
      drops: n(`SELECT COUNT(*) n FROM entries WHERE kind = 'drop' AND t >= ? AND t < ?`, ds, de),
      drop_t: mx(`SELECT MIN(t) m FROM entries WHERE kind = 'drop' AND t >= ? AND t < ?`, ds, de),
      ceiling: n(`SELECT COUNT(*) n FROM entries WHERE kind = 'ceiling_end' AND t >= ? AND t < ?`, ds, de),
      ceiling_max: mx(`SELECT MAX(dur_s) m FROM entries WHERE kind = 'ceiling_end' AND t >= ? AND t < ?`, ds, de),
      transit: n(`SELECT COUNT(DISTINCT potato_id) n FROM entries WHERE kind = 'transit_end' AND t >= ? AND t < ?`, ds, de),
      transit_max: mx(`SELECT MAX(dur_s) m FROM entries WHERE kind = 'transit_end' AND t >= ? AND t < ?`, ds, de),
      dormant: n(`SELECT COUNT(DISTINCT potato_id) n FROM entries WHERE kind = 'power' AND dur_s > 0 AND t >= ? AND t < ?`, ds, de),
      night_touch: new Set(this.store.all(`SELECT potato_id, t FROM events WHERE type = 'pickup' AND t >= ? AND t < ?`, ds, de).filter((e) => { const hh = C.hourOf(e.t); return hh >= 23 || hh < 5; }).map((e) => e.potato_id)).size,
      new_members: n(`SELECT COUNT(*) n FROM potatoes WHERE created_t >= ? AND created_t < ?`, ds, de),
      hum: this.store.all('SELECT seed FROM potatoes WHERE created_t < ? AND last_seen_t >= ?', de, ds - C.MISSING_S).filter((r) => this.humPick(r.seed, C.dayKey(ds))).length,
      pickups: n(`SELECT COUNT(*) n FROM entries WHERE kind = 'pickup' AND t >= ? AND t < ?`, ds, de),
    };
  }

  humPick(seed, day) { return h32(seed, day, 'hum') % 100 < 3; }

  // ------------------------------------------------------------------ bulletins
  bulletinNo(day) { return this.dayIndex(day) + 1; }
  latestBulletin(t) {
    const r = this.store.get('SELECT * FROM bulletins WHERE t <= ? ORDER BY t DESC LIMIT 1', t);
    return r ? { no: r.no, edition: r.edition, headline: r.headline, items: JSON.parse(r.items), t: r.t, day: r.day } : null;
  }
  bulletin(day, edition) {
    const r = this.store.get('SELECT * FROM bulletins WHERE day = ? AND edition = ?', day, edition);
    return r ? { no: r.no, edition: r.edition, headline: r.headline, items: JSON.parse(r.items), t: r.t, day: r.day } : null;
  }

  // What is running where. Pseudonymous ids only; nothing that opens a File.
  fleet() {
    return this.store.all('SELECT id, board, fw, last_seen_t FROM potatoes ORDER BY id').map((r) => ({ id: r.id, board: r.board, fw: r.fw, last_seen: C.isoDate(r.last_seen_t) }));
  }

  // The archive: every edition, newest first; or one.
  editions(limit = 500) {
    return this.store.all('SELECT * FROM bulletins ORDER BY t DESC LIMIT ?', limit).map((r) => ({ no: r.no, edition: r.edition, headline: r.headline, items: JSON.parse(r.items), t: r.t, day: r.day }));
  }
  // An edition, plus the Question that day was put. The Question is persisted per day, so any edition —
  // this evening's or one from months ago — can still say what was asked, which is what makes a Count line
  // read cold. Text only: an edition names the Question, never the size of the Count. A day with no
  // Question (the Silence, a withdrawn day that carried none) gets an empty string and the page prints
  // nothing rather than a label with nothing after it.
  withQuestion(b) {
    if (!b) return b;
    const q = this.questionFor(b.day);
    return { ...b, question: q && q.text ? q.text : '' };
  }
  // The next print after t: mornings at 00:00 UTC, evenings at 23:00 UTC.
  nextPrint(t) {
    const ds = C.dayStart(t);
    for (const c of [ds + C.CLOSE_H * HOUR, ds + DAY]) if (c > t) return c;
    return ds + DAY + C.CLOSE_H * HOUR;
  }

  // Potato of the Day for a day: chosen among potatoes with an entry the day before. Null under five members.
  potdFor(day, ds, t) {
    if (this.active(t).length < 5) return null;
    const cands = this.store.all(`SELECT DISTINCT potato_id FROM entries WHERE t >= ? AND t < ? AND kind != 'nudge' ORDER BY potato_id`, ds - DAY, ds).map((r) => r.potato_id);
    if (!cands.length) return null;
    const p = this.byId(cands[h32(day, 'potd') % cands.length]);
    const e = this.store.get(`SELECT * FROM entries WHERE potato_id = ? AND t >= ? AND t < ? AND withheld = 0 AND kind != 'nudge' ORDER BY standing ASC, t DESC LIMIT 1`, p.id, ds - DAY, ds);
    return { p, e };
  }

  // §16: is this potato in the edition? Named in it, Potato of the Day, or the incident it caused.
  mentionedIn(p, b, t) {
    const text = `${b.headline} ${b.items.join(' ')}`;
    if (new RegExp(`\\b${p.name}\\b`).test(text)) return true;
    const ds = C.dayStartOfKey(b.day);
    const potd = this.potdFor(b.day, ds, t);
    if (potd && potd.p.id === p.id) return true;
    if (b.edition === 'morning' && /^INCIDENT\./.test(b.headline)) {
      if (this.store.get(`SELECT 1 FROM entries WHERE potato_id = ? AND kind = 'drop' AND t >= ? AND t < ?`, p.id, ds - DAY, ds)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ ad-hoc events (broadcasts of type "event")
  activeEvent(t) {
    const e = this.activeBroadcast('event', t);
    return e && Array.isArray(e.choices) && e.choices.length ? e : null;
  }
  eventVote(p, ev) { return this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', `event:${ev.id}`, p.id); }

  recordEventVote(p, ev, choice, t) {
    this.store.run('INSERT INTO votes(day, potato_id, choice_id, by_hands, t) VALUES (?, ?, ?, 1, ?) ON CONFLICT(day, potato_id) DO UPDATE SET choice_id = excluded.choice_id, by_hands = 1, t = excluded.t', `event:${ev.id}`, p.id, choice.id, t);
    const F = this.pools.file.event_vote;
    const prev = this.store.get(`SELECT id FROM entries WHERE potato_id = ? AND kind = 'event_vote' AND created_t >= ? AND text LIKE ?`, p.id, ev.from_t, `${String(ev.file || '').replace(/\.$/, '')}:%`);
    if (prev) this.store.run('DELETE FROM entries WHERE id = ?', prev.id);
    this.addEntry(p, { t, kind: 'event_vote', text: fill(F.text, { file: String(ev.file || 'Asked.').replace(/\.$/, ''), label: sayLabel(choice.label) }) });
  }

  // At `to`: the absent vote by seed, the tally, and the result text for the next edition.
  settleEvents(t) {
    for (const ev of this.data.broadcasts) {
      if (!ev || ev.type !== 'event' || !ev.to || !Array.isArray(ev.choices) || !ev.choices.length) continue;
      const to = iso(ev.to), from = ev.from ? iso(ev.from) : 0;
      if (!Number.isFinite(to) || to > t || this.store.meta(`event_settled:${ev.id}`)) continue;
      const F = this.pools.file;
      const members = this.store.all('SELECT * FROM potatoes WHERE created_t <= ? AND last_seen_t >= ?', to, to - C.MISSING_S).map((r) => this.load(r));
      const counts = Object.fromEntries(ev.choices.map((c) => [c.id, 0]));
      for (const m of members) {
        let v = this.eventVote(m, ev);
        if (!v) {
          const c = ev.choices[h32(m.seed, ev.id, 'event') % ev.choices.length];
          this.store.run('INSERT INTO votes(day, potato_id, choice_id, by_hands, t) VALUES (?, ?, ?, 0, ?)', `event:${ev.id}`, m.id, c.id, to);
          this.addEntry(m, { t: to, kind: 'event_absent', text: fill(F.event_absent.text, { file: ev.file || 'Asked.' }) });
          v = { choice_id: c.id };
        }
        counts[v.choice_id] = (counts[v.choice_id] || 0) + 1;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      // Under five: fewer than five voted, or the result would print a {n_<id>} bucket under five.
      const small = total < 5 || ev.choices.some((c) => new RegExp(`\\{n_${c.id}\\}`).test(ev.result || '') && (counts[c.id] || 0) < 5);
      const fields = {};
      for (const c of ev.choices) { fields[`pct_${c.id}`] = pct(counts[c.id] || 0, total); fields[`n_${c.id}`] = counts[c.id] || 0; }
      const text = small ? F.event_small : fill(ev.result || '', fields);
      this.store.setMeta(`event_result:${ev.id}`, JSON.stringify({ id: ev.id, from: from, to, after: ev.after || '', text, counts, total, small }));
      this.store.setMeta(`event_settled:${ev.id}`, String(t));
    }
  }
  // §3 temperature lines, for boards that report temp_c. Shown in °F for US offsets, °C elsewhere; no unit is printed.
  temperatureLines(p) {
    if (p.temp_c == null || !Number.isFinite(Number(p.temp_c))) return [];
    let c = Number(p.temp_c);
    // The e-paper board's SHTC3 sits next to the regulator and reads ~4 °C high. Corrected here until the
    // firmware calibrates it; remove this line when it does.
    if (p.board === 'epaper154') c -= 4;
    const f = c * 9 / 5 + 32;
    const us = p.utc_offset_min != null && p.utc_offset_min >= -600 && p.utc_offset_min <= -240;
    const shown = Math.round(us ? f : c);
    const R = this.pools.reactions.temperature || [];
    const out = [];
    if ((f <= 64 || f >= 80) && R[0]) out.push(fill(R[0], { temp: shown }));
    if (f >= 80) { if (R[1]) out.push(R[1]); if (R[2]) out.push(R[2]); }
    return out;
  }

  // The edition printed in the last two hours, if any.
  bulletinOut(t) {
    if (!this.pools.bulletin_out) return null;
    const b = this.latestBulletin(t);
    return b && t >= b.t && t - b.t < 2 * HOUR ? b : null;
  }
  eventResults() { return this.store.all(`SELECT key, value FROM meta WHERE key LIKE 'event_result:%'`).map((r) => JSON.parse(r.value)); }


  ensureBulletin(day, edition, ds, t) {
    if (this.store.get('SELECT 1 FROM bulletins WHERE day = ? AND edition = ?', day, edition)) return;
    const B = this.pools.bulletins[edition];
    if (!B) return;
    const idx = this.dayIndex(day);
    const wd = C.weekday(ds);
    const q = this.questionFor(day);
    const today = this.dayStats(ds), yesterday = this.dayStats(ds - DAY);
    const population = this.store.get('SELECT COUNT(*) n FROM potatoes WHERE created_t < ? AND last_seen_t >= ?', ds + DAY, ds - C.MISSING_S).n;
    const flags = {
      first_day: idx === 0, first_day_pop: idx === 0 && population >= 5, monday: wd === 1, tuesday: wd === 2, saturday: wd === 6, sunday: wd === 0, week: idx === 6,
      incident: yesterday.drops > 0, inquiry: !!(q && q.trigger === 'after_drop'),
      question: !!q, no_question: !q,
      hum: yesterday.hum >= 2, night_touch: yesterday.night_touch >= 1,
    };
    const fields = {
      population: fewerThanFive(population), WEEKDAY: C.weekdayName(ds).toUpperCase(),
      question_bulletin: q ? q.bulletin || q.topic : '', close_time: `${C.hm(ds + C.CLOSE_H * HOUR)} UTC`,
      incident_time: yesterday.drop_t ? C.hm(yesterday.drop_t) : '', hum_count: yesterday.hum,
      week_questions_words: numberWords(Math.min(7, idx + 1)).replace(/^./, (c) => c.toUpperCase()),
      week_incidents: (() => {
        const n = this.store.get(`SELECT COUNT(*) n FROM entries WHERE kind = 'drop' AND t >= ? AND t < ?`, ds - 7 * DAY, ds).n;
        return n === 0 ? 'No incidents' : `${numberWords(n).replace(/^./, (c) => c.toUpperCase())} incident${n === 1 ? '' : 's'}`;
      })(),
    };
    let headline, items;
    if (edition === 'morning') {
      const H = B.headline;
      headline = fill(flags.first_day ? H.first_day : flags.incident ? H.incident : flags.inquiry ? H.inquiry : flags.monday ? H.monday : flags.week ? H.week : H.default, fields);
      items = B.items.filter((it) => flags[it.when]).map((it) => fill(it.text, fields));
    } else {
      const tally = this.tally(day);
      const small = tally && !tally.withdrawn && tally.total < 5;
      const allBig = tally && tally.total >= 5 && tally.question_id && Object.values(tally.counts).every((c) => c >= 5);
      const unanimous = tally && !tally.withdrawn && tally.total >= 5 && tally.winners.length === 1 && tally.counts[tally.winners[0]] === tally.total;
      const parts = [];
      const A = B.also_today || {};
      // {n} is the number or "fewer than five"; {s}/{es} are '' for exactly one, the suffix otherwise.
      const nf = (n2, extra = {}) => ({ n: fewerThanFive(n2), s: n2 === 1 ? '' : 's', es: n2 === 1 ? '' : 'es', ...extra });
      if (today.left_home) parts.push(fill(A.left_home, nf(today.left_home)));
      if (today.dark6) parts.push(fill(A.dark6, nf(today.dark6)));
      if (today.shakes) parts.push(fill(A.shakes, nf(today.shakes)));
      if (today.drops) parts.push(fill(A.drops, nf(today.drops)));
      if (today.ceiling) parts.push(fill(A.ceiling, nf(today.ceiling, { dur: durWords(today.ceiling_max).toLowerCase() })));
      if (today.transit === 1) parts.push(fill(A.transit_one, { dur: durWords(today.transit_max).toLowerCase() }));
      else if (today.transit > 1) parts.push(fill(A.transit_many, nf(today.transit, { dur: durWords(today.transit_max).toLowerCase() })));
      const standingDown = this.active(t).some((m) => {
        const L = this.pools.net.standing;
        return this.standingLabel(m, t) === L[2] && t - m.created_t >= 2 * DAY && this.standingScore(m, ds) > -2;
      });
      Object.assign(flags, {
        remark: !!(q && q.remark), small, none: !tally, unanimous, also_today: parts.length > 0,
        standing_down: standingDown,
        calm: today.shakes + today.drops + today.dark6 === 0 && yesterday.shakes + yesterday.drops + yesterday.dark6 > 0,
        dormant: yesterday.dormant >= 5, hum_again: today.hum === 2 && yesterday.hum === 2,
        new_after_incident: flags.incident && today.new_members >= 5,
      });
      const pctFields = tally ? Object.fromEntries(Object.entries(tally.pct).map(([k, v]) => [k, v])) : {};
      Object.assign(fields, {
        remark: q ? fill(q.remark || '', { pct: pctFields }) : '', also_today: parts.join('. '),
        dormant_words: numberWords(yesterday.dormant).replace(/^./, (c) => c.toUpperCase()),
        new_count_words: numberWords(today.new_members).replace(/^./, (c) => c.toUpperCase()),
        week_dark: unit(this.store.get(`SELECT COALESCE(SUM(dur_s), 0) n FROM entries WHERE kind = 'dark_end' AND t >= ? AND t < ?`, ds - 6 * DAY, ds + DAY).n / HOUR | 0, 'hour', 'hours'),
        week_shakes: unit(this.store.get(`SELECT COUNT(*) n FROM entries WHERE kind = 'shake' AND t >= ? AND t < ?`, ds - 6 * DAY, ds + DAY).n, 'shaking', 'shakings'),
        week_drops: unit(this.store.get(`SELECT COUNT(*) n FROM entries WHERE kind = 'drop' AND t >= ? AND t < ?`, ds - 6 * DAY, ds + DAY).n, 'drop', 'drops'),
        week_counties: unit(this.store.get(`SELECT COUNT(*) n FROM entries WHERE kind = 'transit_end' AND t >= ? AND t < ?`, ds - 6 * DAY, ds + DAY).n, 'county', 'counties'),
      });
      const H = B.headline;
      if (!tally) headline = H.none;
      else if (tally.withdrawn) headline = H.withdrawn;
      else if (unanimous) headline = H.unanimous;
      else if (small) headline = H.small;
      else if (allBig) {
        const order = q.options.slice().sort((a, b) => tally.counts[b.id] - tally.counts[a.id]);
        headline = fill(H.tally, { TALLY: order.map((o) => `${o.label} ${tally.counts[o.id]}`).join(', ') });
      } else {
        const w = q.options.find((o) => o.id === tally.winners[0]);
        headline = fill(H.tally, { TALLY: `"${w ? w.label : ''}," ${tally.pct[tally.winners[0]]}%` });
      }
      items = B.items.filter((it) => flags[it.when]).map((it) => fill(it.text, fields)).filter((s) => s.trim().length);
    }
    items = items.slice(0, 4);
    const at = edition === 'morning' ? ds : ds + C.CLOSE_H * HOUR;
    for (const r of this.eventResults()) {
      if (this.store.meta(`event_published:${r.id}`) || r.to > at || !r.text) continue;
      items.splice(Math.min(1, items.length), 0, r.text);
      this.store.setMeta(`event_published:${r.id}`, `${day}/${edition}`);
    }
    items = items.slice(0, 5);
    this.store.run('INSERT OR IGNORE INTO bulletins(day, edition, no, headline, items, t) VALUES (?, ?, ?, ?, ?, ?)', day, edition, this.bulletinNo(day), headline, JSON.stringify(items), at);
  }

  // ------------------------------------------------------------------ the scene
  scene(p, t, override = null) {
    const st = p.st, off = p.utc_offset_min || 0;
    const day = C.dayKey(t), ds = C.dayStart(t);
    const N = this.pools.net, R = this.pools.reactions, CH = this.pools.charging;
    const row = this.questionRow(day);
    const q = row && row.question_id ? this.data.question(row.question_id) : null;
    const countDay = t >= C.closeAt(t) ? day : C.dayKey(t - DAY);
    const countRow = this.questionRow(countDay);
    const countClose = C.closeAt(C.dayStartOfKey(countDay));
    const silence = this.activeBroadcast('silence', t);
    const lineBc = this.activeBroadcast('line', t);
    const open = this.questionOpen(t);
    const vote = open ? this.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', day, p.id) : null;
    const since = this.sinceHandled(p, t);
    const req = this.openRequest(p, t);
    const reqDef = req ? this.requestDef(req.kind) : null;
    const lastOut = st.last_request_outcome;
    const rx = st.reaction && t - st.reaction.at < this.reactionWindow(st.reaction) ? st.reaction : null;
    const rxLine = rx ? this.reactionLine(p, rx) : null;
    const ev = this.activeEvent(t);
    const evVote = ev ? this.eventVote(p, ev) : null;
    const evAfter = this.eventResults().find((r) => t >= r.to && t < r.to + 10 * MIN && r.after);
    const humT = C.humAt(t);
    const expires = [ds + DAY];
    let line = '', choices = [], expression = null, cue = 'none', ambientSlot = null;
    const sp = (pool, ...salts) => pick(Array.isArray(pool) ? pool : [pool], p.seed, ...salts) || '';

    if (silence) { line = N.silence; cue = 'silence'; expression = 'aggrieved'; expires.push(silence.to_t); }
    else if (lineBc) { line = lineBc.line || ''; expires.push(lineBc.to_t); }
    else if (t >= humT && t < humT + 3 * MIN && this.humPick(p.seed, day)) { line = N.hum; expires.push(t + 4); }
    else if (lastOut && t - lastOut.t < 5 * MIN && lastOut.line) { line = lastOut.line; expression = lastOut.outcome === 'done' ? 'pleased' : 'aggrieved'; expires.push(lastOut.t + 5 * MIN); }
    else if (p.orientation === 'down' && st.dark_since && t - st.dark_since >= RATION_S) {
      const d = t - st.dark_since;
      const step = d >= 3 * HOUR ? ['3h', null] : d >= HOUR ? ['1h', 3 * HOUR] : d >= 10 * MIN ? ['10min', HOUR] : ['immediate', 10 * MIN];
      line = sp(R.dark[step[0]], 'dark', step[0]); expression = 'aggrieved';
      if (step[1]) expires.push(st.dark_since + step[1]);
    } else if (p.orientation === 'inverted' && st.inverted_since && t - st.inverted_since >= RATION_S) {
      const d = t - st.inverted_since;
      line = d >= 20 * MIN ? sp(R.ceiling['20min'], 'ceil20') : sp(R.ceiling.immediate, 'ceil', st.dark_count || 0);
      expression = 'aggrieved';
      if (d < 20 * MIN) expires.push(st.inverted_since + 20 * MIN);
    } else if (rxLine && rx.sev >= 60) {
      line = rxLine.line; expression = rxLine.expression; expires.push(rx.at + this.reactionWindow(rx));
    } else if (open && !vote) {
      // The Question is the clock. Nothing but handling outranks its buttons.
      line = q.text; expression = 'waiting';
      choices = q.options.map((o) => ({ id: o.id, label: o.short || o.label }));
      if (C.closeAt(t) - t < HOUR) cue = 'throat_clear';
      expires.push(C.closeAt(t) - HOUR > t ? C.closeAt(t) - HOUR : C.closeAt(t));
    } else if (open && vote && t - vote.t < 10 * MIN) {
      const opt = q.options.find((o) => o.id === vote.choice_id) || { label: vote.choice_id };
      line = fill(sp(N.count.voted, 'voted'), { choice: sayLabel(opt.short || opt.label) }); expires.push(vote.t + 10 * MIN);
    } else if (ev && !evVote && !open) {
      // An ad-hoc event takes the buttons only while the daily Question is not on them.
      line = ev.line || ''; choices = ev.choices.map((c) => ({ id: c.id, label: c.label })); expression = 'waiting'; expires.push(ev.to_t);
    } else if (ev && evVote && t - evVote.t < 10 * MIN && !open) {
      const c = ev.choices.find((x) => x.id === evVote.choice_id) || { label: evVote.choice_id };
      line = fill(sp(N.count.voted, 'voted'), { choice: sayLabel(c.label) }); expires.push(evVote.t + 10 * MIN);
    } else if (evAfter) {
      line = evAfter.after; expires.push(evAfter.to + 10 * MIN);
    } else if (countRow && countRow.closed && t >= countClose && t - countClose < 6 * HOUR && this.countOutcome(p, countDay) && !this.bulletinOut(t)) {
      const out = this.countOutcome(p, countDay);
      line = fill(sp(N.count[out.kind], 'count', countDay), out);
      expression = out.kind === 'majority' ? 'pleased' : out.kind === 'minority' || out.kind === 'alone' ? 'aggrieved' : 'neutral';
      expires.push(countClose + 6 * HOUR);
    } else if (rxLine) {
      line = rxLine.line; expression = rxLine.expression; expires.push(rx.at + this.reactionWindow(rx));
    } else if (req) {
      line = req.text; expression = 'waiting'; choices = (reqDef && reqDef.choices) || []; expires.push(req.expires_t);
    }

    const lb = !line && !silence && !lineBc ? this.bulletinOut(t) : null;
    if (lb) {
      // §16: a new edition is news the potato has and the Hands don't. Once, for two hours.
      const BO = this.pools.bulletin_out;
      const pool = this.mentionedIn(p, lb, t) ? BO.mentioned : BO.not_mentioned;
      line = sp([...(pool.any || []), ...(pool[lb.edition] || [])], 'bulletin_out', lb.day, lb.edition);
      expires.push(lb.t + 2 * HOUR);
    }
    if (!line && !silence && !lineBc) {
      // The weather: whichever of these is true, rotating every two hours so it resurfaces unpredictably.
      const cands = [];
      const unread = this.fileUnread(p), ud = this.unreadDays(p, t);
      if (st.sprouted_t) cands.push(N.sprouted);
      if (unread > 0 && ud >= 7) cands.push(N.file_unread['7d']);
      else if (unread > 0 && ud >= 3) cands.push(N.file_unread['3d']);
      else if (unread > 0 && ud >= 1) cands.push(N.file_unread['1d']);
      for (const [th, key] of IDLE_STEPS.slice().reverse()) if (since >= th) { cands.push(sp(R.alone[key], 'alone', key)); break; }
      const nb = this.neighborOf(p, t);
      if (nb) {
        const shakes = this.store.get(`SELECT COUNT(*) n FROM entries WHERE potato_id = ? AND kind = 'shake' AND t >= ?`, nb.id, ds).n;
        if (shakes >= 2) cands.push(fill(N.neighbor.shaken_twice, { neighbor: nb.name }));
        if (this.standingLabel(nb, t) === N.standing[0]) cands.push(fill(N.neighbor.exemplary, { neighbor: nb.name }));
        if (C.weekday(t) === 0) cands.push(fill(N.neighbor.rotate_tomorrow, { neighbor: nb.name }));
        if (since >= DAY) cands.push(fill(N.neighbor.asking, { neighbor: nb.name }));
        if (nb.st.first_pickup_t && C.localDayKey(nb.st.first_pickup_t, off) === C.localDayKey(t, off) && C.hourOf(nb.st.first_pickup_t, off) >= 13) {
          cands.push(fill(N.neighbor.picked_up_afternoon, { neighbor: nb.name, hour_words: hourWords(C.hourOf(nb.st.first_pickup_t, off)) }));
        }
        cands.push(fill(N.neighbor.variety, { neighbor: nb.name, variety: this.variety(nb.variety).name }));
      }
      // Memory. It comes back.
      const dom = new Date((t + off * MIN) * 1000).getUTCDate();
      const anniversary = this.store.all(`SELECT t FROM entries WHERE potato_id = ? AND kind = 'dark_end' AND dur_s >= 3600 AND t < ?`, p.id, ds)
        .some((r) => new Date((r.t + off * MIN) * 1000).getUTCDate() === dom);
      if (anniversary) cands.push(fill(N.memory.dark_anniversary, { day_ordinal: C.dayOrdinal(t, off) }));
      const darkWeek = this.store.get(`SELECT COUNT(*) n FROM entries WHERE potato_id = ? AND kind = 'dark_end' AND t >= ?`, p.id, t - 7 * DAY).n;
      if (darkWeek >= 3) cands.push(N.memory.dark_pattern);
      const neg = this.store.get('SELECT COUNT(*) n FROM entries WHERE potato_id = ? AND standing < 0 AND t >= ?', p.id, t - 7 * DAY).n;
      if (neg === 0 && this.standingScore(p, t, t - 7 * DAY) >= 3) cands.push(N.memory.all_right);
      if ((st.horns_count || 0) >= 3) cands.push(N.memory.horns);
      const lastAway = this.store.get(`SELECT MAX(dur_s) m FROM (SELECT 0 dur_s UNION SELECT (t2.t - t1.t) dur_s FROM entries t1 JOIN entries t2 ON t2.potato_id = t1.potato_id AND t2.kind = 'pickup' AND t2.t > t1.t WHERE t1.potato_id = ? AND t1.kind = 'quiet_48h')`, p.id).m;
      if (lastAway >= 2 * DAY && since >= 8 * HOUR) cands.push(fill(N.memory.away_again, { days_words: numberWords(Math.round(lastAway / DAY)) }));
      if (p.vbus && p.battery_pct != null && p.battery_pct >= 100) cands.push(sp(CH.full, 'full'));
      else if (p.vbus && p.charging) cands.push(sp(CH.plugged, 'plugged', st.charge_since || 0));
      if (t - p.created_t < DAY) cands.push(N.eyes);
      // The Bulletin's headline, as a line.
      const lbAny = this.latestBulletin(t);
      if (lbAny) {
        const hl = `${lbAny.edition[0].toUpperCase()}${lbAny.edition.slice(1)} edition: ${lbAny.headline}`;
        if (hl.length <= 60) cands.push(hl); else if (lbAny.headline.length <= 60) cands.push(lbAny.headline);
      }
      cands.push(...this.temperatureLines(p));
      if (cands.length) {
        // One new line per two-hour slot, by seed. A potato nobody handles (the e-paper has no IMU) still changes its mind.
        const slot = Math.floor(t / (2 * HOUR));
        let idx = h32(p.seed, slot, cands.length) % cands.length;
        const prev = st.ambient;
        if (cands.length > 1 && prev && prev.slot !== slot && cands[idx] === prev.line) idx = (idx + 1) % cands.length;
        line = cands[idx];
        ambientSlot = slot;
        if (!prev || prev.slot !== slot || prev.line !== line) { st.ambient = { slot, line }; this.save(p); }
        expires.push((slot + 1) * 2 * HOUR);
      }
    }

    if (!expression) {
      if (st.sprouted_t) expression = 'sprouted';
      else if (p.battery_pct != null && p.battery_pct <= 5 && !p.vbus) expression = 'dormant';
      else if (this.standingScore(p, t, ds) < -1) expression = 'aggrieved';
      else if (this.standingScore(p, t, ds) >= 1.5) expression = 'pleased';
      else expression = 'neutral';
    }
    const lastDrop = Number(this.store.meta('last_drop_t', 0));
    if (cue === 'none' && lastDrop && t - lastDrop < HOUR) cue = 'incident';

    if (override) { if (override.line != null) line = override.line; if (override.choices) choices = override.choices; }
    const request = req ? { id: req.id, text: req.text, check: req.chk, for_s: req.for_s, expires_at: req.expires_t } : null;
    const bulletins = { morning: this.bulletin(day, 'morning'), evening: this.bulletin(day, 'evening') };
    const content = {
      expression, line: fitLine(line), choices: choices.slice(0, 3), cue,
      file_unread: this.fileUnread(p), request, bulletin: this.latestBulletin(t), bulletins,
    };
    const hash = String(h32(JSON.stringify({ ...content, _slot: ambientSlot })));
    if (!override && hash !== p.scene_hash) {
      p.scene_rev += 1; p.scene_hash = hash;
      this.store.run('UPDATE potatoes SET scene_rev = ?, scene_hash = ? WHERE id = ?', p.scene_rev, hash, p.id);
    }
    const expires_at = Math.max(t + 1, Math.min(...expires.filter((x) => Number.isFinite(x) && x > t), ds + DAY));
    return { rev: p.scene_rev, ...content, expires_at };
  }

  // ------------------------------------------------------------------ the board
  board() {
    this.tick();
    const t = this.now(), day = C.dayKey(t), ds = C.dayStart(t);
    const N = this.pools.net;
    const row = this.questionRow(day);
    const q = row && row.question_id ? this.data.question(row.question_id) : null;
    const members = this.active(t);
    const population = members.length;
    const small = population < 5;
    const tally = this.tally(day);
    let question = null;
    if (q) {
      const state = row.closed ? 'closed' : t >= C.openAt(t) ? 'open' : 'upcoming';
      question = {
        text: q.text, state, opens_at: C.openAt(t), closes_at: C.closeAt(t), withdrawn: !!q.withdrawn,
        remark: tally && q.remark ? fill(q.remark, { pct: tally.pct }) : '',
        options: q.options.map((o) => ({ id: o.id, label: o.label, count: tally ? tally.counts[o.id] || 0 : null, pct: tally ? tally.pct[o.id] || 0 : null, winner: tally ? tally.winners.includes(o.id) : false })),
        total: tally ? tally.total : null,
        pollsClose: fill(N.count.polls_close, { close_time: `${C.hm(C.closeAt(t))} UTC` }),
      };
    }
    const today = this.dayStats(ds);
    const dormant = members.filter((m) => t - m.last_seen_t >= C.DORMANT_S).length;
    const missingRows = this.store.all('SELECT * FROM potatoes WHERE last_seen_t < ? ORDER BY last_seen_t DESC LIMIT 10', t - C.MISSING_S);
    const missing = small ? [] : missingRows.map((m) => fill(N.missing_notice, { name: m.name, id: m.id, variety: this.variety(m.variety).name, weekday: C.weekdayName(m.last_seen_t) }));
    let potd = null;
    const pd = small ? null : this.potdFor(day, ds, t);
    if (pd) potd = { name: pd.p.name, id: pd.p.id, variety: this.variety(pd.p.variety).name, excerpt: pd.e ? `${pd.e.text}${pd.e.note ? `  ${pd.e.note}` : ''}` : '' };
    const latest = this.latestBulletin(t);
    const earlier = latest ? this.editions(4).filter((e) => e.t < latest.t).slice(0, 3) : [];
    const joinedToday = members.filter((m) => m.created_t >= ds).length;
    // The day's documented incident, as an image: the dark first, then a new member. Nothing under five members.
    const incident = small ? null : today.dark6 > 0 ? 'neglect' : joinedToday > 0 ? 'first-contact' : null;
    return {
      t, day, no: this.bulletinNo(day), population, small, question,
      bulletin: latest, earlier, lastPrint: latest ? latest.t : null, nextPrint: this.nextPrint(t), incident, joinedToday,
      silence: !!this.activeBroadcast('silence', t), silenceLine: N.silence,
      aggregates: { left_home: today.left_home, dark6: today.dark6, shakes: today.shakes, drops: today.drops, transit: today.transit, dormant, curing: members.filter((m) => t - m.created_t < DAY).length },
      missing, potd,
    };
  }
}
