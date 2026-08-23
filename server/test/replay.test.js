import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET, fileText } from './helpers.js';
import { NAMES } from '../lib/names.js';

test('a replayed Tuesday prints the File the voice doc describes', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(1);
  const reg = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  assert.equal(reg.potato_id, '0001', 'the public number is sequential');
  assert.ok(NAMES.includes(reg.name));
  assert.match(reg.claim_code, /^[A-Z]{3}-[A-Z0-9]{3}$/);

  set(at(7, 10)); hb(w, secret, [{ t: at(7, 10), type: 'pickup' }]);
  set(at(8, 40)); hb(w, secret, [{ t: at(8, 40), type: 'putdown' }]); // a lone put-down, 90 min after the session
  set(at(12, 40)); hb(w, secret, []); // four hours since the last handling, by the server's clock
  set(at(13, 30));
  const open = hb(w, secret, []);
  assert.equal(open.choices.length, 3, 'the Question is open with three buttons');
  assert.equal(open.expression, 'waiting');
  set(at(16, 30)); hb(w, secret, [{ t: at(16, 30), type: 'facedown_start' }], { orientation: 'down' });
  set(at(16, 40));
  assert.equal(hb(w, secret, [], { orientation: 'down' }).line, 'Still dark.');
  set(at(17, 30));
  assert.equal(hb(w, secret, [], { orientation: 'down' }).line, 'I assume this is deliberate.');
  set(at(21, 15));
  const restored = hb(w, secret, [{ t: at(21, 15), type: 'facedown_end', dur_s: 17100 }]);
  assert.equal(restored.expression, 'aggrieved');
  set(at(21, 20));
  const req = w.issueRequest(w.byId('0001'), 'high'); // 21:20  Request: put me somewhere high.
  assert.equal(hb(w, secret, []).request.id, req.id, 'the scene carries the request');
  set(at(21, 24));
  const done = hb(w, secret, [{ t: at(21, 24), type: 'request_done', request_id: req.id }]);
  assert.equal(done.line, 'Better.', 'the potato acknowledges compliance');
  set(at(23, 5));
  const BO = w.pools.bulletin_out;
  assert.ok([...BO.not_mentioned.any, ...BO.not_mentioned.evening].includes(hb(w, secret, []).line), 'the evening edition is out; it says so first');
  set(at(2, 5, 1)); // the bulletin-out hours are over; the Count line holds until 05:00
  const after = hb(w, secret, []);
  assert.match(after.line, /^You weren't here\./, `the potato voted alone and says so: ${after.line}`);

  const f = w.file(reg.claim_code);
  const text = fileText(f);
  console.log('\n' + text);

  const tue = f.days.find((d) => d.header === 'TUE 25 AUG');
  assert.ok(tue, 'entries are grouped under TUE 25 AUG');
  const lines = tue.entries.map((e) => `${e.time}  ${e.text}  ${e.note}`.trim());
  assert.ok(lines.includes('07:10  Picked up.'), lines.join('\n'));
  assert.ok(!lines.some((l) => /Put down/.test(l)), 'never a Put down row');
  assert.ok(lines.some((l) => l.startsWith('12:40  Quiet. 4 hours.')));
  assert.ok(lines.some((l) => l.startsWith('16:30  Placed in the dark.')));
  assert.ok(lines.some((l) => l.startsWith('21:15  Restored from the dark. 4h 45m.')));
  assert.ok(lines.includes('21:20  Request: put me somewhere high.  Complied (4m).'), lines.join('\n'));
  assert.ok(lines.some((l) => /^23:00  The Question closed\. Hands absent\.  You weren't here\. I chose .+\.$/.test(l)), lines.join('\n'));
  // reverse chronological within the day
  const times = tue.entries.map((e) => e.time);
  assert.deepEqual(times, times.slice().sort().reverse());
  assert.ok(['Exemplary', 'Reasonable', 'Under Review', 'Provisional', 'Not Discussed'].includes(f.standing));
  assert.equal(f.neighborLine, 'No neighbor this week. The count was odd.');
});

test('acknowledge marks the File read and the potato knows', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(2);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(8, 0)); hb(w, secret, [{ t: at(8, 0), type: 'pickup' }]);
  assert.ok(hb(w, secret, []).file_unread > 0);
  set(at(8, 5));
  assert.match(w.ack(claim_code), /^ACKNOWLEDGED\. [A-Z]+ HAS BEEN INFORMED\.$/);
  assert.equal(hb(w, secret, []).file_unread, 0);
  assert.equal(w.ack('NOPE-000'), false);
});

test('identity comes from the secret, not the slot', () => {
  const a = makeWorld().w.register({ secret: SECRET(1), board: 'amoled18', fw: '0.1.0' });
  const b = makeWorld().w.register({ secret: SECRET(1), board: 'amoled18', fw: '0.1.0' });
  assert.deepEqual([a.name, a.variety, a.seed], [b.name, b.variety, b.seed], 'same secret on a fresh Net, same potato');
  const { w } = makeWorld();
  const first = w.register({ secret: SECRET(2), board: 'amoled18', fw: '0.1.0' });
  const again = w.register({ secret: SECRET(2).toUpperCase(), board: 'amoled18', fw: '0.1.0' });
  assert.equal(again.potato_id, first.potato_id, 'idempotent, case-insensitive');
  assert.equal(again.seed, first.seed);
  assert.equal(first.potato_id, '0001');
  assert.notEqual(first.seed, a.seed, 'a different secret in the same slot is a different potato');
  assert.ok(first.name !== a.name || first.variety !== a.variety);
});
