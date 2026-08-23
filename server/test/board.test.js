import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET } from './helpers.js';
import { renderBoard } from '../lib/pages.js';

function net(n, start = at(7, 0)) {
  const { w, set } = makeWorld({ start });
  for (let i = 1; i <= n; i++) w.register({ secret: SECRET(20 + i), board: 'amoled18', fw: '0.1.0' });
  return { w, set };
}

test('the board never shows a bucket under five', () => {
  const { w, set } = net(6);
  set(at(10, 0));
  for (let i = 1; i <= 3; i++) hb(w, SECRET(20 + i), [{ t: at(10, 0), type: 'shake' }]);
  for (let i = 4; i <= 6; i++) hb(w, SECRET(20 + i), []);
  let b = w.board();
  assert.equal(b.population, 6);
  assert.equal(b.aggregates.shakes, 3);
  let html = renderBoard(b);
  assert.match(html, /Population: 6\./);
  assert.match(html, /<dt>Shakings<\/dt><dd>fewer than five<\/dd>/);
  // now everyone is shaken
  set(at(10, 5));
  for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), [{ t: at(10, 5), type: 'shake' }]);
  b = w.board();
  html = renderBoard(b);
  assert.match(html, /<dt>Shakings<\/dt><dd>9<\/dd>/);
});

test('a net smaller than five withholds everything, including the population', () => {
  const { w, set } = net(3);
  set(at(10, 0));
  for (let i = 1; i <= 3; i++) hb(w, SECRET(20 + i), [{ t: at(10, 0), type: 'drop' }]);
  const b = w.board();
  assert.equal(b.small, true);
  const html = renderBoard(b);
  assert.match(html, /Population: fewer than five\./);
  assert.doesNotMatch(html, /<dd>3<\/dd>/);
  assert.equal(b.missing.length, 0);
  assert.equal(b.potd, null);
});

test('tally buckets under five read "fewer than five"; polls-close line before close', () => {
  const { w, set } = net(7);
  set(at(14, 0));
  for (let i = 1; i <= 7; i++) hb(w, SECRET(20 + i), []);
  let html = renderBoard(w.board());
  assert.match(html, /Polls close at <time data-utc="\d+">23:00 UTC<\/time>\./, 'UTC rendered server-side, instant attached for the viewer');
  assert.doesNotMatch(html, /class="tally"/);
  for (let i = 1; i <= 5; i++) w.choice({ secret: SECRET(20 + i), scene_rev: 1, choice_id: 'heinz' });
  for (let i = 6; i <= 7; i++) w.choice({ secret: SECRET(20 + i), scene_rev: 1, choice_id: 'hunts' });
  set(at(23, 1));
  const b = w.board();
  html = renderBoard(b);
  assert.equal(b.question.state, 'closed');
  assert.match(html, /class="tally"/);
  assert.match(html, /HEINZ<\/span><span>5<\/span>/);
  assert.match(html, /HUNT&#39;S<\/span><span>fewer than five<\/span>/);
  assert.match(html, /POTATOES UNITE!/);
});
