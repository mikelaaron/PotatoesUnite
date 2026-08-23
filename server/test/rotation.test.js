import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, SECRET } from './helpers.js';

// Rosemary: an e-paper citizen. No IMU, so no handling events ever; a thermometer that reads high.
test('a potato nobody handles still changes its line: twelve hours, four distinct lines, the vote ack gone after ten minutes', () => {
  const { w, set } = makeWorld({ start: at(12, 50) });
  const secret = SECRET(90);
  w.register({ secret, board: 'epaper154', fw: '0.1.0' });
  const beat = () => w.heartbeat({ secret, rev_seen: 0, battery: { pct: 80, charging: true, vbus: true }, orientation: 'up', since_handled_s: 99999, sound: 'quiet', temp_c: 31, utc_offset_min: -240, events: [] });
  set(at(13, 5));
  assert.equal(beat().choices.length, 3, 'the Question is on the buttons');
  const ack = w.choice({ secret, scene_rev: 1, choice_id: 'hunts' }).scene.line;
  assert.equal(ack, "Hunt's. Noted.");
  const seen = new Map(); // line → first time seen
  const revs = [];
  for (let t = at(13, 10); t <= at(1, 0, 1); t += 30 * 60) {
    set(t);
    const s = beat();
    if (t > at(13, 15)) assert.notEqual(s.line, ack, `the ack must not hold at ${new Date(t * 1000).toISOString()}`);
    assert.ok(s.line.length > 0 && s.line.length <= 60, `a line, within 60: "${s.line}"`);
    if (!seen.has(s.line)) seen.set(s.line, t);
    revs.push(s.rev);
  }
  assert.ok(seen.size >= 4, `distinct lines over twelve hours: ${seen.size}\n${[...seen.keys()].join('\n')}`);
  assert.ok(new Set(revs).size >= 4, 'the e-paper got something new to print');
  // temperature: 31 °C reported, 4 °C of self-heating removed, shown in °F for a US offset
  const temps = w.temperatureLines(w.byId('0001'));
  assert.ok(temps.includes("It's 81 in here. Just so we're clear."), temps.join(' | '));
  assert.ok(temps.includes('Warm. Why is it warm.'));
});

test('temperature lines: unit follows the offset; the quiet middle says nothing', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(91);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const p = () => w.byId('0001');
  set(at(9, 0));
  w.heartbeat({ secret, temp_c: 22, utc_offset_min: 60, events: [] });
  assert.deepEqual(w.temperatureLines(p()), [], '22 °C is not worth mentioning');
  w.heartbeat({ secret, temp_c: 15, utc_offset_min: 60, events: [] });
  assert.deepEqual(w.temperatureLines(p()), ["It's 15 in here. Just so we're clear."]);
  w.heartbeat({ secret, temp_c: 15, utc_offset_min: -300, events: [] });
  assert.deepEqual(w.temperatureLines(p()), ["It's 59 in here. Just so we're clear."]);
});

test('the rotation never repeats the previous slot when it has a choice, and the rev moves with the slot', () => {
  const { w, set } = makeWorld({ start: at(1, 0) });
  const secret = SECRET(92);
  w.register({ secret, board: 'epaper154', fw: '0.1.0' });
  const beat = () => w.heartbeat({ secret, since_handled_s: 99999, temp_c: 33, utc_offset_min: -240, events: [] });
  set(at(3, 0)); const a = beat();
  set(at(5, 0)); const b = beat();
  set(at(7, 0)); const c = beat();
  assert.notEqual(a.line, b.line);
  assert.notEqual(b.line, c.line);
  assert.ok(a.rev < b.rev && b.rev < c.rev, `revs ${a.rev} ${b.rev} ${c.rev}`);
  set(at(7, 30)); assert.equal(beat().rev, c.rev, 'within a slot the rev is stable');
});

test('a device that re-posts the same choice every heartbeat: the ack shows once, for ten minutes', () => {
  const { w, set } = makeWorld({ start: at(12, 50) });
  const secret = SECRET(93);
  w.register({ secret, board: 'epaper154', fw: '0.1.0' });
  const beat = () => w.heartbeat({ secret, rev_seen: 0, battery: { pct: 80 }, orientation: 'up', since_handled_s: 99999, sound: 'quiet', temp_c: 31, utc_offset_min: -240, events: [] });
  set(at(15, 14)); beat();
  const first = w.choice({ secret, scene_rev: 1, choice_id: 'hunts' });
  assert.equal(first.scene.line, "Hunt's. Noted.");
  const voteT = w.store.get('SELECT t FROM votes WHERE potato_id = ?', '0001').t;
  const q = w.questionFor('2026-08-25');
  for (let t = at(15, 16); t <= at(16, 16); t += 120) {
    set(t);
    const s = beat();
    const r = w.choice({ secret, scene_rev: s.rev, choice_id: 'hunts' }); // the device re-posts
    assert.equal(r.status, 200);
    assert.equal(w.store.get('SELECT t FROM votes WHERE potato_id = ?', '0001').t, voteT, 'the same choice again is not a new vote');
    if (t < at(15, 24)) assert.equal(s.line, "Hunt's. Noted.", `ack holds at ${new Date(t * 1000).toISOString()}`);
    else {
      assert.notEqual(s.line, "Hunt's. Noted.", `ack must be gone at ${new Date(t * 1000).toISOString()}`);
      assert.notEqual(s.line, q.text, 'never back to the Question text after voting');
      assert.ok(s.line.length > 0, 'the rotation speaks');
    }
    assert.equal(s.choices.length, 3, 'the buttons stay while the Question is open, so a re-vote is possible');
  }
  set(at(16, 20));
  const changed = w.choice({ secret, scene_rev: 1, choice_id: 'heinz' });
  assert.equal(changed.scene.line, 'Heinz. Noted.', 'a different choice is a new vote and gets its own acknowledgement');
  assert.notEqual(w.store.get('SELECT t FROM votes WHERE potato_id = ?', '0001').t, voteT);
});
