import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET, fileText } from './helpers.js';

test('a replayed Tuesday prints the File the voice doc describes', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(1);
  const reg = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  assert.equal(reg.potato_id, '0001');
  assert.equal(reg.name, 'Doreen');
  assert.match(reg.claim_code, /^[A-Z]{3}-[A-Z0-9]{3}$/);

  set(at(7, 10)); hb(w, secret, [{ t: at(7, 10), type: 'pickup' }]);
  set(at(9, 0)); hb(w, secret, [{ t: at(9, 0), type: 'putdown' }]);
  set(at(12, 40)); hb(w, secret, [], { since_handled_s: 4 * 3600 });
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
  assert.ok(restored.request, 'a request was issued');
  const reqId = restored.request.id;
  set(at(21, 20));
  const done = hb(w, secret, [{ t: at(21, 20), type: 'request_done', request_id: reqId }]);
  assert.ok(done.line.length > 0, 'the potato acknowledges compliance');
  set(at(23, 5));
  const after = hb(w, secret, []);
  assert.match(after.line, /^You weren't here\./, 'the potato voted alone and says so');

  const f = w.file(reg.claim_code);
  const text = fileText(f);
  console.log('\n' + text);

  const tue = f.days.find((d) => d.header === 'TUE 25 AUG');
  assert.ok(tue, 'entries are grouped under TUE 25 AUG');
  const lines = tue.entries.map((e) => `${e.time}  ${e.text}  ${e.note}`.trim());
  assert.ok(lines.some((l) => l.startsWith('07:10  Picked up.  Morning.')), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('12:40  Quiet. 4 hours.')));
  assert.ok(lines.some((l) => l.startsWith('16:30  Placed in the dark.')));
  assert.ok(lines.some((l) => l === '21:15  Restored from the dark. 4h 45m.  Grievance filed.'));
  assert.ok(lines.some((l) => /^21:15  Request: .+  Complied \(5m\)\.$/.test(l)), lines.join('\n'));
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
  assert.equal(w.ack(claim_code), true);
  assert.equal(hb(w, secret, []).file_unread, 0);
  assert.equal(w.ack('NOPE-000'), false);
});
