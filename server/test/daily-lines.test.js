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
