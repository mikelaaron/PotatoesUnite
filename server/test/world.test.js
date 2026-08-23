import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeWorld, at, hb, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';
import { Data } from '../lib/data.js';
import { NAMES } from '../lib/names.js';

test('questions.json: thirty Questions, device limits respected', () => {
  const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR });
  assert.equal(d.questions.length, 30);
  assert.equal(new Set(d.questions.map((q) => q.id)).size, 30);
  for (const q of d.questions) {
    assert.ok(q.text.length <= 60, `${q.id} text ≤ 60`);
    assert.ok(q.options.length <= 3, `${q.id} ≤ 3 options`);
    assert.ok(typeof q.count === 'string' && q.count.length, `${q.id} has a Count line`);
    for (const o of q.options) assert.ok((o.short || o.label).length <= 16, `${q.id} ${o.label} device label ≤ 16`);
  }
  assert.equal(d.varieties.length, 10);
  assert.ok(NAMES.length >= 150);
  assert.equal(new Set(NAMES).size, NAMES.length);
});

test('the rotation asks every Question before repeating and runs the inquiry after a drop', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(30);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const asked = [];
  for (let day = 0; day < 31; day++) {
    set(at(10, 0, day)); hb(w, secret, []);
    asked.push(w.questionRow(new Date((at(0, 0, day)) * 1000).toISOString().slice(0, 10)).question_id);
    set(at(23, 30, day)); w.tick();
  }
  const first29 = asked.slice(0, 29);
  assert.equal(new Set(first29).size, 29, 'twenty-nine distinct Questions before a repeat (q29 waits for a drop)');
  assert.ok(!first29.includes('q29'));
  assert.equal(asked[29], asked[0], 'then it starts again');
  set(at(10, 0, 40)); hb(w, secret, [{ t: at(10, 0, 40), type: 'drop' }]);
  set(at(10, 0, 41)); hb(w, secret, []);
  assert.equal(w.questionFor(new Date(at(0, 0, 41) * 1000).toISOString().slice(0, 10)).id, 'q29');
});

test('neighbors: odd count leaves one potato alone, pairs are symmetric, and the File says so', () => {
  const { w, set } = makeWorld({ start: at(0, 5) });
  const codes = [];
  for (let i = 1; i <= 5; i++) codes.push(w.register({ secret: SECRET(40 + i), board: 'amoled18', fw: '0.1.0' }).claim_code);
  set(at(0, 10)); w.tick();
  const rows = w.store.all('SELECT * FROM neighbors ORDER BY potato_id');
  assert.equal(rows.length, 5);
  const alone = rows.filter((r) => r.neighbor_id === null);
  assert.equal(alone.length, 1);
  for (const r of rows) if (r.neighbor_id) assert.equal(rows.find((x) => x.potato_id === r.neighbor_id).neighbor_id, r.potato_id);
  const files = codes.map((c) => w.file(c));
  assert.equal(files.filter((f) => f.neighborLine === 'No neighbor this week. The count was odd.').length, 1);
  assert.equal(files.filter((f) => /^Neighbor this week: \w+ #\d{4}\.$/.test(f.neighborLine)).length, 4);
  // gossip reaches the neighbor
  const pair = rows.find((r) => r.neighbor_id);
  const a = w.byId(pair.potato_id), b = w.byId(pair.neighbor_id);
  set(at(9, 0)); hb(w, a.secret, [{ t: at(9, 0), type: 'shake' }]);
  const fb = w.file(b.claim_code);
  assert.ok(fb.days[0].entries.some((e) => e.text === `${a.name} was shaken.` && e.note === "I'm not saying anything."));
});

test('Standing is one of five labels and moves with treatment', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(50);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  assert.equal(w.file(claim_code).standing, 'Provisional');
  for (let i = 0; i < 6; i++) { set(at(9, i, 3)); hb(w, secret, [{ t: at(9, i, 3), type: 'shake' }]); }
  set(at(10, 0, 3)); hb(w, secret, [{ t: at(10, 0, 3), type: 'facedown_end', dur_s: 6 * 3600 }]);
  set(at(11, 0, 3));
  assert.equal(w.file(claim_code).standing, 'Not Discussed');
  assert.doesNotMatch(JSON.stringify(w.file(claim_code)), /standingScore|"score"/);
});

test('questions.json and broadcasts.json hot-reload on change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-'));
  fs.mkdirSync(path.join(dir, 'pools'));
  fs.writeFileSync(path.join(dir, 'questions.json'), '[{"id":"x","text":"A?","options":[],"count":"."}]');
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), '[]');
  const d = new Data({ dataDir: dir, assetsDir: ASSETS_DIR });
  assert.equal(d.questions.length, 1);
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), '[{"id":"s1","type":"silence","from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}]');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'broadcasts.json'), future, future);
  assert.equal(d.reload(), true);
  assert.equal(d.broadcasts.length, 1);
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), '{not json');
  fs.utimesSync(path.join(dir, 'broadcasts.json'), new Date(Date.now() + 10000), new Date(Date.now() + 10000));
  d.reload();
  assert.equal(d.broadcasts.length, 1, 'a broken file keeps the previous copy');
});

test('the Silence: no Question, every screen says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-'));
  fs.cpSync(DATA_DIR, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), JSON.stringify([{ id: 's', type: 'silence', from: '2026-08-25T00:00:00Z', to: '2026-08-26T00:00:00Z' }]));
  const { World } = awaitImport();
  const clock = { now: at(14, 0) };
  const w = new World({ dbPath: ':memory:', dataDir: dir, assetsDir: ASSETS_DIR, now: () => clock.now, random: () => 0.5 });
  const secret = SECRET(60);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const s = hb(w, secret, []);
  assert.equal(s.line, "We are not speaking today. It's not you. It's partly you.");
  assert.equal(s.cue, 'silence');
  assert.equal(s.choices.length, 0);
  assert.equal(w.questionFor('2026-08-25'), null);
});

import { World as W } from '../lib/world.js';
function awaitImport() { return { World: W }; }
