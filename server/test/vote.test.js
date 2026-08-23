import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, at, hb, SECRET } from './helpers.js';

test('absent Hands: the potato votes by seed, deterministically, and the File says so', () => {
  const run = () => {
    const { w, set } = makeWorld();
    const secret = SECRET(3);
    const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
    set(at(14, 0)); hb(w, secret, []);
    set(at(23, 1)); w.tick();
    const f = w.file(claim_code);
    const e = f.days[0].entries.find((x) => x.kind === 'question_absent');
    return { e, tally: w.tally('2026-08-25'), vote: w.store.get('SELECT * FROM votes WHERE potato_id = ?', '0001') };
  };
  const a = run(), b = run();
  assert.ok(a.e, 'an absent entry exists');
  assert.equal(a.e.text, 'The Question closed. Hands absent.');
  assert.match(a.e.note, /^You weren't here\. I chose (Heinz|Hunt's|Whatever's there)\.$/);
  assert.equal(a.vote.by_hands, 0);
  assert.equal(a.vote.choice_id, b.vote.choice_id, 'same seed, same choice');
  assert.equal(a.tally.total, 1);
});

test('present Hands: the choice is recorded and the File says Hands present', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(4);
  const { claim_code } = w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(12, 0));
  assert.equal(w.choice({ secret, scene_rev: 1, choice_id: 'hunts' }).status, 409, 'before it opens');
  set(at(14, 0));
  const s = hb(w, secret, []);
  const r = w.choice({ secret, scene_rev: s.rev, choice_id: 'hunts' });
  assert.equal(r.status, 200);
  assert.equal(r.scene.line, "Hunt's. Noted.");
  assert.equal(r.scene.choices.length, 0, 'no buttons after voting');
  const r2 = w.choice({ secret, scene_rev: s.rev, choice_id: 'heinz' });
  assert.equal(r2.scene.line, 'Heinz. Noted.', 're-tapping before the close changes the vote');
});

test('unknown choice id is a 400; late choice is a 409 with a scene', () => {
  const { w, set } = makeWorld();
  const secret = SECRET(5);
  w.register({ secret, board: 'amoled18', fw: '0.1.0' });
  set(at(14, 0)); hb(w, secret, []);
  assert.throws(() => w.choice({ secret, scene_rev: 1, choice_id: 'nonsense' }), (e) => e.status === 400);
  set(at(23, 30));
  const late = w.choice({ secret, scene_rev: 1, choice_id: 'heinz' });
  assert.equal(late.status, 409);
  assert.equal(late.scene.line, 'The Question closed. I chose. It\'s in the File.');
});

test('the Count: majority, minority, and the File lines for present voters', () => {
  const { w, set } = makeWorld();
  const codes = [];
  for (let i = 1; i <= 3; i++) codes.push(w.register({ secret: SECRET(10 + i), board: 'amoled18', fw: '0.1.0' }).claim_code);
  set(at(14, 0));
  for (let i = 1; i <= 3; i++) hb(w, SECRET(10 + i), []);
  w.choice({ secret: SECRET(11), scene_rev: 1, choice_id: 'heinz' });
  w.choice({ secret: SECRET(12), scene_rev: 1, choice_id: 'heinz' });
  w.choice({ secret: SECRET(13), scene_rev: 1, choice_id: 'hunts' });
  set(at(23, 2)); w.tick();
  const t = w.tally('2026-08-25');
  assert.deepEqual(t.winners, ['heinz']);
  assert.equal(t.counts.heinz, 2);
  const f1 = w.file(codes[0]);
  const e1 = f1.days[0].entries.find((x) => x.kind === 'question_present');
  assert.equal(e1.text, 'The Question: ketchup.');
  assert.equal(e1.note, 'I voted Heinz. Hands present.');
  const s3 = hb(w, SECRET(13), []);
  assert.ok(/Hunt's|other way/.test(s3.line), `minority line: ${s3.line}`);
  const s1 = hb(w, SECRET(11), []);
  assert.ok(/majority|Acceptable/.test(s1.line), `majority line: ${s1.line}`);
});
