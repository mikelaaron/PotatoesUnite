import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { makeWorld, at, hb, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';
import { renderBoard } from '../lib/pages.js';
import { createApp } from '../lib/app.js';
import { World } from '../lib/world.js';

const ILL_DIR = path.join(DATA_DIR, '..', '..', 'docs', 'illustrations');

function net(n, start = at(7, 0)) {
  const { w, set } = makeWorld({ start });
  for (let i = 1; i <= n; i++) w.register({ secret: SECRET(20 + i), board: 'amoled18', fw: '0.1.0' });
  return { w, set };
}

test('the front page never shows a bucket under five', () => {
  const { w, set } = net(6);
  set(at(10, 0));
  for (let i = 1; i <= 3; i++) hb(w, SECRET(20 + i), [{ t: at(10, 0), type: 'shake' }]);
  for (let i = 4; i <= 6; i++) hb(w, SECRET(20 + i), []);
  let b = w.board();
  assert.equal(b.population, 6);
  assert.equal(b.aggregates.shakes, 3);
  let html = renderBoard(b);
  assert.match(html, /<p class="pop">POPULATION: 6\.<\/p>/);
  assert.match(html, /<dt>Shakings<\/dt><dd>fewer than five<\/dd>/);
  set(at(10, 5));
  for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), [{ t: at(10, 5), type: 'shake' }]);
  html = renderBoard(w.board());
  assert.match(html, /<dt>Shakings<\/dt><dd>9<\/dd>/);
});

test('a net smaller than five: the committee line, and reports begin at five', () => {
  const { w, set } = net(3);
  set(at(10, 0));
  for (let i = 1; i <= 3; i++) hb(w, SECRET(20 + i), [{ t: at(10, 0), type: 'drop' }]);
  const b = w.board();
  assert.equal(b.small, true);
  const html = renderBoard(b);
  assert.match(html, /<p class="pop">POPULATION: FEWER THAN FIVE\. A COMMITTEE HAS ALREADY FORMED\.<\/p>/);
  assert.match(html, /<h2>On the Net Today<\/h2>\s*<p>Reports begin at five potatoes\.<\/p>/);
  assert.doesNotMatch(html, /fewer than five members|<dd>3<\/dd>/);
  assert.equal(b.missing.length, 0);
  assert.equal(b.potd, null);
  assert.equal(b.incident, null, 'no documented incident under five, even with drops');
});

test('the ballot card: before, open, and after the close', () => {
  const { w, set } = net(7);
  set(at(10, 0));
  for (let i = 1; i <= 7; i++) hb(w, SECRET(20 + i), []);
  let html = renderBoard(w.board());
  assert.match(html, /<section class="ballot"><span class="stamp">OPENS 13:00 UTC<\/span><h2>The Question<\/h2><p class="q">Ketchup\./);
  assert.match(html, /<div class="options"><div class="opt">HEINZ<\/div><div class="opt">HUNT&#39;S<\/div><div class="opt">WHATEVER&#39;S THERE<\/div><\/div>/);
  assert.match(html, /Votes are cast on the potato\. Yours has until <time data-utc="\d+" data-local-end>23:00 UTC<\/time> to respond<span class="local-slot"><\/span>\./);
  assert.doesNotMatch(html, /class="tally"/);
  set(at(14, 0));
  for (let i = 1; i <= 7; i++) hb(w, SECRET(20 + i), []);
  html = renderBoard(w.board());
  assert.match(html, /<span class="stamp">POLL OPEN<\/span>/);
  for (let i = 1; i <= 5; i++) w.choice({ secret: SECRET(20 + i), scene_rev: 1, choice_id: 'heinz' });
  for (let i = 6; i <= 7; i++) w.choice({ secret: SECRET(20 + i), scene_rev: 1, choice_id: 'hunts' });
  set(at(23, 1));
  const b = w.board();
  html = renderBoard(b);
  assert.equal(b.question.state, 'closed');
  assert.match(html, /<span class="stamp">COUNT IN<\/span>/);
  assert.match(html, /<section class="ballot">[^]*?<ul class="tally">[^]*?<\/section>/, 'the tally renders inside the card');
  assert.match(html, /HEINZ<\/span><span>5<\/span>/);
  assert.match(html, /HUNT&#39;S<\/span><span>fewer than five<\/span>/);
  assert.doesNotMatch(html, /class="options"/);
});

test('masthead: lede, clock, the return signal, nav, footer', () => {
  const { w, set } = net(1);
  set(at(10, 0));
  let html = renderBoard(w.board());
  assert.match(html, /<p class="lede">Every potato is connected to the Net\. When the Net reaches a conclusion, the Council announces it\.<\/p>/);
  assert.match(html, /<p class="next" data-next-utc="\d+" data-printed-utc="\d+">NEXT EDITION IN 13 H 0 MIN\.<\/p>/);
  assert.match(html, /The Net · TUE 25 AUG · Day 1 · <a href="\/about">About<\/a>/);
  assert.match(html, /<footer><p>No location\. No audio\. Public counts start at five potatoes\. <a href="\/about#privacy">Privacy record →<\/a><\/p><\/footer>/);
  assert.match(html, /<input id="claim-code" name="code" size="8" maxlength="8"/, 'room for the whole code');
  assert.match(html, /\.claim input \{[^}]*width: 12ch; height: 2\.4rem;[^}]*\}/);
  assert.match(html, /\.claim button \{[^}]*height: 2\.4rem;[^}]*\}/, 'input and button align');
  assert.match(html, /--red: #e0684f/, 'the marker red has a dark-theme value');
  assert.match(html, /\.lede \{ margin: 0 0 var\(--s2\); color: var\(--ink\); \}/, 'the lede is left-aligned prose');
  assert.doesNotMatch(html, /issued on/);
  assert.match(renderBoard(w.board(), { tuberUrl: 'https://x.com/thetuber' }), /<p>Editions are also issued on <a href="https:\/\/x\.com\/thetuber">X<\/a>\.<\/p>/);
  set(at(0, 5, 1)); // five minutes after the morning print
  html = renderBoard(w.board());
  assert.match(html, /EDITION PRINTED\. NEXT IN 23 H\./);
  assert.match(html, /<h2>The Bulletin · MORNING<\/h2><div class="small">No\. 2<\/div>/);
});

test('the documented incident image: the dark first, then a new member, never under five', () => {
  const { w, set } = net(6);
  set(at(10, 0));
  for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), []);
  assert.equal(w.board().incident, 'first-contact', 'six joined today');
  hb(w, SECRET(21), [{ t: at(10, 0), type: 'facedown_end', dur_s: 7 * 3600 }]);
  const b = w.board();
  assert.equal(b.aggregates.dark6, 1);
  assert.equal(b.incident, 'neglect');
  b.incidentSrc = '/illustrations/neglect.png';
  const html = renderBoard(b);
  assert.match(html, /<figure class="doc"><img src="\/illustrations\/neglect\.png" width="320" alt="" loading="lazy"><span class="label">DOCUMENTED\.<\/span><\/figure>/);
  assert.doesNotMatch(html, /<figcaption/);
  set(at(10, 0, 2));
  for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), []);
  assert.equal(w.board().incident, null, 'a quiet day: nothing documented');
  assert.doesNotMatch(renderBoard(w.board()), /class="doc"/);
});

test('earlier editions: hidden with one edition, three links later; the archive routes', async () => {
  const { w, set } = net(1);
  set(at(10, 0));
  assert.doesNotMatch(renderBoard(w.board()), /Earlier editions/);
  set(at(10, 0, 2)); hb(w, SECRET(21), []);
  const b = w.board();
  assert.equal(b.earlier.length, 3);
  const html = renderBoard(b);
  assert.match(html, /<h2>Earlier editions<\/h2><ul class="editions"><li><a href="\/editions\/2026-08-26\/evening">WED 26 AUG · EVENING — [^<]+<\/a><\/li><li><a href="\/editions\/2026-08-26\/morning">WED 26 AUG · MORNING — WEDNESDAY\.<\/a><\/li><li><a href="\/editions\/2026-08-25\/evening">/);
  const app = createApp({ world: w, illustrationsDir: ILL_DIR, artifactsDir: path.join(ASSETS_DIR, 'illustrations') });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const all = await (await fetch(`${base}/editions`)).text();
    assert.match(all, /<title>Potatoes Unite! — Editions<\/title>/);
    assert.match(all, /The Net · Editions · <a href="\/">Front page<\/a>/);
    assert.equal((all.match(/<article class="edition">/g) || []).length, 5);
    assert.match(all, /<h2><a href="\/editions\/2026-08-25\/morning">TUE 25 AUG · MORNING<\/a><\/h2>\s*<div class="small">No\. 1<\/div>\s*<p class="head">THE NET IS LIVE\.<\/p>/);
    const one = await fetch(`${base}/editions/2026-08-25/morning`);
    assert.equal(one.status, 200);
    const text = await one.text();
    assert.match(text, /<title>Potatoes Unite! — Edition No\. 1, morning<\/title>/);
    assert.equal((text.match(/<article class="edition">/g) || []).length, 1);
    assert.equal((await fetch(`${base}/editions/2026-08-20/morning`)).status, 404);
    assert.equal((await fetch(`${base}/editions/2026-08-25/noon`)).status, 404);
  } finally { server.close(); }
});
