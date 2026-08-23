// A markdown subset, enough for docs/STORY.md: headings, paragraphs, emphasis, bold, links,
// bullet and numbered lists, horizontal rules. No dependencies. Everything is escaped first.
import { escapeHtml } from './text.js';

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, text, href) => `<a href="${href}">${text}</a>`);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null;
  const flushPara = () => {
    if (!para.length) return;
    // A line that is only bold (a question) takes a break after it; other lines join with a space.
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
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; } // continuation
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

// docs/STORY.md → the /about page body. Drops the trailing "Short forms" section and resolves {GITHUB_URL}.
export function storyToHtml(md, { githubUrl = '' } = {}) {
  let s = String(md || '');
  const cut = s.search(/^## Short forms\s*$/m);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/^# [^\n]*\n/, ''); // the masthead already says it
  if (githubUrl) s = s.replace(/\{GITHUB_URL\}/g, `[${githubUrl}](${githubUrl})`);
  else s = s.replace(/:\s*\{GITHUB_URL\}/g, '').replace(/\s*\{GITHUB_URL\}/g, '');
  return renderMarkdown(s);
}
