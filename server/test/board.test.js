import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeWorld, at, hb, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';
import { renderBoard, renderEditions } from '../lib/pages.js';
import { createApp } from '../lib/app.js';
import { World } from '../lib/world.js';

const ILL_DIR = path.join(DATA_DIR, '..', '..', 'docs', 'illustrations');

function net(n, start = at(7, 0)) {
  const { w, set } = makeWorld({ start });
  for (let i = 1; i <= n; i++) w.register({ secret: SECRET(20 + i), board: 'amoled18', fw: '0.1.0' });
  return { w, set };
}

// A Net whose data directory is this one with a file swapped: a Silence, or a Question that was withdrawn.
function netWith(files, n = 6, start = at(7, 0)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-'));
  fs.cpSync(DATA_DIR, dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const clock = { now: start };
  const w = new World({ dbPath: ':memory:', dataDir: dir, assetsDir: ASSETS_DIR, now: () => clock.now, random: () => 0.5, log: () => {} });
  for (let i = 1; i <= n; i++) w.register({ secret: SECRET(20 + i), board: 'amoled18', fw: '0.1.0' });
  return { w, set: (t) => { clock.now = t; } };
}

// One day's Net, run past the close so both of its editions have printed.
function aDay(mk = () => net(6)) {
  const { w, set } = mk();
  set(at(14, 0));
  for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), []);
  set(at(23, 30));
  w.tick();
  return { w, set };
}

const edition = (w, day, ed) => renderEditions([w.withQuestion(w.bulletin(day, ed))], { single: true });

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
  assert.match(html, /<footer><p>No location\. No audio\. Public counts start at five potatoes\. <a href="\/about#privacy">Privacy record&nbsp;→<\/a><\/p><\/footer>/);
  assert.match(html, /<input id="claim-code" name="code" size="8" maxlength="8"/, 'room for the whole code');
  assert.match(html, /\.claim input \{[^}]*width: 12ch; height: 2\.4rem;[^}]*\}/);
  assert.match(html, /\.claim button \{[^}]*height: 2\.4rem;[^}]*\}/, 'input and button align');
  assert.match(html, /--red: #e0684f/, 'the marker red has a dark-theme value');
  assert.match(html, /\.lede \{ margin: 0 0 var\(--s2\); color: var\(--ink\); \}/, 'the lede is left-aligned prose');
  assert.doesNotMatch(html, /issued on/);
  assert.match(renderBoard(w.board(), { tuberUrl: 'https://x.com/thetuber' }), /<p>Editions are also issued on X: <a href="https:\/\/x\.com\/thetuber">@thetuber<\/a>\.<\/p>/);
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

// An edition read months later has to make sense on its own. "THE COUNT IS IN." and a remark about being
// served with ketchup mean nothing to a reader who was never told what was asked.
test("an edition states the day's Question: put in the morning, settled in the evening", () => {
  const { w } = aDay();
  const Q = 'Ketchup. Which would you least object to being served with?';
  assert.equal(w.questionFor('2026-08-25').text, Q, 'the day keeps its Question, so an archived edition can still name it');
  assert.equal(w.withQuestion(w.bulletin('2026-08-25', 'evening')).question, Q);

  const evening = edition(w, '2026-08-25', 'evening');
  assert.match(evening, /<\/p>\n<p class="asked">The Question put to the Net: Ketchup\. Which would you least object to being served with\?<\/p>\n<ul class="items">/,
    'the deck sits under the headline and above the items it explains');
  const morning = edition(w, '2026-08-25', 'morning');
  assert.match(morning, /<\/p>\n<p class="asked">The Question before the Net today: Ketchup\. Which would you least object to being served with\?<\/p>\n<ul class="items">/);
  // The Question's text, never its Count. Nothing new here can publish a tally under five.
  assert.doesNotMatch(evening.match(/<p class="asked">[^<]*<\/p>/)[0], /[0-9]/);
  assert.match(evening, /\.edition \.asked \{ color: var\(--faint\)/, 'faint serif, inside the type system the page already has');
});

test('the Silence: an edition with no Question prints no deck, and no lead-in with nothing after it', () => {
  const { w } = aDay(() => netWith({ 'broadcasts.json': [{ id: 's', type: 'silence', from: '2026-08-25T00:00:00Z', to: '2026-08-26T00:00:00Z' }] }));
  assert.equal(w.questionFor('2026-08-25'), null);
  assert.equal(w.withQuestion(w.bulletin('2026-08-25', 'evening')).question, '');
  for (const ed of ['morning', 'evening']) {
    const html = edition(w, '2026-08-25', ed);
    assert.doesNotMatch(html, /class="asked"/, `${ed}: no deck at all`);
    assert.doesNotMatch(html, /The Question (put|before) the Net/);
    assert.doesNotMatch(html, /<p[^>]*>\s*<\/p>/, 'and no empty paragraph where the Question would have been');
    assert.match(html, /No Question today|There was no Question today/, 'the items already say so');
  }
});

test('a withdrawn Question is still named: WITHDRAWN. means nothing until the page says what was', () => {
  const { w } = aDay(() => netWith({
    'questions.json': [{
      id: 'qw', text: 'Butter or sour cream?', topic: 'butter', bulletin: 'butter or sour cream', withdrawn: true,
      options: [{ id: 'butter', label: 'BUTTER' }, { id: 'sour', label: 'SOUR CREAM' }],
      remark: 'This Question has been withdrawn. The member who proposed it has been spoken to.',
    }],
  }));
  const evening = edition(w, '2026-08-25', 'evening');
  assert.match(evening, /<p class="head">WITHDRAWN\.<\/p>\n<p class="asked">The Question put to the Net: Butter or sour cream\?<\/p>/);
  assert.match(evening, /<li>This Question has been withdrawn\./, 'the remark still follows, as the ballot card does it');
});

test('the archive: every edition renders, and a day states its Question once, not twice', async () => {
  const { w, set } = net(6);
  set(at(23, 30)); for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), []);
  set(at(23, 30, 1)); for (let i = 1; i <= 6; i++) hb(w, SECRET(20 + i), []);
  const app = createApp({ world: w, illustrationsDir: ILL_DIR, artifactsDir: path.join(ASSETS_DIR, 'illustrations') });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const all = await (await fetch(`${base}/editions`)).text();
    const articles = all.split('<article class="edition">').slice(1);
    assert.equal(articles.length, 4, 'two days, two editions each');
    assert.equal(articles.filter((a) => /class="asked"/.test(a)).length, 2, 'the Question belongs to the day: once per day, not once per edition');
    assert.ok(/\/editions\/2026-08-26\/evening/.test(articles[0]));
    assert.match(articles[0], /<p class="asked">The Question put to the Net: Are fries still potatoes\?<\/p>/, 'on the edition carrying the Count');
    assert.ok(/\/editions\/2026-08-26\/morning/.test(articles[1]));
    assert.doesNotMatch(articles[1], /class="asked"/, 'and not again on the same day’s morning, which would only be noise');
    assert.match(articles[2], /<p class="asked">The Question put to the Net: Ketchup\./, 'the day before, once');
    const one = await (await fetch(`${base}/editions/2026-08-26/morning`)).text();
    assert.match(one, /<p class="asked">The Question before the Net today: Are fries still potatoes\?<\/p>/, "a morning's own page always states it");
  } finally { server.close(); }
});
