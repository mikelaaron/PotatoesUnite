import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { World } from '../lib/world.js';
import { makeWorld, at, hb, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';

const iso = (t) => new Date(t * 1000).toISOString();
const EVENT = (from, to) => ({
  id: 'e1', type: 'event', from: iso(from), to: iso(to), line: 'A crate has appeared.',
  choices: [{ id: 'open', label: 'OPEN IT' }, { id: 'ignore', label: 'IGNORE IT' }, { id: 'report', label: 'REPORT IT' }],
  result: 'The crate has been opened by {pct_open}%. Contents: undisclosed.', file: 'Asked about the crate.', after: 'Interesting.',
});

function worldWith(broadcasts, start) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-'));
  fs.cpSync(DATA_DIR, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broadcasts.json'), JSON.stringify(broadcasts));
  const clock = { now: start };
  const w = new World({ dbPath: ':memory:', dataDir: dir, assetsDir: ASSETS_DIR, now: () => clock.now, random: () => 0.5 });
  return { w, set: (t) => { clock.now = t; }, dir };
}

test('§16: the two hours after an edition prints, the potato says it has read it', () => {
  const { w, set } = makeWorld({ start: at(23, 30, -1) });
  const secret = SECRET(70);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(0, 5)); // the morning edition printed at 00:00
  const s = hb(w, secret, []);
  const BO = w.pools.bulletin_out;
  const notMentioned = [...BO.not_mentioned.any, ...BO.not_mentioned.morning];
  assert.ok(notMentioned.includes(s.line), `bulletin-out line: ${s.line}`);
  set(at(1, 55));
  assert.ok(notMentioned.includes(hb(w, secret, []).line), 'still within two hours');
  set(at(2, 5));
  assert.ok(!notMentioned.includes(hb(w, secret, []).line), 'and then it stops');
  // the potato that caused yesterday's incident is "mentioned" in the INCIDENT. edition
  set(at(10, 0)); hb(w, secret, [{ t: at(10, 0), type: 'drop' }]);
  set(at(0, 5, 1));
  const m = hb(w, secret, []);
  assert.equal(w.latestBulletin(at(0, 5, 1)).headline, 'INCIDENT.');
  assert.ok([...BO.mentioned.any, ...(BO.mentioned.morning || [])].includes(m.line), `mentioned line: ${m.line}`);
  // nothing in the File for any of this
  const f = w.file(w.byId('0001').claim_code);
  assert.ok(!f.days.flatMap((d) => d.entries).some((e) => /Bulletin|edition|paper/i.test(e.text)));
});

test('an ad-hoc event: buttons, votes, the File, the absent choice, the after line, the next Bulletin', () => {
  const { w, set } = worldWith([EVENT(at(9, 0), at(10, 0))], at(7, 0));
  const codes = [];
  for (let i = 1; i <= 5; i++) codes.push(w.register({ secret: SECRET(70 + i), board: 'amoled18', fw: '0.1.0' }).claim_code);
  set(at(9, 5));
  const s = hb(w, SECRET(71), []);
  assert.equal(s.line, 'A crate has appeared.');
  assert.deepEqual(s.choices.map((c) => c.id), ['open', 'ignore', 'report']);
  assert.equal(s.expression, 'waiting');
  for (let i = 1; i <= 4; i++) {
    const r = w.choice({ secret: SECRET(70 + i), scene_rev: 1, choice_id: 'open' });
    assert.equal(r.status, 200);
    assert.equal(r.scene.line, 'Open it. Noted.');
    assert.equal(r.scene.choices.length, 0);
  }
  assert.equal(w.choice({ secret: SECRET(71), scene_rev: 1, choice_id: 'ignore' }).status, 409, 'no recounts on events either');
  hb(w, SECRET(75), []); // the fifth is awake but says nothing
  assert.equal(w.file(codes[0]).days[0].entries[0].text, 'Asked about the crate: Open it.');
  set(at(10, 1)); w.tick();
  const f5 = w.file(codes[4]);
  assert.equal(f5.days[0].entries[0].text, 'Asked about the crate. Hands absent.');
  assert.ok(w.store.get('SELECT * FROM votes WHERE day = ? AND potato_id = ?', 'event:e1', '0005'), 'seed vote recorded');
  const after = hb(w, SECRET(71), []);
  assert.equal(after.line, 'Interesting.');
  set(at(10, 12));
  assert.notEqual(hb(w, SECRET(71), []).line, 'Interesting.', 'the after line lasts ten minutes');
  set(at(23, 1)); w.tick();
  const evening = w.bulletin('2026-08-25', 'evening');
  assert.ok(evening.items.some((i) => /^The crate has been opened by (80|100)%\. Contents: undisclosed\.$/.test(i)), evening.items.join('\n'));
  set(at(0, 1, 1)); w.tick();
  assert.ok(!w.bulletin('2026-08-26', 'morning').items.some((i) => /crate/.test(i)), 'published once');
});

test('an event waits while the daily Question is live; a small Net gets no numbers', () => {
  const { w, set } = worldWith([EVENT(at(14, 0), at(15, 0))], at(7, 0));
  const secret = SECRET(80);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(14, 5));
  const s = hb(w, secret, []);
  assert.deepEqual(s.choices.map((c) => c.id), ['heinz', 'hunts', 'whatever'], 'the Question wins the buttons');
  w.choice({ secret, scene_rev: 1, choice_id: 'heinz' });
  set(at(15, 1)); w.tick();
  assert.equal(w.file(claim_code).days[0].entries[0].text, 'Asked about the crate. Hands absent.');
  set(at(23, 1)); w.tick();
  assert.ok(w.bulletin('2026-08-25', 'evening').items.includes('The Council does not publish small Counts.'));
});

test('npm run push: line, event, clear', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'potato-')), 'broadcasts.json');
  fs.writeFileSync(file, '[]');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [path.join(DATA_DIR, '..', 'scripts', 'push.js'), ...args], { env: { ...process.env, BROADCASTS_PATH: file }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  assert.equal(run('line', 'The Council is watching the plant.', '20m').code, 0);
  const ev = run('event', 'A crate has appeared.', 'OPEN IT|IGNORE IT|REPORT IT', '30m', '--file', 'Asked about the crate.', '--after', 'Interesting.');
  assert.equal(ev.code, 0, ev.err);
  let list = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'line'); assert.equal(list[0].id, 'l1');
  assert.equal(list[1].id, 'e1');
  assert.deepEqual(list[1].choices, [{ id: 'open_it', label: 'OPEN IT' }, { id: 'ignore_it', label: 'IGNORE IT' }, { id: 'report_it', label: 'REPORT IT' }]);
  assert.equal(list[1].file, 'Asked about the crate.');
  assert.equal(list[1].after, 'Interesting.');
  assert.match(list[1].result, /\{pct_open_it\}%/);
  assert.ok(Date.parse(list[1].to) - Date.parse(list[1].from) === 30 * 60 * 1000);
  assert.notEqual(run('event', 'x'.repeat(61), 'A|B').code, 0, 'a long line is refused');
  assert.notEqual(run('event', 'Hm.', 'A LABEL THAT IS FAR TOO LONG|B').code, 0, 'a long label is refused');
  list.push({ id: 'l9', type: 'line', from: '2020-01-01T00:00:00Z', to: '2020-01-01T01:00:00Z', line: 'old' });
  fs.writeFileSync(file, JSON.stringify(list));
  assert.match(run('clear').out, /cleared 1 expired; 2 remain/);
});
