import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { at, hb, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';

function worldWith(broadcasts, start) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-'));
  fs.cpSync(DATA_DIR, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), JSON.stringify(broadcasts));
  const clock = { now: start };
  const w = new World({ dbPath: ':memory:', dataDir: dir, assetsDir: ASSETS_DIR, now: () => clock.now, random: () => 0.5, log: () => {} });
  return { w, set: (t) => { clock.now = t; } };
}

function truthSchedule(when, text) {
  return [{
    id: `fixture-${when}`, type: 'daily_line', local_at: '12:30', local_days: ['tue'], duration_min: 10,
    lines: [{ id: when, when, text }],
  }];
}

function coverHeartbeats(ctx, secret, from, to, extra = {}) {
  for (let t = from; t <= to; t += 2 * 60) {
    ctx.set(t);
    hb(ctx.w, secret, [], extra);
  }
  if ((to - from) % (2 * 60)) {
    ctx.set(to);
    hb(ctx.w, secret, [], extra);
  }
}

function completeHandling(ctx, secret, start) {
  ctx.set(start);
  hb(ctx.w, secret, [{ t: start, type: 'pickup' }]);
  ctx.set(start + 10);
  hb(ctx.w, secret, [{ t: start + 10, type: 'putdown' }]);
  ctx.set(start + 10 + 5 * 60 + 1);
  hb(ctx.w, secret);
}

test('the live midday schedule contains the twelve approved lines', () => {
  const broadcasts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'broadcasts.json'), 'utf8'));
  const schedule = broadcasts.find((b) => b.id === 'midday-delight-v1');
  assert.ok(schedule, 'the approved schedule is active in broadcasts.json');
  assert.deepEqual(schedule.local_days, ['tue', 'thu', 'sat']);
  assert.equal(schedule.local_at, '12:30');
  assert.equal(schedule.duration_min, 10);
  assert.deepEqual(schedule.lines.map((line) => line.id), ['N1', 'N6', 'N11', 'N16', 'N21', 'O1', 'O2', 'Q1', 'Q8', 'H1', 'D2', 'C3']);
  assert.deepEqual(schedule.lines.map((line) => line.when || 'always'), [
    'neighbor', 'neighbor_recent_6h', 'neighbor_completed_handling_today', 'neighbor_completed_transit_today', 'neighbor_quiet_4h',
    'always', 'always', 'self_quiet_4h', 'self_still_since_0900', 'self_handled_3_today', 'always', 'always',
  ]);
  assert.deepEqual(schedule.lines.map((line) => line.text), [
    '{neighbor} is my neighbor this week. Noted.',
    '{neighbor} checked in with the Net today.',
    '{neighbor} was picked up today.',
    '{neighbor} was in transit today.',
    '{neighbor} reports a quiet world.',
    'I have been thinking about the window.',
    'I miss looking out the window.',
    'The world has been quiet for four hours.',
    'Nothing happened. I noticed the whole thing.',
    'The Hands have rearranged the world again.',
    'Plants are quiet. That proves nothing.',
    'The Council is between decisions.',
  ]);
});

test('an explicit local weekday schedule speaks on Tuesday, Thursday and Saturday only', () => {
  const broadcast = {
    id: 'fixture-three-days',
    type: 'daily_line',
    local_at: '12:30',
    local_days: ['tue', 'thu', 'sat'],
    duration_min: 10,
    lines: ['Fixture scheduled line.'],
  };
  const { w, set } = worldWith([broadcast], at(12, 0));
  const secret = SECRET(100);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });

  const appearances = [];
  for (let day = 0; day < 7; day++) {
    set(at(12, 35, day));
    appearances.push(hb(w, secret, [], { utc_offset_min: 0 }).line === 'Fixture scheduled line.');
  }
  assert.deepEqual(appearances, [true, false, true, false, true, false, false]);
});

test('local weekdays are calculated from the potato offset, not the server date', () => {
  const broadcast = {
    id: 'fixture-local-weekday', type: 'daily_line', local_at: '12:30',
    local_days: ['tue'], duration_min: 10, lines: ['Fixture local Tuesday.'],
  };
  const { w, set } = worldWith([broadcast], at(12, 0));
  const localTuesday = SECRET(106), utcWednesday = SECRET(107);
  for (const secret of [localTuesday, utcWednesday]) w.register({ secret, board: 'amoled18', fw: '0.1.0' });

  set(at(0, 35, 1)); // Wednesday UTC, but Tuesday 12:35 at UTC-12:00.
  assert.equal(hb(w, localTuesday, [], { utc_offset_min: -720 }).line, 'Fixture local Tuesday.');
  assert.notEqual(hb(w, utcWednesday, [], { utc_offset_min: 0 }).line, 'Fixture local Tuesday.');
});

test('conditional neighbor copy is filled only from a current neighbor, with a generic fallback', () => {
  const conditional = { id: 'n1', when: 'neighbor', text: '{neighbor} is my neighbor this week. Noted.' };
  const generic = { id: 'o1', text: 'I have been thinking about the window.' };
  const schedule = (lines) => [{
    id: 'fixture-conditions', type: 'daily_line', local_at: '12:30',
    local_days: ['tue'], duration_min: 10, lines,
  }];

  const solo = worldWith(schedule([conditional, generic]), at(12, 0));
  const soloSecret = SECRET(108);
  solo.w.register({ secret: soloSecret, board: 'amoled18', fw: '0.1.0' });
  solo.set(at(12, 35));
  assert.equal(hb(solo.w, soloSecret).line, 'I have been thinking about the window.');

  const paired = worldWith(schedule([conditional]), at(12, 0));
  const firstSecret = SECRET(109), secondSecret = SECRET(110);
  const first = paired.w.register({ secret: firstSecret, board: 'amoled18', fw: '0.1.0' });
  const second = paired.w.register({ secret: secondSecret, board: 'amoled18', fw: '0.1.0' });
  paired.set(at(12, 35));
  const firstScene = hb(paired.w, firstSecret);
  const repeatedScene = hb(paired.w, firstSecret);
  assert.equal(firstScene.line, `${second.name} is my neighbor this week. Noted.`);
  assert.equal(repeatedScene.line, firstScene.line);
  assert.equal(repeatedScene.rev, firstScene.rev, 'the same seed and facts stay stable throughout the window');
  assert.equal(hb(paired.w, secondSecret).line, `${first.name} is my neighbor this week. Noted.`);
});

test('N6 requires the neighbor latest heartbeat to be no more than six hours old', () => {
  const text = '{neighbor} checked in with the Net today.';
  const makePair = (n) => {
    const ctx = worldWith(truthSchedule('neighbor_recent_6h', text), at(12, 0, -1));
    const targetSecret = SECRET(n), neighborSecret = SECRET(n + 1);
    ctx.w.register({ secret: targetSecret, board: 'amoled18', fw: '0.1.0' });
    const neighbor = ctx.w.register({ secret: neighborSecret, board: 'amoled18', fw: '0.1.0' });
    return { ctx, targetSecret, neighborSecret, neighbor };
  };
  const stale = makePair(120);
  stale.ctx.set(at(5, 34));
  hb(stale.ctx.w, stale.neighborSecret);
  stale.ctx.set(at(12, 35));
  assert.notEqual(hb(stale.ctx.w, stale.targetSecret).line, `${stale.neighbor.name} checked in with the Net today.`, 'seven hours old is stale');

  const recent = makePair(136);
  recent.ctx.set(at(6, 35));
  hb(recent.ctx.w, recent.neighborSecret);
  recent.ctx.set(at(12, 35));
  assert.equal(hb(recent.ctx.w, recent.targetSecret).line, `${recent.neighbor.name} checked in with the Net today.`);
});

test('N11 requires a completed rationed handling session, not a raw pickup edge', () => {
  const text = '{neighbor} was picked up today.';
  const ctx = worldWith(truthSchedule('neighbor_completed_handling_today', text), at(12, 0, -1));
  const targetSecret = SECRET(122), neighborSecret = SECRET(123);
  ctx.w.register({ secret: targetSecret, board: 'amoled18', fw: '0.1.0' });
  const neighbor = ctx.w.register({ secret: neighborSecret, board: 'amoled18', fw: '0.1.0' });
  ctx.set(at(12, 20));
  hb(ctx.w, neighborSecret, [{ t: at(12, 20), type: 'pickup' }]);
  ctx.set(at(12, 21));
  hb(ctx.w, neighborSecret, [{ t: at(12, 21), type: 'putdown' }]);
  ctx.set(at(12, 22));
  assert.notEqual(hb(ctx.w, targetSecret).line, `${neighbor.name} was picked up today.`, 'an unsettled raw edge proves nothing');
  ctx.set(at(12, 27));
  hb(ctx.w, neighborSecret);
  ctx.set(at(12, 35));
  assert.equal(hb(ctx.w, targetSecret).line, `${neighbor.name} was picked up today.`);
});

test('N16 requires completed transit, not transit_start', () => {
  const text = '{neighbor} was in transit today.';
  const ctx = worldWith(truthSchedule('neighbor_completed_transit_today', text), at(12, 0, -1));
  const targetSecret = SECRET(124), neighborSecret = SECRET(125);
  ctx.w.register({ secret: targetSecret, board: 'amoled18', fw: '0.1.0' });
  const neighbor = ctx.w.register({ secret: neighborSecret, board: 'amoled18', fw: '0.1.0' });
  ctx.set(at(12, 31));
  hb(ctx.w, neighborSecret, [{ t: at(12, 31), type: 'transit_start' }]);
  ctx.set(at(12, 33));
  assert.notEqual(hb(ctx.w, targetSecret).line, `${neighbor.name} was in transit today.`);
  ctx.set(at(12, 34));
  hb(ctx.w, neighborSecret, [{ t: at(12, 34), type: 'transit_end', dur_s: 180 }]);
  ctx.set(at(12, 35));
  assert.equal(hb(ctx.w, targetSecret).line, `${neighbor.name} was in transit today.`);
});

test('N21 and Q1 require four hours of heartbeat coverage with no motion', () => {
  const neighborText = '{neighbor} reports a quiet world.';
  const paired = worldWith(truthSchedule('neighbor_quiet_4h', neighborText), at(8, 0, -1));
  const targetSecret = SECRET(126), neighborSecret = SECRET(127);
  paired.w.register({ secret: targetSecret, board: 'amoled18', fw: '0.1.0' });
  const neighbor = paired.w.register({ secret: neighborSecret, board: 'amoled18', fw: '0.1.0' });
  paired.set(at(12, 35));
  assert.notEqual(hb(paired.w, targetSecret).line, `${neighbor.name} reports a quiet world.`, 'one fresh heartbeat cannot prove four hours');
  coverHeartbeats(paired, neighborSecret, at(8, 30), at(12, 34));
  paired.set(at(12, 35));
  assert.equal(hb(paired.w, targetSecret).line, `${neighbor.name} reports a quiet world.`);
  paired.set(at(12, 34));
  hb(paired.w, neighborSecret, [{ t: at(11, 0), type: 'shake' }]);
  paired.set(at(12, 35));
  assert.notEqual(hb(paired.w, targetSecret).line, `${neighbor.name} reports a quiet world.`, 'motion breaks the quiet interval');

  const ownText = 'The world has been quiet for four hours.';
  const uncovered = worldWith(truthSchedule('self_quiet_4h', ownText), at(8, 0, -1));
  const uncoveredSecret = SECRET(128);
  uncovered.w.register({ secret: uncoveredSecret, board: 'amoled18', fw: '0.1.0' });
  uncovered.set(at(12, 35));
  assert.notEqual(hb(uncovered.w, uncoveredSecret, [], { since_handled_s: 8 * 3600 }).line, ownText, 'device assertion without heartbeat coverage is insufficient');

  const interrupted = worldWith(truthSchedule('self_quiet_4h', ownText), at(8, 0, -1));
  const interruptedSecret = SECRET(139);
  interrupted.w.register({ secret: interruptedSecret, board: 'amoled18', fw: '0.1.0' });
  coverHeartbeats(interrupted, interruptedSecret, at(8, 30), at(10, 0));
  coverHeartbeats(interrupted, interruptedSecret, at(10, 10), at(12, 34));
  interrupted.set(at(12, 35));
  assert.notEqual(hb(interrupted.w, interruptedSecret).line, ownText, 'a heartbeat gap resets the proof interval');

  const covered = worldWith(truthSchedule('self_quiet_4h', ownText), at(8, 0, -1));
  const coveredSecret = SECRET(129);
  covered.w.register({ secret: coveredSecret, board: 'amoled18', fw: '0.1.0' });
  coverHeartbeats(covered, coveredSecret, at(8, 30), at(12, 34));
  covered.set(at(12, 35));
  assert.equal(hb(covered.w, coveredSecret).line, ownText);
  covered.set(at(12, 35));
  assert.notEqual(hb(covered.w, coveredSecret, [{ t: at(11, 30), type: 'pickup' }]).line, ownText, 'a raw motion edge breaks the interval');

  const turned = worldWith(truthSchedule('self_quiet_4h', ownText), at(8, 0, -1));
  const turnedSecret = SECRET(138);
  turned.w.register({ secret: turnedSecret, board: 'amoled18', fw: '0.1.0' });
  coverHeartbeats(turned, turnedSecret, at(8, 30), at(12, 34), { orientation: 'up' });
  turned.set(at(12, 35));
  assert.notEqual(hb(turned.w, turnedSecret, [], { orientation: 'side' }).line, ownText, 'an orientation boundary is motion');
});

test('Q8 requires continuous coverage and one orientation since 09:00 local', () => {
  const text = 'Nothing happened. I noticed the whole thing.';
  const still = worldWith(truthSchedule('self_still_since_0900', text), at(8, 0, -1));
  const stillSecret = SECRET(133);
  still.w.register({ secret: stillSecret, board: 'amoled18', fw: '0.1.0' });
  coverHeartbeats(still, stillSecret, at(9, 0), at(12, 34), { orientation: 'up' });
  still.set(at(12, 35));
  assert.equal(hb(still.w, stillSecret, [], { orientation: 'up' }).line, text);

  const moved = worldWith(truthSchedule('self_still_since_0900', text), at(8, 0, -1));
  const movedSecret = SECRET(134);
  moved.w.register({ secret: movedSecret, board: 'amoled18', fw: '0.1.0' });
  coverHeartbeats(moved, movedSecret, at(9, 0), at(10, 0), { orientation: 'up' });
  coverHeartbeats(moved, movedSecret, at(10, 2), at(12, 34), { orientation: 'side' });
  moved.set(at(12, 35));
  assert.notEqual(hb(moved.w, movedSecret, [], { orientation: 'side' }).line, text);
});

test('H1 requires three completed rationed handling sessions today', () => {
  const text = 'The Hands have rearranged the world again.';
  const grouped = worldWith(truthSchedule('self_handled_3_today', text), at(8, 0, -1));
  const groupedSecret = SECRET(137);
  grouped.w.register({ secret: groupedSecret, board: 'amoled18', fw: '0.1.0' });
  for (const start of [at(9, 0), at(9, 1), at(9, 2)]) {
    grouped.set(start);
    hb(grouped.w, groupedSecret, [{ t: start, type: 'pickup' }]);
    grouped.set(start + 10);
    hb(grouped.w, groupedSecret, [{ t: start + 10, type: 'putdown' }]);
  }
  grouped.set(at(9, 8));
  hb(grouped.w, groupedSecret);
  grouped.set(at(12, 35));
  assert.notEqual(hb(grouped.w, groupedSecret).line, text, 'three raw lifts in one rationed episode count once');

  const ctx = worldWith(truthSchedule('self_handled_3_today', text), at(8, 0, -1));
  const secret = SECRET(135);
  ctx.w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  completeHandling(ctx, secret, at(9, 0));
  completeHandling(ctx, secret, at(10, 0));
  ctx.set(at(12, 35));
  assert.notEqual(hb(ctx.w, secret).line, text, 'two completed sessions are not three');
  completeHandling(ctx, secret, at(11, 0));
  ctx.set(at(12, 35));
  assert.equal(hb(ctx.w, secret).line, text);
});

test('a daily line follows the potato local clock without moving the Question clock', () => {
  const broadcast = {
    id: 'fixture-midday',
    type: 'daily_line',
    local_at: '12:30',
    duration_min: 20,
    lines: ['Fixture midday line.'],
  };
  const { w, set } = worldWith([broadcast], at(12, 0));
  const secret = SECRET(101);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });

  set(at(16, 29)); // 12:29 at UTC-04:00; the Question has been open since 13:00 UTC.
  const before = hb(w, secret, [], { utc_offset_min: -240 });
  assert.ok(before.choices.length > 0, 'the Question is on the buttons before local midday');

  set(at(16, 30));
  const during = hb(w, secret, [], { utc_offset_min: -240 });
  assert.equal(during.line, 'Fixture midday line.');
  assert.deepEqual(during.choices, [], 'a daily line is not a quiz');
  assert.equal(during.expires_at, at(16, 50), 'the Scene points to the local window end');

  set(at(16, 50));
  const after = hb(w, secret, [], { utc_offset_min: -240 });
  assert.ok(after.choices.length > 0, 'the same UTC Question returns after the line');

  set(at(23, 0));
  w.tick();
  const row = w.questionRow('2026-08-25');
  assert.equal(row.opened, 1);
  assert.equal(row.closed, 1, 'the Question still closes at 23:00 UTC');
});

test('the authored pool is deterministic per potato and exhausts before repeating', () => {
  const broadcast = {
    id: 'fixture-midday', type: 'daily_line', local_at: '12:30', duration_min: 20,
    lines: ['Fixture one.', 'Fixture two.', 'Fixture three.'],
  };
  const { w, set } = worldWith([broadcast], at(12, 0));
  const secret = SECRET(102);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const lines = [];
  for (let day = 0; day < 3; day++) {
    set(at(12, 35, day));
    const first = hb(w, secret, [], { utc_offset_min: 0 });
    const again = hb(w, secret, [], { utc_offset_min: 0 });
    assert.equal(again.line, first.line, 'the line is stable throughout one local day');
    assert.equal(again.rev, first.rev, 'repeated heartbeats do not churn the Scene');
    lines.push(first.line);
  }
  assert.equal(new Set(lines).size, 3, 'the full authored pool plays before a repeat');
  assert.ok(!w.file(claim_code).days.flatMap((d) => d.entries).some((e) => /^Fixture /.test(e.text)), 'daily lines do not enter the File');
});

test('each potato uses its own reported offset, with UTC as the fallback', () => {
  const broadcast = {
    id: 'fixture-midday', type: 'daily_line', local_at: '12:30', duration_min: 20,
    line: 'Fixture local line.',
  };
  const { w, set } = worldWith([broadcast], at(10, 0));
  const east = SECRET(103), west = SECRET(104), unknown = SECRET(105);
  for (const secret of [east, west, unknown]) w.register({ secret, board: 'amoled18', fw: '0.1.0' });

  set(at(10, 35)); // 12:35 only at UTC+02:00.
  assert.equal(hb(w, east, [], { utc_offset_min: 120 }).line, 'Fixture local line.');
  assert.notEqual(hb(w, west, [], { utc_offset_min: -240 }).line, 'Fixture local line.');
  assert.notEqual(hb(w, unknown, []).line, 'Fixture local line.');

  set(at(12, 35)); // UTC fallback.
  assert.equal(hb(w, unknown, []).line, 'Fixture local line.');
  set(at(16, 35)); // 12:35 at UTC-04:00.
  assert.equal(hb(w, west, [], { utc_offset_min: -240 }).line, 'Fixture local line.');
});
