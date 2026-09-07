import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../lib/app.js';
import { World } from '../lib/world.js';
import { renderAbout } from '../lib/pages.js';
import { storyToHtml } from '../lib/markdown.js';
import { Data } from '../lib/data.js';
import { DATA_DIR, ASSETS_DIR } from './helpers.js';

const DOCS_DIR = path.join(DATA_DIR, '..', '..', 'docs');
const VENDOR_DIR = path.join(DATA_DIR, '..', 'vendor');

async function serve(opts = {}) {
  const w = opts.world || new World({ dbPath: ':memory:', dataDir: DATA_DIR, assetsDir: ASSETS_DIR, now: () => 1787648400, ...opts.worldOpts });
  const server = http.createServer(createApp({ world: w, illustrationsDir: null, artifactsDir: null, ...opts.app }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { w, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('/flash: a card with an image gets Connect, a card without one gets the Council; portraits, module, join flow', async () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-fl-'));
  fs.mkdirSync(path.join(releases, 'amoled18'));
  fs.writeFileSync(path.join(releases, 'amoled18', 'webflash.json'), JSON.stringify({ name: 'Potatoes Unite', builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: 'webflash-0.2.1.bin', offset: 0 }] }] }));
  fs.writeFileSync(path.join(releases, 'amoled18', 'webflash-0.2.1.bin'), Buffer.alloc(4096, 7));
  const { server, base } = await serve({ worldOpts: { releasesDir: releases }, app: { githubUrl: 'https://github.com/example/potatoes-unite' } });
  try {
    const r = await fetch(`${base}/flash`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<script type="module" src="\/vendor\/esp-web-tools\/install-button\.js"><\/script>/);
    assert.match(html, /<esp-web-install-button manifest="\/releases\/amoled18\/webflash\.json">/);
    // the paper has no image in this deploy: no button, no dead manifest reference, one honest line instead
    assert.doesNotMatch(html, /releases\/epaper154\/webflash\.json/);
    assert.match(html, /<p class="not-issued">No image for this board yet\. The Council does not publish a schedule\.<\/p>/);
    assert.equal((html.match(/<esp-web-install-button/g) || []).length, 1);
    assert.match(html, /THE AMOLED CITIZEN/i);
    assert.match(html, /votes by button/);
    assert.equal((html.match(/<svg class="portrait"/g) || []).length, 2);
    assert.match(html, /Chrome or Edge, on a computer, with a USB data cable\./);
    assert.match(html, /<span slot="unsupported"/);
    assert.match(html, /<noscript>[^]*esptool[^]*<\/noscript>/);
    assert.match(html, /POTATO-xxxx/);
    assert.match(html, /<a href="\/flash\/agent">Or hand this page to your coding agent →<\/a>/);
    assert.match(html, /Tested on exactly these two devices\./);
    assert.match(html, /<a href="https:\/\/github\.com\/example\/potatoes-unite">CODE&nbsp;→<\/a>/);
    // the manifest and the merged image resolve
    const man = await fetch(`${base}/releases/amoled18/webflash.json`);
    assert.equal(man.status, 200);
    assert.equal(man.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await man.json()).builds[0].parts[0].path, 'webflash-0.2.1.bin');
    const bin = await fetch(`${base}/releases/amoled18/webflash-0.2.1.bin`);
    assert.equal(bin.status, 200);
    assert.equal(bin.headers.get('content-type'), 'application/octet-stream');
    assert.equal(Number(bin.headers.get('content-length')), 4096);
    assert.equal((await fetch(`${base}/releases/epaper154/webflash.json`)).status, 404, 'no release for the paper yet');
    // the front page links to the flasher
    assert.match(await (await fetch(`${base}/`)).text(), /<a href="\/flash">Flash<\/a>/);
  } finally { server.close(); }
});

test('/flash: no manifests at all — every card declines, nothing looks like a button, the nav stops advertising it', async () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-fl-empty-'));
  const { server, base } = await serve({ worldOpts: { releasesDir: releases } });
  try {
    const r = await fetch(`${base}/flash`);
    assert.equal(r.status, 200);
    const html = await r.text();
    // both cards are still there, with their portraits — they just have nothing to install
    assert.equal((html.match(/<svg class="portrait"/g) || []).length, 2);
    assert.match(html, /THE AMOLED CITIZEN/i);
    assert.match(html, /THE E-PAPER CITIZEN/i);
    assert.equal((html.match(/<p class="not-issued">No image for this board yet\. The Council does not publish a schedule\.<\/p>/g) || []).length, 2);
    assert.match(html, /<p class="notice">The flasher is closed\. The Council has not said when it opens\.<\/p>/);
    // nothing that reads as an install control, and nothing pointing at an image that isn't there
    assert.doesNotMatch(html, /<esp-web-install-button/);
    assert.doesNotMatch(html, /class="connect"/);
    assert.doesNotMatch(html, /install-button\.js/);
    assert.doesNotMatch(html, /webflash\.json/);
    assert.doesNotMatch(html, /esptool/, 'no one-liner for an image nobody can download');
    assert.doesNotMatch(html, /\/flash\/agent/, 'the agent procedure fetches a binary that is not there either');
    // which is the truth: both manifests are 404
    assert.equal((await fetch(`${base}/releases/amoled18/webflash.json`)).status, 404);
    assert.equal((await fetch(`${base}/releases/epaper154/webflash.json`)).status, 404);
    // and the front page does not send strangers there
    const front = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(front, /href="\/flash"/);
    assert.match(front, /<a href="\/about">About<\/a>/, 'the rest of the nav is untouched');
  } finally { server.close(); }
});

test('/flash: both manifests present — both cards keep their Connect button and the front page keeps the link', async () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-fl-both-'));
  for (const board of ['amoled18', 'epaper154']) {
    fs.mkdirSync(path.join(releases, board));
    fs.writeFileSync(path.join(releases, board, 'webflash.json'), JSON.stringify({ name: 'Potatoes Unite', builds: [] }));
  }
  const { server, base } = await serve({ worldOpts: { releasesDir: releases } });
  try {
    const html = await (await fetch(`${base}/flash`)).text();
    assert.match(html, /<esp-web-install-button manifest="\/releases\/amoled18\/webflash\.json">/);
    assert.match(html, /<esp-web-install-button manifest="\/releases\/epaper154\/webflash\.json">/);
    assert.equal((html.match(/<button slot="activate" class="connect">Connect<\/button>/g) || []).length, 2);
    assert.doesNotMatch(html, /<p class="not-issued">|The flasher is closed/);
    assert.match(html, /<noscript>[^]*esptool[^]*<\/noscript>/);
    assert.match(await (await fetch(`${base}/`)).text(), /<a href="\/flash">Flash<\/a>/);
  } finally { server.close(); }
});

test('the vendored esp-web-tools module is served locally with the right type, to closure', async () => {
  const { server, base } = await serve({});
  try {
    const entry = await fetch(`${base}/vendor/esp-web-tools/install-button.js`);
    assert.equal(entry.status, 200);
    assert.equal(entry.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const src = await entry.text();
    assert.ok(src.length > 1000);
    // every relative import the entry names must itself resolve
    for (const m of src.matchAll(/(?:import\(|from)\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g)) {
      const dep = await fetch(`${base}/vendor/esp-web-tools/${m[1]}`);
      assert.equal(dep.status, 200, m[1]);
      assert.ok((await dep.text()).length > 100, `${m[1]} is a real module, not an error page`);
    }
    assert.equal((await fetch(`${base}/vendor/esp-web-tools/..%2F..%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/vendor/esp-web-tools/LICENSE-NOTE.md`)).status, 404, 'js only');
    assert.ok(fs.readFileSync(path.join(VENDOR_DIR, 'esp-web-tools', 'LICENSE-NOTE.md'), 'utf8').includes('Apache-2.0'));
  } finally { server.close(); }
});

test('/about is printed on paper whatever the theme; the drawings never sit on a dark ground', () => {
  const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR, docsDir: DOCS_DIR });
  const html = renderAbout(storyToHtml(d.story, {}));
  assert.match(html, /<body class="paper-doc">/);
  assert.match(html, /body\.paper-doc \{ --paper: #efe6cf; --ink: #1c1a16;/, 'light tokens locked for descendants, dark scheme included');
});

test('/flash/agent: the Council line until the doc appears, the rendered doc after', async () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-doc-'));
  fs.writeFileSync(path.join(docs, 'STORY.md'), '# X\n');
  const { server, base } = await serve({ worldOpts: { docsDir: docs } });
  try {
    const missing = await fetch(`${base}/flash/agent`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Nothing here\. The plant may know more\./);
    fs.writeFileSync(path.join(docs, 'FLASH_WITH_AN_AGENT.md'), '## Flash with an agent\n\nPoint it at this page.\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(docs, 'FLASH_WITH_AN_AGENT.md'), future, future);
    const r = await fetch(`${base}/flash/agent`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<body class="paper-doc">/);
    assert.match(html, /<h2 id="flash-with-an-agent">Flash with an agent<\/h2>/);
    assert.match(html, /Point it at this page\./);
  } finally { server.close(); }
});

test('THE TUBER nameplate under the masthead — plain ink, no link; the X link lives in the footer', async () => {
  const { server, base } = await serve({ app: { tuberUrl: 'https://x.com/thetuber' } });
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<p class="tt paper-name">THE TUBER<\/p>/);
    assert.doesNotMatch(html, /THE TUBER →/, 'the nameplate is not a link');
    assert.match(html, /Editions are also issued on/);
  } finally { server.close(); }
});

test('closed project blocks new installs and enrollment while existing citizens and OTA remain available', async () => {
  const { w, server, base } = await serve({ app: { projectClosed: true }, worldOpts: { docsDir: DOCS_DIR } });
  const secret = 'ab'.repeat(16);
  const existing = w.register({ secret, board: 'amoled18', fw: '0.3.0' });
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const route of ['/flash', '/flash/agent', '/releases/amoled18/webflash.json', '/releases/amoled18/webflash-0.3.0.bin']) {
      for (const method of ['GET', 'HEAD']) {
        const r = await fetch(`${base}${route}`, { method });
        assert.equal(r.status, 410, `${method} ${route}`);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const body = await r.text();
        if (method === 'GET') assert.match(body, /Project Over\. Thank you\./);
        assert.doesNotMatch(body, /<esp-web-install-button|install-button\.js/);
      }
    }
    for (const route of ['/', '/about', '/editions']) {
      const r = await fetch(`${base}${route}`);
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.match(body, /Project Over\. Thank you\./);
      assert.doesNotMatch(body, /href="\/flash(?:\/agent)?"/);
      if (route === '/about') assert.doesNotMatch(body, /Flash it from the browser/);
    }
    const fresh = await post('/v0/register', { secret: 'cd'.repeat(16), board: 'amoled18' });
    assert.equal(fresh.status, 410);
    assert.equal((await fresh.json()).error, 'Project Over. Thank you.');
    const again = await post('/v0/register', { secret, board: 'amoled18' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).potato_id, existing.potato_id);
    assert.equal((await post('/v0/heartbeat', { secret, events: [] })).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const ota = await fetch(`${base}/v0/firmware?board=amoled18&fw=0.0.0`);
    assert.equal(ota.status, 200);
    const image = await fetch(`${base}${(await ota.json()).url}`);
    assert.equal(image.status, 200);
    assert.ok((await image.arrayBuffer()).byteLength > 0);
  } finally { server.close(); w.close(); }
});
