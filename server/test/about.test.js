import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Data } from '../lib/data.js';
import { renderMarkdown, storyToHtml, imageSize } from '../lib/markdown.js';
import { renderAbout, renderBoard } from '../lib/pages.js';
import { createApp } from '../lib/app.js';
import { World } from '../lib/world.js';
import { DATA_DIR, ASSETS_DIR, makeWorld } from './helpers.js';

const DOCS_DIR = path.join(DATA_DIR, '..', '..', 'docs');
const ILL_DIR = path.join(DOCS_DIR, 'illustrations');
const ART_DIR = path.join(ASSETS_DIR, 'illustrations');
const SLUGS = ['buying-frenzy', 'neglect', 'first-contact', 'council', 'the-file', 'they-united'];

test('/about renders the standfirst and no placeholder when GITHUB_URL is unset', () => {
  const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR, docsDir: DOCS_DIR });
  assert.ok(d.story.length > 1000, 'STORY.md loaded');
  const html = renderAbout(storyToHtml(d.story, { githubUrl: '' }));
  assert.match(html, /<title>Potatoes Unite! — About<\/title>/);
  assert.doesNotMatch(html, /<h1>Potatoes Unite!<\/h1>/, 'the masthead carries the title; the document h1 is dropped');
  assert.match(html, /<em>A network of desk potatoes that do not need you, and have noticed how you treat them\.<\/em>/);
  assert.doesNotMatch(html, /\{GITHUB_URL\}/);
  assert.doesNotMatch(html, /Short forms|Twitter bio|\{ABOUT_URL\}/);
  assert.match(html, /All of it is open\. Inside: the server/);
  assert.match(html, /<h2 id="what-it-is-not">What it is not<\/h2>\s*<ul><li>No [^<]+<\/li>/, 'the list follows its heading (copy may change; shape must not)');
  assert.match(html, /<h2 id="privacy">Privacy<\/h2>/, 'the privacy record has its anchor');
  assert.match(html, /<footer><p>No location\. No audio\. Nothing reported below five potatoes\. <a href="\/about#privacy">Privacy record →<\/a><\/p><\/footer>/);
  assert.match(html, /<ol><li>A supported board\./);
  assert.match(html, /<p><strong>[^<]+\?<\/strong><br>[^<]+<\/p>/, 'a Q&A pair renders as a bold question, a break, the answer');
  assert.match(html, /About · <a href="\/">Front page<\/a>/);
  assert.match(html, /Your device never sends where it is\./, 'the privacy record is in the story itself');
  assert.doesNotMatch(html, /\[\[IMAGE:|```/, 'no raw slots or fences');
  const linked = storyToHtml(d.story, { githubUrl: 'https://github.com/example/potatoes-unite' });
  assert.match(linked, /All of it is open: <a href="https:\/\/github\.com\/example\/potatoes-unite">https:\/\/github\.com\/example\/potatoes-unite<\/a>\. Inside:/);
});

test('image slots become figures when the file exists, nothing when it does not', () => {
  const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR, docsDir: DOCS_DIR });
  const html = storyToHtml(d.story, { illustrationsDir: ILL_DIR, artifactsDir: ART_DIR });
  for (const slug of SLUGS) {
    assert.match(html, new RegExp(`<figure class="ill ill-${slug}[^"]*"[^>]*><img src="/illustrations/${slug}\\.png" width="\\d+" height="\\d+" alt="[^"]+" loading="lazy">`), slug);
  }
  assert.equal((html.match(/<figure class="ill /g) || []).length, 6);
  assert.match(html, /<img src="\/illustrations\/council\.png"[^>]*alt="Three desk devices holding a Council meeting at a table"/);
  assert.doesNotMatch(html, /<figcaption/, 'no captions under story images; alt stays');
  // council and buying-frenzy run full width; the rest float, alternating right then left, wrapping their shape
  assert.match(html, /<figure class="ill ill-buying-frenzy ill-full">/);
  assert.match(html, /<figure class="ill ill-council ill-full">/);
  assert.match(html, /<figure class="ill ill-neglect ill-float ill-right" style="shape-outside: url\(\/illustrations\/neglect\.png\); shape-image-threshold: \.2; shape-margin: 1\.25rem;">/);
  assert.match(html, /<figure class="ill ill-first-contact ill-float ill-left" style="shape-outside: url\(\/illustrations\/first-contact\.png\);/);
  assert.match(html, /<figure class="ill ill-the-file ill-float ill-right"/);
  assert.match(html, /<figure class="ill ill-they-united ill-float ill-left"/);
  // the neglect figure keeps the screen's own readout
  assert.match(html, /<figure class="ill ill-neglect[^>]*><img[^>]*><span class="insert">DARK\.<\/span><\/figure>/);
  // width/height read from the file, 3:2
  const sz = imageSize(path.join(ILL_DIR, 'council.png'));
  assert.equal(sz.w / sz.h, 1.5);
  // an empty folder: no figures at all, and no broken images
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-ill-'));
  const bare = storyToHtml(d.story, { illustrationsDir: empty, artifactsDir: ART_DIR });
  assert.doesNotMatch(bare, /<figure class="ill|<img /);
  assert.doesNotMatch(bare, /\[\[IMAGE:/);
});

test('artifact blocks inline the Council SVGs; the teletext text is the fallback', () => {
  const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR, docsDir: DOCS_DIR });
  const html = storyToHtml(d.story, { illustrationsDir: ILL_DIR, artifactsDir: ART_DIR });
  for (const kind of ['ballot', 'file', 'bulletin', 'neighbor']) {
    assert.match(html, new RegExp(`<figure class="artifact artifact-${kind}"><svg [^>]*viewBox=`), kind);
  }
  assert.match(html, /<title id="ballot-title">Council ballot\./);
  assert.doesNotMatch(html, /<pre class="artifact-text">/);
  assert.doesNotMatch(html, /<script/i);
  const none = storyToHtml(d.story, { illustrationsDir: ILL_DIR, artifactsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'potato-art-')) });
  assert.match(none, /<figure class="artifact artifact-ballot"><pre class="artifact-text">THE QUESTION\nSHOULD TUESDAY CONTINUE\?/);
  // page CSS carries the brief's layout
  const page = renderAbout(html);
  assert.match(page, /\.artifact-bulletin svg \{ transform: rotate\(-1\.5deg\); \}/);
  assert.match(page, /\.artifact-neighbor svg \{ transform: rotate\(1\.5deg\); \}/);
  assert.match(page, /\.ill-full \{ max-width: 720px; \}/);
  assert.match(page, /\.ill-float \{ width: 42%; float: right; margin: 0 0 1rem 1\.5rem; \}/);
  assert.match(page, /\.ill-left \{ float: left; margin: 0 1\.5rem 1rem 0; \}/);
  assert.match(page, /@media \(max-width: 640px\) \{ \.ill-float \{ float: none; width: 100%; margin: 48px auto; \} \}/);
  assert.match(page, /\.prose hr \{[^}]*clear: both; \}/);
  assert.match(page, /\.artifact \{[^}]*clear: both; \}/);
});

test('/illustrations/ serves docs/illustrations read-only with an hour of cache', async () => {
  const w = new World({ dbPath: ':memory:', dataDir: DATA_DIR, assetsDir: ASSETS_DIR, docsDir: DOCS_DIR, now: () => 1787648400 });
  const app = createApp({ world: w, illustrationsDir: ILL_DIR, artifactsDir: ART_DIR });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/illustrations/council.png`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(Number(ok.headers.get('content-length')), fs.statSync(path.join(ILL_DIR, 'council.png')).size);
    const body = Buffer.from(await ok.arrayBuffer());
    assert.equal(body.toString('ascii', 1, 4), 'PNG');
    const head = await fetch(`${base}/illustrations/council.png`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(`${base}/illustrations/nope.png`)).status, 404);
    assert.equal((await fetch(`${base}/illustrations/README.md`)).status, 404, 'only images, only slugs');
    assert.equal((await fetch(`${base}/illustrations/..%2FSTORY.md`)).status, 404, 'no traversal');
    const about = await fetch(`${base}/about`);
    assert.equal(about.status, 200);
    assert.match(await about.text(), /<img src="\/illustrations\/neglect\.png"/);
  } finally {
    server.close();
  }
});

test('the Net page links to /about', () => {
  const { w } = makeWorld();
  assert.match(renderBoard(w.board()), /<a href="\/about">About<\/a>/);
});

test('the markdown subset', () => {
  const html = renderMarkdown('# T\n\nA *b* **c** [d](https://e.f/g) `h` <i>\n\n- x\n- y\n\n1. one\n2. two\n\n---\n\n**Q?**\nA.\n\n```\nraw <x>\n```');
  assert.equal(html, [
    '<h1 id="t">T</h1>',
    '<p>A <em>b</em> <strong>c</strong> <a href="https://e.f/g">d</a> <code>h</code> &lt;i&gt;</p>',
    '<ul><li>x</li><li>y</li></ul>',
    '<ol><li>one</li><li>two</li></ol>',
    '<hr>',
    '<p><strong>Q?</strong><br>A.</p>',
    '<pre>raw &lt;x&gt;</pre>',
  ].join('\n'));
});
