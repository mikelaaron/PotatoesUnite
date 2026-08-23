// A markdown subset, enough for docs/STORY.md: headings, paragraphs, emphasis, bold, links,
// bullet and numbered lists, horizontal rules, fenced blocks, and the story's own two constructs:
//   [[IMAGE: slug — description — alt]]   → <figure class="ill"> when docs/illustrations/<slug>.(png|jpg|jpeg|webp) exists, else nothing
//   ```artifact-<kind> … ```               → <figure class="artifact"> with assets/illustrations/artifact-<kind>.svg inlined
// No dependencies. Everything from the document is escaped; the SVGs are our own files.
import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml } from './text.js';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export const mimeFor = (ext) => MIME[ext] || null;

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, text, href) => `<a href="${href}">${text}</a>`);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  return out;
}

// Pixel size from a PNG IHDR or a JPEG SOF marker; null when unreadable. Only used for width/height attributes.
export function imageSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 65536));
      fs.readSync(fd, buf, 0, buf.length, 0);
      if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i + 9 < buf.length && buf[i] === 0xff) {
          const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
          i += 2 + len;
        }
      }
    } finally { fs.closeSync(fd); }
  } catch { /* unreadable */ }
  return null;
}

// The illustration for a slug, if the owner has dropped one in.
export function findIllustration(dir, slug) {
  if (!dir || !/^[a-z0-9-]+$/.test(slug)) return null;
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, `${slug}.${ext}`);
    if (fs.existsSync(file)) return { file, ext, src: `/illustrations/${slug}.${ext}`, size: imageSize(file) };
  }
  return null;
}

// Group scenes run full width, centered; only the two single-subject drawings float (right, then left).
const FULL_WIDTH = new Set(['council', 'buying-frenzy', 'first-contact', 'they-united']);

function figureHtml(slug, alt, ill, state) {
  const sz = ill.size || { w: 1440, h: 960 };
  let cls = `ill ill-${slug}`;
  if (FULL_WIDTH.has(slug)) cls += ' ill-full';
  else {
    const side = state.floats % 2 === 0 ? 'right' : 'left';
    state.floats += 1;
    cls += ` ill-float ill-${side}`;
  }
  return `<figure class="${cls}"><img src="${ill.src}" width="${sz.w}" height="${sz.h}" alt="${escapeHtml(alt)}" loading="lazy"></figure>`;
}

const slugify = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function artifactHtml(kind, text, artifactsDir) {
  const file = artifactsDir && /^[a-z0-9-]+$/.test(kind) ? path.join(artifactsDir, `artifact-${kind}.svg`) : null;
  let svg = null;
  if (file && fs.existsSync(file)) svg = fs.readFileSync(file, 'utf8').replace(/<\?xml[^>]*>\s*/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const body = svg || `<pre class="artifact-text">${escapeHtml(text.trimEnd())}</pre>`;
  return `<figure class="artifact artifact-${escapeHtml(kind)}">${body}</figure>`;
}

export function renderMarkdown(md, { illustrationsDir = null, artifactsDir = null } = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, fence = null;
  const state = { floats: 0 };
  const flushPara = () => {
    if (!para.length) return;
    const html = para.map((l, i) => {
      const boldOnly = /^\*\*[^*]+\*\*$/.test(l.trim());
      return inline(l.trim()) + (boldOnly && i < para.length - 1 ? '<br>' : i < para.length - 1 ? ' ' : '');
    }).join('');
    out.push(`<p>${html}</p>`);
    para = [];
  };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (fence) {
      if (/^```\s*$/.test(line)) {
        const text = fence.lines.join('\n');
        if ((m = fence.info.match(/^artifact-([a-z0-9-]+)$/))) out.push(artifactHtml(m[1], text, artifactsDir));
        else out.push(`<pre>${escapeHtml(text)}</pre>`);
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    if ((m = line.match(/^```([\w-]*)\s*$/))) { flushPara(); flushList(); fence = { info: m[1], lines: [] }; continue; }
    if ((m = line.match(/^\[\[TT:\s*(.*?)\s*\]\]$/))) { flushPara(); flushList(); out.push(`<p class="tt">${escapeHtml(m[1])}</p>`); continue; }
    if ((m = line.match(/^\[\[IMAGE:\s*([a-z0-9-]+)\s+—\s+(.*?)\s+—\s+(.*?)\s*\]\]$/))) {
      flushPara(); flushList();
      const ill = findIllustration(illustrationsDir, m[1]);
      if (ill) out.push(figureHtml(m[1], m[3], ill, state));
      continue; // no image yet: nothing on the page
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length} id="${slugify(m[2])}">${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

// The account name as a handle: https://x.com/IssuedByCouncil → @IssuedByCouncil.
export const tuberHandle = (url) => '@' + String(url).replace(/\/+$/, '').split('/').pop();

// docs/STORY.md → the /about page body. Drops the trailing "Short forms" section and resolves
// {GITHUB_URL} and {TUBER_URL}. Unset, the placeholders vanish along with their leading colons,
// so the sentences still read.
export function storyToHtml(md, { githubUrl = '', tuberUrl = '', illustrationsDir = null, artifactsDir = null } = {}) {
  let s = String(md || '');
  const cut = s.search(/^## Short forms\s*$/m);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/^# [^\n]*\n/, ''); // the masthead already says it
  if (githubUrl) s = s.replace(/\{GITHUB_URL\}/g, `[${githubUrl}](${githubUrl})`);
  else s = s.replace(/:\s*\{GITHUB_URL\}/g, '').replace(/\s*\{GITHUB_URL\}/g, '');
  if (tuberUrl) s = s.replace(/\{TUBER_URL\}/g, `[${tuberHandle(tuberUrl)}](${tuberUrl})`);
  else s = s.replace(/:\s*\{TUBER_URL\}/g, '').replace(/\s*\{TUBER_URL\}/g, '');
  return renderMarkdown(s, { illustrationsDir, artifactsDir });
}
