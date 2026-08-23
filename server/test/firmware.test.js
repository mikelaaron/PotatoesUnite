import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cmpVersion, offer } from '../lib/releases.js';
import { createApp } from '../lib/app.js';
import { World } from '../lib/world.js';
import { DATA_DIR, ASSETS_DIR } from './helpers.js';

test('version compare: equal, older, newer, and numeric parts', () => {
  assert.equal(cmpVersion('0.2.0', '0.2.0'), 0);
  assert.equal(cmpVersion('0.2.1', '0.2.0'), 1);
  assert.equal(cmpVersion('0.1.9', '0.2.0'), -1);
  assert.equal(cmpVersion('0.2.10', '0.2.9'), 1, 'numeric, not lexical');
  assert.equal(cmpVersion('1.0.0', '0.9.9'), 1);
  assert.equal(cmpVersion('v0.2.1', '0.2.1'), 0);
  assert.equal(cmpVersion('0.2', '0.2.0'), 0);
  assert.equal(offer({ version: '0.2.1', file: '0.2.1.bin', sha256: 'ab', size: 5 }, 'amoled18', '0.2.1'), null, 'equal: nothing newer');
  assert.equal(offer({ version: '0.2.1', file: '0.2.1.bin' }, 'amoled18', '0.3.0'), null, 'device ahead: nothing');
  assert.deepEqual(offer({ version: '0.2.1', file: '0.2.1.bin', sha256: 'ab', size: 5, notes: 'n' }, 'amoled18', '0.2.0'), { version: '0.2.1', url: '/releases/amoled18/0.2.1.bin', sha256: 'ab', size: 5, notes: 'n' });
});

test('GET /v0/firmware: 204 with nothing, 200 with the manifest once released; the binary route; the release script', async () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-rel-'));
  const logs = [];
  const w = new World({ dbPath: ':memory:', dataDir: DATA_DIR, assetsDir: ASSETS_DIR, releasesDir: releases, now: () => 1787648400 });
  const server = http.createServer(createApp({ world: w, illustrationsDir: null, artifactsDir: null, log: (...a) => logs.push(a.join(' ')) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(`${base}/v0/firmware?board=amoled18&fw=0.2.0`);
    assert.equal(r.status, 204, 'nothing released yet');
    assert.equal((await fetch(`${base}/v0/firmware?board=../x&fw=0.2.0`)).status, 400);
    // publish with the script
    const bin = path.join(releases, 'potato.ino.bin');
    const image = crypto.randomBytes(4096);
    fs.writeFileSync(bin, image);
    const out = spawnSync(process.execPath, [path.join(DATA_DIR, '..', 'scripts', 'release.js'), 'amoled18', bin, '0.2.1', 'Fixes the ceiling situation.'], { env: { ...process.env, RELEASES_DIR: releases }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(releases, 'amoled18', 'manifest.json'), 'utf8'));
    const sha = crypto.createHash('sha256').update(image).digest('hex');
    assert.deepEqual({ ...manifest, published: 'x' }, { version: '0.2.1', file: '0.2.1.bin', sha256: sha, size: 4096, notes: 'Fixes the ceiling situation.', published: 'x' });
    assert.match(manifest.published, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(fs.existsSync(path.join(releases, 'amoled18', '0.2.1.bin')));
    assert.ok(!fs.readdirSync(path.join(releases, 'amoled18')).some((f) => f.endsWith('.tmp')), 'atomic: no temp files left');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(releases, 'amoled18', 'manifest.json'), future, future); // make the mtime move within the same second
    // the device on 0.2.0 gets the manifest
    r = await fetch(`${base}/v0/firmware?board=amoled18&fw=0.2.0`);
    assert.equal(r.status, 200);
    const m = await r.json();
    assert.deepEqual(m, { version: '0.2.1', url: '/releases/amoled18/0.2.1.bin', sha256: sha, size: 4096, notes: 'Fixes the ceiling situation.' });
    assert.ok(logs.some((l) => /firmware check board=amoled18 fw=0.2.0 → 0\.2\.1/.test(l)), logs.join('\n'));
    assert.ok(!logs.some((l) => /secret/.test(l)));
    // equal and newer devices get 204; another board gets 204
    assert.equal((await fetch(`${base}/v0/firmware?board=amoled18&fw=0.2.1`)).status, 204);
    assert.equal((await fetch(`${base}/v0/firmware?board=amoled18&fw=0.3.0`)).status, 204);
    assert.equal((await fetch(`${base}/v0/firmware?board=epaper154&fw=0.1.0`)).status, 204);
    // the binary
    const b = await fetch(`${base}${m.url}`);
    assert.equal(b.status, 200);
    assert.equal(b.headers.get('content-type'), 'application/octet-stream');
    assert.equal(Number(b.headers.get('content-length')), 4096);
    const body = Buffer.from(await b.arrayBuffer());
    assert.ok(body.equals(image));
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), m.sha256);
    assert.equal((await fetch(`${base}/releases/amoled18/manifest.json`)).status, 404, 'only .bin files');
    assert.equal((await fetch(`${base}/releases/amoled18/..%2Fpotato.ino.bin`)).status, 404, 'no traversal');
    assert.equal((await fetch(`${base}/releases/amoled18/0.9.9.bin`)).status, 404);
    // a newer release replaces the offer
    fs.writeFileSync(bin, crypto.randomBytes(2048));
    assert.equal(spawnSync(process.execPath, [path.join(DATA_DIR, '..', 'scripts', 'release.js'), 'amoled18', bin, '0.2.2'], { env: { ...process.env, RELEASES_DIR: releases } }).status, 0);
    fs.utimesSync(path.join(releases, 'amoled18', 'manifest.json'), new Date(Date.now() + 10000), new Date(Date.now() + 10000));
    assert.equal((await (await fetch(`${base}/v0/firmware?board=amoled18&fw=0.2.1`)).json()).version, '0.2.2');
    // the script refuses nonsense
    assert.notEqual(spawnSync(process.execPath, [path.join(DATA_DIR, '..', 'scripts', 'release.js'), 'amoled18', bin, 'two'], { env: { ...process.env, RELEASES_DIR: releases } }).status, 0);
  } finally { server.close(); }
});
