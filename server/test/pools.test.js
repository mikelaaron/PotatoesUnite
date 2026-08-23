// The bag: a pool plays out in full before any line returns, the order
// survives restarts (it lives in st.rx_n, not memory), and the rare line
// keeps its cadence — every tenth pick-up, always the same one per potato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, SECRET, hb } from './helpers.js';

const lineAt = (w, p, n) => w.reactionLine(p, { type: 'pickup', at: 1000 + n, dur_s: 0, n }).line;

test('the pick-up pool exhausts before any line repeats', () => {
  const { w } = makeWorld();
  const p = { seed: 424242, st: {} };
  const R = w.pools.reactions;
  const rare = new Set(R.pickup_rare);
  const lines = [];
  for (let n = 1; n <= 120; n++) lines.push(lineAt(w, p, n));

  // Never the same line twice running — the original Doreen complaint.
  for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1], `repeat at ${i}: ${lines[i]}`);

  // The rare line: exactly every tenth pick-up, and always the same one.
  const sigs = lines.filter((l) => rare.has(l));
  assert.equal(sigs.length, 12, `rare fired ${sigs.length} times in 120`);
  assert.equal(new Set(sigs).size, 1, 'one potato, one signature');

  // The core pool plays out in full each cycle: every 12 core picks cover all 12 lines.
  const core = lines.filter((l) => !rare.has(l));
  for (let c = 0; c + 12 <= core.length; c += 12) {
    assert.equal(new Set(core.slice(c, c + 12)).size, 12, `cycle at ${c} did not exhaust`);
  }
});

test('the pick is deterministic per seed and differs between potatoes', () => {
  const { w } = makeWorld();
  const a1 = Array.from({ length: 20 }, (_, i) => lineAt(w, { seed: 7, st: {} }, i + 1));
  const a2 = Array.from({ length: 20 }, (_, i) => lineAt(w, { seed: 7, st: {} }, i + 1));
  const b = Array.from({ length: 20 }, (_, i) => lineAt(w, { seed: 8, st: {} }, i + 1));
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
});

test('the tap pool is a bag too', () => {
  const { w } = makeWorld();
  const p = { seed: 99, st: {} };
  const n = w.pools.reactions.tap.length;
  const lines = Array.from({ length: n }, (_, i) => w.reactionLine(p, { type: 'tap', at: 1000 + i, n: i + 1 }).line);
  assert.equal(new Set(lines).size, n, 'the first pass covers every tap line');
});

test('three fresh pick-ups in a row say three different things', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(77);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  const all = new Set([...w.pools.reactions.pickup, ...w.pools.reactions.pickup_rare]);
  const seen = [];
  for (const [h, m] of [[9, 0], [9, 20], [9, 40]]) {
    set(at(h, m));
    const s = hb(w, secret, [{ t: at(h, m), type: 'pickup' }]);
    assert.ok(all.has(s.line), `a pick-up line: ${s.line}`);
    seen.push(s.line);
  }
  assert.equal(new Set(seen).size, 3, `three distinct lines: ${seen.join(' / ')}`);
});
