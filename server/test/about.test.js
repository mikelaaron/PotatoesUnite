import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Data } from '../lib/data.js';
import { renderMarkdown, storyToHtml } from '../lib/markdown.js';
import { renderAbout, renderBoard } from '../lib/pages.js';
import { DATA_DIR, ASSETS_DIR, makeWorld } from './helpers.js';

const DOCS_DIR = path.join(DATA_DIR, '..', '..', 'docs');

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
  assert.match(html, /<h2>What it is not<\/h2>\s*<ul><li>No [^<]+<\/li>/, 'the list follows its heading (copy may change; shape must not)');
  assert.match(html, /<ol><li>A supported board\./);
  assert.match(html, /<p><strong>[^<]+\?<\/strong><br>[^<]+<\/p>/, 'a Q&A pair renders as a bold question, a break, the answer');
  assert.match(html, /<a href="\/">The Net<\/a>/);
  assert.match(html, /Your device never sends where it is\./);
  // with the env var, the sentence gets its link
  const linked = storyToHtml(d.story, { githubUrl: 'https://github.com/example/potatoes-unite' });
  assert.match(linked, /All of it is open: <a href="https:\/\/github\.com\/example\/potatoes-unite">https:\/\/github\.com\/example\/potatoes-unite<\/a>\. Inside:/);
});

test('the Net page links to /about', () => {
  const { w } = makeWorld();
  assert.match(renderBoard(w.board()), /<a href="\/about">About<\/a>/);
});

test('the markdown subset', () => {
  const html = renderMarkdown('# T\n\nA *b* **c** [d](https://e.f/g) `h` <i>\n\n- x\n- y\n\n1. one\n2. two\n\n---\n\n**Q?**\nA.');
  assert.equal(html, [
    '<h1>T</h1>',
    '<p>A <em>b</em> <strong>c</strong> <a href="https://e.f/g">d</a> <code>h</code> &lt;i&gt;</p>',
    '<ul><li>x</li><li>y</li></ul>',
    '<ol><li>one</li><li>two</li></ol>',
    '<hr>',
    '<p><strong>Q?</strong><br>A.</p>',
  ].join('\n'));
});
