import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET } from './helpers.js';
import { renderFile } from '../lib/pages.js';

test('the File: portrait, facts, matters of record, the button before the record, the marker, the footer', () => {
  const { w, set } = makeWorld({ start: at(7, 0, -1) });
  const codes = [];
  for (let i = 1; i <= 2; i++) codes.push(w.register({ secret: SECRET(110 + i), board: 'amoled18', fw: '0.1.0' }).claim_code);
  set(at(9, 0)); hb(w, SECRET(111), [{ t: at(9, 0), type: 'pickup' }, { t: at(9, 0) + 30, type: 'putdown' }, { t: at(9, 2), type: 'shake' }]);
  set(at(9, 30)); hb(w, SECRET(111), [{ t: at(9, 10), type: 'facedown_start' }, { t: at(9, 30), type: 'facedown_end', dur_s: 2 * 3600 }]);
  const req = w.issueRequest(w.byId('0001'), 'high', at(9, 31));
  set(at(9, 35)); hb(w, SECRET(111), [{ t: at(9, 35), type: 'request_done', request_id: req.id }]);
  set(at(9, 45)); hb(w, SECRET(111), []);
  const f = w.file(codes[0]);
  f.key = 'a'.repeat(48);
  const html = renderFile(f);
  assert.match(html, /<svg class="portrait" viewBox="0 0 120 80" width="120"/);
  assert.match(html, new RegExp(`<h1>${f.name.toUpperCase()}</h1>\\s*<p class="tt id">#0001 · ${f.variety.name.toUpperCase()}`));
  assert.match(html, /<dl class="facts tt"><dt>Standing<\/dt><dd>PROVISIONAL<\/dd><dt>Current neighbor<\/dt><dd>[A-Z]+ #0002( · CURING)?<\/dd><\/dl>/);
  assert.match(html, new RegExp(`<p class="aside">${f.name} did not choose this\\.</p>`));
  assert.match(html, /<p class="tt since">\d+ ENTRIES FILED SINCE THE HANDS LAST ACKNOWLEDGED THE FILE\.<\/p>/);
  const iMatters = html.indexOf('<h2>Matters of record</h2>'), iForm = html.indexOf('<form class="ack"'), iRecord = html.indexOf('<h2>The record</h2>');
  assert.ok(iMatters > 0 && iMatters < iForm && iForm < iRecord, 'matters, then the button, then the chronology');
  assert.match(html, /<p class="tt marker">NEW SINCE LAST ACKNOWLEDGED<\/p>/);
  assert.match(html, /<footer class="tt file-foot">PRIVATE FILE · THE HANDS CANNOT ALTER THE RECORD\. ACKNOWLEDGMENT IS RECORDED\. NO LOCATION OR AUDIO IS STORED\.<\/footer>/);
  assert.doesNotMatch(html, /five potatoes|Put down/);
  assert.match(html, /action="\/file\/a{48}\/ack"/);
  // matters: the request and the two-hour dark, not the shake or the pickup
  const kinds = f.matters.map((m) => m.kind);
  assert.ok(kinds.includes('request_done') && kinds.includes('dark_end') && kinds.includes('neighbor_assigned'), kinds.join(','));
  assert.ok(!kinds.includes('shake') && !kinds.includes('pickup'), kinds.join(','));
  assert.ok(f.matters.find((m) => m.kind === 'request_done').note.startsWith('Complied ('), 'essential notes always show');
  // the record still has everything, folded
  const texts = f.days.flatMap((d) => d.entries).map((e) => e.text);
  assert.ok(texts.includes('Picked up. 30s.') && texts.includes('Shaken.') && texts.includes('Placed in the dark.'));
  assert.equal(f.unread, f.days.flatMap((d) => d.entries).length, 'the unread count counts folded entries');
});

test('a power episode: thresholds, the outage, the return and a relapse are one line', () => {
  const { w, set } = makeWorld({ start: at(7, 0, -1) });
  const secret = SECRET(120);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(9, 30)); hb(w, secret, [{ t: at(9, 0), type: 'battery_low', pct: 20 }, { t: at(9, 15), type: 'battery_low', pct: 10 }, { t: at(9, 30), type: 'battery_low', pct: 5 }]);
  set(at(16, 24)); hb(w, secret, [{ t: at(16, 24), type: 'dormant_resume', dur_s: 6 * 3600 + 54 * 60 }]);
  set(at(16, 31)); hb(w, secret, [{ t: at(16, 30), type: 'battery_low', pct: 1 }]);
  set(at(17, 0)); hb(w, secret, [{ t: at(17, 0), type: 'dormant_resume', dur_s: 20 * 60 }]);
  set(at(17, 40)); hb(w, secret, []);
  const all = w.file(claim_code).days.flatMap((d) => d.entries);
  const power = all.filter((e) => e.kind === 'power');
  assert.equal(power.length, 1, all.map((e) => `${e.kind}: ${e.text}`).join('\n'));
  assert.equal(power[0].text, 'Returned after 6h 54m dormant. Briefly went dormant again at 1%.');
  assert.ok(!all.some((e) => ['battery_low', 'dormant', 'dormant_resume', 'silent'].includes(e.kind)));
  assert.ok(w.file(claim_code).matters.some((m) => m.kind === 'power'), 'a power episode is a matter of record');
});

test('notes: about a third at most, by seed, and never on handling', () => {
  const { w, set } = makeWorld({ start: at(7, 0, -1) });
  const secret = SECRET(130);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  let t = at(8, 0);
  for (let i = 0; i < 30; i++) {
    set(t + 20); hb(w, secret, [{ t, type: 'pickup' }, { t: t + 15, type: 'putdown' }]);
    set(t + 10 * 60); hb(w, secret, [{ t: t + 5 * 60, type: 'facedown_start' }, { t: t + 10 * 60, type: 'facedown_end', dur_s: 3600 }]);
    t += 30 * 60;
  }
  set(t + 60 * 60); hb(w, secret, []);
  const all = w.file(claim_code).days.flatMap((d) => d.entries);
  const noted = all.filter((e) => e.note);
  assert.ok(all.length >= 60, `entries: ${all.length}`);
  assert.ok(noted.length / all.length <= 0.4, `${noted.length} of ${all.length} have notes`);
  assert.ok(!all.some((e) => ['pickup', 'tap', 'shake'].includes(e.kind) && e.note), 'a pickup, a tap, a shake never get a note');
  const allowed = new Set(['dark_end', 'curing', 'no_neighbor', 'neighbor_assigned', 'handled', 'power', 'sprouted', 'question_absent', 'question_present', 'question_withdrawn', 'request_done', 'request_expired', 'event_vote', 'event_absent']);
  assert.ok(noted.every((e) => allowed.has(e.kind)), noted.map((e) => e.kind).join(','));
});

test('matters of record rows carry the instant, so the script renders them local like the record', () => {
  const { w, set } = makeWorld({ start: at(7, 0, -1) });
  const secret = SECRET(140);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(15, 2)); hb(w, secret, [{ t: at(13, 0), type: 'facedown_start' }, { t: at(15, 2), type: 'facedown_end', dur_s: 2 * 3600 }]);
  let f = w.file(claim_code); f.key = 'b'.repeat(48);
  let html = renderFile(f);
  assert.match(html, /<div class="matters">\s*<div class="entry[^"]*"><span class="t" data-utc="\d+" data-local-daytime>TUE 25 AUG 15:02<\/span><span class="txt">Restored from the dark\. 2h 0m\.<\/span>/);
  assert.ok(html.includes("el.hasAttribute('data-local-daytime')) el.textContent = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()] + ' ' + f24(d);"), 'the script knows the day-and-time form');
  // a File already in the potato's own time is left alone
  hb(w, secret, [], { utc_offset_min: -240 });
  f = w.file(claim_code); f.key = 'b'.repeat(48);
  html = renderFile(f);
  assert.match(html, /<div class="matters">\s*<div class="entry[^"]*"><span class="t">TUE 25 AUG 11:02<\/span>/);
  assert.doesNotMatch(html, /data-local-daytime>/);
});

import http from 'node:http';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { DATA_DIR, ASSETS_DIR } from './helpers.js';

test('a board without touch votes from the File; a touch board cannot; after a vote the buttons are gone everywhere', async () => {
  const { w, set } = makeWorld({ start: at(7, 0) });
  const paper = SECRET(150), amoled = SECRET(151);
  const cPaper = w.register({ secret: paper, board: 'epaper154', fw: '0.2.1' }).claim_code;
  const cAmoled = w.register({ secret: amoled, board: 'amoled18', fw: '0.2.1' }).claim_code;
  const server = http.createServer(createApp({ world: w, illustrationsDir: null, artifactsDir: null }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenFor = (code) => w.mintToken(w.byClaim(code));
  try {
    set(at(14, 0));
    hb(w, paper, []); hb(w, amoled, []);
    const tp = tokenFor(cPaper), ta = tokenFor(cAmoled);
    // the paper's File: live buttons
    let html = await (await fetch(`${base}/file/${tp}`)).text();
    const name = w.byId('0001').name;
    assert.match(html, new RegExp(`<form class="options vote" method="post" action="/file/${tp}/vote"><button type="submit" class="opt" name="choice_id" value="heinz">HEINZ</button>`));
    assert.match(html, new RegExp(`<p class="aside">${name} cannot be tapped\\. ${name}&#39;s Hands may vote here\\. The Council has noted the irregularity\\.</p>`));
    assert.match(html, /<span class="stamp">POLL OPEN<\/span>/);
    // the AMOLED's File: read-only
    html = await (await fetch(`${base}/file/${ta}`)).text();
    assert.doesNotMatch(html, /class="options vote"|<button type="submit" class="opt"/);
    assert.match(html, /<div class="options"><div class="opt">HEINZ<\/div>/);
    assert.match(html, /<p class="aside">Votes are cast on the potato\.<\/p>/);
    // the Hands vote for the paper
    const r = await fetch(`${base}/file/${tp}/vote`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'choice_id=hunts' });
    assert.equal(r.status, 200);
    html = await r.text();
    assert.match(html, new RegExp(`<p class="tt informed">${name.toUpperCase()} HAS BEEN INFORMED\\.</p>`));
    assert.match(html, /<div class="opt win">HUNT&#39;S<\/div>/);
    assert.doesNotMatch(html, /<button type="submit" class="opt"/, 'buttons gone from the File');
    assert.match(html, /<span class="stamp">COUNT IN<\/span>/);
    const v = w.store.get('SELECT * FROM votes WHERE potato_id = ?', '0001');
    assert.equal(v.choice_id, 'hunts'); assert.equal(v.by_hands, 1);
    const scene = hb(w, paper, []);
    assert.equal(scene.line, "Hunt's. Noted.", 'the device gets the ack as usual');
    assert.equal(scene.choices.length, 0, 'and no buttons');
    // a second vote is a recount
    const again = await fetch(`${base}/file/${tp}/vote`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'choice_id=heinz' });
    assert.equal(again.status, 409);
    assert.equal(w.store.get('SELECT choice_id FROM votes WHERE potato_id = ?', '0001').choice_id, 'hunts');
    // the touch board cannot vote from the File
    assert.equal((await fetch(`${base}/file/${ta}/vote`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'choice_id=heinz' })).status, 403);
    w.choice({ secret: amoled, scene_rev: 1, choice_id: 'heinz' });
    html = await (await fetch(`${base}/file/${ta}`)).text();
    assert.match(html, /<div class="opt win">HEINZ<\/div>/);
    assert.doesNotMatch(html, /<button type="submit" class="opt"/);
    assert.equal(hb(w, amoled, []).choices.length, 0);
  } finally { server.close(); }
});
