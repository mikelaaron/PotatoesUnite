import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { makeWorld, SECRET, DATA_DIR, ASSETS_DIR } from './helpers.js';

const ILL_DIR = path.join(DATA_DIR, '..', '..', 'docs', 'illustrations');
const ART_DIR = path.join(ASSETS_DIR, 'illustrations');

async function serve(w, extra = {}) {
  const server = http.createServer(createApp({ world: w, illustrationsDir: ILL_DIR, artifactsDir: ART_DIR, ...extra }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init });

test('the claim code buys a long token; the File lives at the token, never at the code', async () => {
  const { w } = makeWorld();
  const { claim_code } = w.register({ secret: SECRET(100), board: 'amoled18', fw: '0.1.0' });
  const { server, base } = await serve(w);
  try {
    const r = await get(`${base}/claim/${claim_code}`);
    assert.equal(r.status, 302);
    const loc = r.headers.get('location');
    assert.match(loc, /^\/file\/[a-f0-9]{48}$/, 'a 192-bit token');
    const token = loc.split('/').pop();
    assert.equal(w.store.get('SELECT COUNT(*) n FROM tokens').n, 1);
    assert.notEqual(w.store.get('SELECT hash FROM tokens').hash, token, 'stored hashed');
    const file = await get(`${base}${loc}`);
    assert.equal(file.status, 200);
    assert.match(await file.text(), /<h1>[A-Z]+<\/h1>/);
    const short = await get(`${base}/file/${claim_code}`);
    assert.equal(short.status, 404);
    assert.match(await short.text(), /The Council has no record of that claim code\./);
    assert.equal((await get(`${base}/file/${'0'.repeat(48)}`)).status, 404, 'an unknown token');
    const miss = await get(`${base}/claim/NOPE-000`);
    assert.equal(miss.status, 404);
    assert.match(await miss.text(), /The Council has no record of that claim code\./);
    const form = await get(`${base}/claim`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${claim_code.toLowerCase()}` });
    assert.equal(form.status, 302, 'the front-page field, case-insensitive');
    assert.match(form.headers.get('location'), /^\/file\/[a-f0-9]{48}$/);
    assert.equal(w.store.get('SELECT COUNT(*) n FROM tokens').n, 2, 'each claim mints its own token');
    // the acknowledgement is the only thing that marks the File read, and it answers with one line
    const before = w.byId('0001').file_read_t;
    await get(`${base}${loc}`);
    assert.equal(w.byId('0001').file_read_t, before, 'a page load never marks the File read');
    const ack = await get(`${base}${loc}/ack`, { method: 'POST' });
    assert.equal(ack.status, 200);
    const text = await ack.text();
    assert.match(text, /ACKNOWLEDGED\. [A-Z]+ HAS BEEN INFORMED\./);
    assert.doesNotMatch(text, /<h2>|<form|class="mast"/, 'nothing else');
    assert.ok(w.byId('0001').file_read_t > before);
  } finally { server.close(); }
});

test('claims are rate-limited: ten attempts per address per minute', async () => {
  const { w } = makeWorld();
  const { server, base } = await serve(w);
  try {
    for (let i = 0; i < 10; i++) assert.equal((await get(`${base}/claim/ZZZ-000`)).status, 404);
    const r = await get(`${base}/claim/ZZZ-000`);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '60');
    assert.match(await r.text(), /The Council is not taking further attempts/);
  } finally { server.close(); }
});
