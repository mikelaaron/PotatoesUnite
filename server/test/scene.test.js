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
  assert.equal(s.bulletin.headline, 'THE NET IS OPEN.');
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
  assert.ok(!restored.includes(s3.line));
  if (!s3.request) assert.ok(w.pools.charging.plugged.includes(s3.line), `charging is steady state: ${s3.line}`);
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
