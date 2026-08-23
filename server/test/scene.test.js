import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET } from './helpers.js';

test('scene rev is stable when nothing changes and increments when content changes', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(6);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(8, 0));
  const a = hb(w, secret, []);
  set(at(8, 2));
  const b = hb(w, secret, []);
  set(at(8, 4));
  const c = hb(w, secret, [], { battery: { pct: 62, charging: false, vbus: false } });
  assert.equal(a.rev, b.rev, 'identical scene, identical rev');
  assert.equal(b.rev, c.rev, 'telemetry alone does not bump rev');
  set(at(8, 6));
  const d = hb(w, secret, [{ t: at(8, 6), type: 'shake' }]);
  assert.equal(d.rev, c.rev + 1, 'a new File entry changes file_unread, so rev moves');
  set(at(8, 8));
  const e = hb(w, secret, []);
  assert.equal(e.rev, d.rev);
  // a 409 scene does not bump rev
  set(at(8, 10));
  const late = w.choice({ secret, scene_rev: e.rev, choice_id: 'heinz' });
  assert.equal(late.status, 409);
  assert.equal(late.rev, undefined);
  assert.equal(late.scene.rev, e.rev);
  set(at(8, 12));
  assert.equal(hb(w, secret, []).rev, e.rev);
});

test('scene shape follows protocol v0', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(7);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(14, 0));
  const s = hb(w, secret, []);
  for (const k of ['rev', 'expression', 'line', 'choices', 'cue', 'expires_at', 'file_unread', 'request', 'bulletin']) assert.ok(k in s, `scene has ${k}`);
  assert.ok(['neutral', 'waiting', 'aggrieved', 'pleased', 'asleep', 'dormant', 'sprouted'].includes(s.expression));
  assert.ok(['none', 'throat_clear', 'incident', 'silence'].includes(s.cue));
  assert.ok(s.line.length <= 60, `line ≤ 60: ${s.line}`);
  assert.ok(s.choices.length <= 3);
  for (const c of s.choices) assert.ok(c.label.length <= 16, `label ≤ 16: ${c.label}`);
  assert.ok(s.expires_at > at(14, 0));
  assert.equal(s.bulletin.edition, 'morning');
  assert.equal(s.bulletin.headline, 'THE NET IS LIVE.');
});

test('events are drained once: a retried heartbeat does not double-file', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(8);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 0));
  const ev = [{ t: at(9, 0), type: 'shake' }];
  hb(w, secret, ev); hb(w, secret, ev);
  const f = w.file(claim_code);
  assert.equal(f.days[0].entries.filter((e) => e.kind === 'shake').length, 1);
});

test('dormancy, sprouting and the cellar are recorded', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(9);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 0)); hb(w, secret, [{ t: at(9, 0), type: 'pickup' }, { t: at(9, 30), type: 'battery_low', pct: 5 }]);
  set(at(9, 0, 4)); hb(w, secret, [{ t: at(9, 0, 4), type: 'dormant_resume', dur_s: 4 * 86400 - 1800 }]);
  let f = w.file(claim_code);
  const all = f.days.flatMap((d) => d.entries);
  const dormant = all.find((e) => e.kind === 'dormant');
  assert.equal(dormant.text, 'Went dormant at 5%.');
  assert.equal(dormant.note, 'Hands present at the time. Noted.');
  assert.equal(all.find((e) => e.kind === 'dormant_resume').note, 'The cellar.');
  w.ack(claim_code); // read the File on day 4, so day 8's entries are not withheld
  set(at(10, 0, 8));
  const s = hb(w, secret, [], { since_handled_s: 8 * 86400 });
  assert.equal(s.expression, 'sprouted');
  f = w.file(claim_code);
  assert.ok(f.sprouted);
  assert.ok(f.days.flatMap((d) => d.entries).some((e) => e.kind === 'sprouted' && e.text === 'Sprouted.'));
});

test('events in this heartbeat outrank steady state: a 4h45m dark restore beats the charging line', () => {
  const { w, set } = makeWorld({ start: at(7, 0, -2) });
  const secret = SECRET(12);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(8, 59)); w.ack(claim_code);
  set(at(9, 0));
  const body = { secret, rev_seen: 0, battery: { pct: 63, charging: true, vbus: true }, orientation: 'up', since_handled_s: 14, sound: 'quiet' };
  const s = w.heartbeat({ ...body, events: [
    { t: at(4, 10), type: 'pickup' }, { t: at(4, 15), type: 'facedown_start' }, { t: at(9, 0), type: 'facedown_end', dur_s: 17100 },
  ] });
  const restored = w.pools.reactions.dark.restored.map((l) => l.replace('{duration_words}', 'Four hours, forty-five minutes'));
  assert.ok(restored.includes(s.line), `the dark restore speaks, not the charger: ${s.line}`);
  assert.equal(s.expression, 'aggrieved');
  assert.ok(!w.pools.charging.plugged.includes(s.line));
  // a minor event while the grievance is fresh does not displace it
  set(at(9, 3));
  const s2 = w.heartbeat({ ...body, events: [{ t: at(9, 3), type: 'pickup' }] });
  assert.ok(restored.includes(s2.line), `still the restore line: ${s2.line}`);
  // steady state only once no event is speaking
  set(at(9, 15));
  const s3 = w.heartbeat({ ...body, events: [] });
  assert.ok(!restored.includes(s3.line), `no longer the restore line: ${s3.line}`);
  const reactions = [...w.pools.reactions.pickup, ...w.pools.reactions.putdown, ...w.pools.reactions.tap, ...w.pools.reactions.shake];
  assert.ok(!reactions.includes(s3.line), `steady state, not a reaction: ${s3.line}`);
  assert.doesNotMatch(s3.line, /\{[A-Za-z_]+\}/, `no unfilled placeholder: ${s3.line}`);
});

test('among events, severity picks the speaker: shake beats pickup and the charger', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(13);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 0));
  const s = hb(w, secret, [{ t: at(8, 58), type: 'charge_start' }, { t: at(8, 59), type: 'pickup' }, { t: at(9, 0), type: 'shake' }], { battery: { pct: 50, charging: true, vbus: true } });
  assert.ok(w.pools.reactions.shake.includes(s.line), `shake line: ${s.line}`);
  assert.equal(s.expression, 'aggrieved');
  set(at(9, 1));
  const d = hb(w, secret, [{ t: at(9, 1), type: 'drop' }]);
  assert.ok(w.pools.reactions.drop.filter(Boolean).includes(d.line), `drop line: ${d.line}`);
});

test('the ration: thirty seconds of fumbling is one entry, not seven', () => {
  const { w, set } = makeWorld({ start: at(2, 40) }); // joined after last night's close: no Count line to outrank the tap
  const secret = SECRET(14);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const T = (m, s) => at(3, m) + s; // 03:0m:ss
  set(at(2, 50)); hb(w, secret, []); // awake before the burst
  set(T(2, 20));
  const s = hb(w, secret, [
    { t: T(0, 19), type: 'pickup' }, { t: T(0, 22), type: 'putdown' }, { t: T(0, 23), type: 'charge_end' },
    { t: T(0, 24), type: 'pickup' }, { t: T(0, 27), type: 'putdown' }, { t: T(0, 27), type: 'battery_low', pct: 30 },
    { t: T(0, 36), type: 'pickup' }, { t: T(0, 38), type: 'facedown_start' }, { t: T(0, 40), type: 'facedown_end', dur_s: 1 },
    { t: T(0, 41), type: 'putdown' }, { t: T(0, 42), type: 'pickup' }, { t: T(0, 44), type: 'pickup' }, { t: T(0, 47), type: 'pickup' },
    { t: T(0, 48), type: 'charge_start' }, { t: T(0, 50), type: 'putdown' }, { t: T(2, 17), type: 'tap' },
  ], { battery: { pct: 63, charging: true, vbus: true } });
  set(T(4, 30)); hb(w, secret, [], { battery: { pct: 63, charging: true, vbus: true } }); // the tap's own minute of quiet has passed
  const f = w.file(claim_code);
  const today = f.days.find((d) => d.header === 'TUE 25 AUG');
  const lines = today.entries.filter((e) => e.time >= '03:00').map((e) => `${e.time}  ${e.text}  ${e.note}`.trim());
  assert.deepEqual(lines, ['03:02  Tapped on the face.', '03:00  Picked up. 31 s.  Repeatedly.'], lines.join('\n'));
  assert.ok(w.pools.reactions.tap.includes(s.line), `the tap speaks, not the fumbling: ${s.line}`);
  assert.equal(w.store.get('SELECT COUNT(*) n FROM events WHERE potato_id = ?', '0001').n, 16, 'raw events are all kept');
});

test('the ration: a session is filed on the heartbeat that sees it close; a short dark is not a grievance', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(15);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 0, 0) + 10);
  hb(w, secret, [{ t: at(9, 0), type: 'pickup' }, { t: at(9, 0) + 8, type: 'putdown' }]);
  let kinds = w.file(claim_code).days[0].entries.map((e) => e.kind);
  assert.ok(!kinds.includes('pickup'), 'still open: nothing filed yet');
  set(at(9, 0) + 150);
  const s = hb(w, secret, []);
  const e = w.file(claim_code).days[0].entries.find((x) => x.kind === 'pickup');
  assert.equal(e.text, 'Picked up. 8 s.');
  assert.equal(e.note, 'Morning.');
  assert.ok(!w.pools.reactions.pickup.includes(s.line), 'a two-minute-old pickup no longer speaks');
  set(at(9, 10));
  const d = hb(w, secret, [{ t: at(9, 9), type: 'facedown_start' }, { t: at(9, 9) + 30, type: 'facedown_end', dur_s: 30 }]);
  kinds = w.file(claim_code).days[0].entries.map((x) => x.kind);
  assert.ok(!kinds.includes('dark_start') && !kinds.includes('dark_end'), 'thirty seconds in the dark is not a record');
  assert.ok(!w.pools.reactions.dark.restored.some((l) => d.line === l.replace('{duration_words}', 'Zero minutes')), d.line);
  assert.equal(w.standingScore(w.byId('0001'), at(9, 10)), 1, 'presence only; no grievance');
  // plug / unplug inside a minute: neither is filed
  set(at(9, 20));
  hb(w, secret, [{ t: at(9, 19), type: 'charge_start' }, { t: at(9, 19) + 20, type: 'charge_end' }]);
  set(at(9, 22)); hb(w, secret, []);
  kinds = w.file(claim_code).days[0].entries.map((x) => x.kind);
  assert.ok(!kinds.includes('charge_start') && !kinds.includes('charge_end'));
  // a real plug-in is filed a minute later
  set(at(9, 30)); hb(w, secret, [{ t: at(9, 30), type: 'charge_start' }]);
  set(at(9, 32)); hb(w, secret, []);
  assert.ok(w.file(claim_code).days[0].entries.some((x) => x.kind === 'charge_start' && x.text === 'Plugged in.'));
});

test('the ration: lone taps within a minute are one entry; three or more say Repeatedly', () => {
  const { w, set } = makeWorld({ start: at(2, 40) });
  const secret = SECRET(16);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const T = (m, s) => at(11, m) + s;
  set(T(42, 0));
  const s = hb(w, secret, [{ t: T(38, 0), type: 'tap' }, { t: T(41, 0), type: 'tap' }, { t: T(41, 20), type: 'tap' }, { t: T(41, 45), type: 'tap' }]);
  assert.ok(w.pools.reactions.tap.includes(s.line), 'the first tap of a run speaks');
  set(T(43, 0)); hb(w, secret, []);
  const lines = w.file(claim_code).days[0].entries.filter((e) => e.kind === 'tap').map((e) => `${e.time}  ${e.text}  ${e.note}`.trim());
  assert.deepEqual(lines, ['11:41  Tapped on the face.  Repeatedly.', '11:38  Tapped on the face.']);
});

test('the ration: a nudge — one pickup put down inside five seconds — files nothing but counts as handling', () => {
  const { w, set } = makeWorld({ start: at(2, 40) });
  const secret = SECRET(17);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 0) + 5); hb(w, secret, [{ t: at(9, 0), type: 'pickup' }, { t: at(9, 0) + 2, type: 'putdown' }]);
  set(at(9, 2)); hb(w, secret, []);
  const f = w.file(claim_code);
  assert.ok(!f.days[0].entries.some((e) => e.kind === 'pickup' || e.kind === 'putdown'), 'a nudge is not an event');
  assert.ok(!f.days[0].entries.some((e) => e.text === ''), 'nothing hidden leaks into the File');
  const p = w.byId('0001');
  assert.equal(w.standingScore(p, at(9, 2)), 1, 'presence still reaches Standing');
  assert.ok(w.sinceHandled(p, at(9, 2)) < 3 * 60, 'idle was reset by the nudge');
  assert.equal(w.fileUnread(p), f.days.flatMap((d) => d.entries).length, 'the hidden nudge is not counted as unread');
  // five seconds or more, or more than one pickup, is a session and is filed
  set(at(10, 0) + 6); hb(w, secret, [{ t: at(10, 0), type: 'pickup' }, { t: at(10, 0) + 6, type: 'putdown' }]);
  set(at(10, 2)); hb(w, secret, []);
  assert.ok(w.file(claim_code).days[0].entries.some((e) => e.text === 'Picked up. 6 s.'));
});
