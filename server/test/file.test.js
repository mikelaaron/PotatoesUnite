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
