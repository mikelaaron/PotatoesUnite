// Plain server-rendered HTML. Paper and ink. Teletext (VT323) for the official parts — masthead, dateline,
// section labels, timestamps, stamps, all-caps notices — and a readable serif for everything a person reads.
// Times are rendered in UTC; a tiny inline script adds the viewer's local time and keeps the countdown current.
import { escapeHtml as h, fewerThanFive } from './text.js';
import { hm, dayHeader, dayStart } from './clock.js';
import { potatoSvg } from './portrait.js';
import { tuberHandle } from './markdown.js';

const CSS = `
:root { --paper: #efe6cf; --ink: #1c1a16; --rule: #5e5647; --faint: #7d7462; --bar: #1c1a16; --barbg: #d9cfb2; --wash: #e6dcc2; --red: #B4281E;
  --s1: 12px; --s2: 24px; --s3: 48px; --s4: 64px; /* the spacing scale; nothing else */
  --tt: 'VT323', 'Courier New', Courier, monospace; --serif: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #15130f; --ink: #e8dfc6; --rule: #9a907a; --faint: #a09680; --bar: #e8dfc6; --barbg: #2a2620; --wash: #1e1b16; --red: #e0684f; }
}
* { box-sizing: border-box; }
/* A Council document is printed on paper, whatever the room's lighting. Ink drawings vanish on a dark ground. */
body.paper-doc { --paper: #efe6cf; --ink: #1c1a16; --rule: #5e5647; --faint: #7d7462; --wash: #e6dcc2; --barbg: #d9cfb2; --bar: #1c1a16; }
/* the flasher */
.boards { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--s2); margin: var(--s2) 0; }
.board-card { border: 2px solid var(--rule); background: var(--wash); padding: 1rem 1.1rem; text-align: center; }
.board-card h3 { font-family: var(--tt); font-size: 1.2em; letter-spacing: .08em; text-transform: uppercase; margin: .5rem 0 .2rem; }
.board-card p { font-size: .92em; margin: .3rem 0 .8rem; }
.board-card esp-web-install-button button, .board-card .connect { font-family: var(--tt); font-size: 1.2em; background: var(--ink); color: var(--paper); border: 0; padding: .45rem 1.6rem; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; }
.board-card .unsupported { display: block; color: var(--faint); font-size: .85em; margin-top: .5rem; }
.requirements { color: var(--faint); }
.paper-name { text-align: center; margin: .2rem 0 0; font-size: 1.8em; letter-spacing: .12em; color: var(--ink); }
.oneliner { background: var(--wash); border: 1px solid var(--rule); padding: .6rem .8rem; overflow-x: auto; font-size: .85em; }
html { background: var(--paper); }
body { margin: 0 auto; max-width: 65ch; padding: 1.5rem 1rem 3rem; background: var(--paper); color: var(--ink);
  font-family: var(--serif); font-size: 19px; line-height: 1.5; }
a { color: inherit; }
.tt, h2, .mast h1, .mast .sub, .now, .next, .pop, .head, .stamp, .label, .entry .t, .entry .txt, .day h2, .small, .file-head h1, .ack-note, button, .insert, .withheld, .edition h2 { font-family: var(--tt); line-height: 1.25; }
.mast { text-align: center; border-top: 4px double var(--rule); border-bottom: 4px double var(--rule); padding: .4rem 0 .5rem; margin-bottom: var(--s1); }
.mast h1 { margin: 0; font-size: 3rem; letter-spacing: .06em; line-height: 1; }
.mast .sub { color: var(--faint); text-transform: uppercase; letter-spacing: .15em; font-size: 1em; margin-top: .3rem; }
.mast .sub a { text-decoration: none; border-bottom: 1px solid var(--faint); }
.now { text-align: center; color: var(--faint); margin: 0; font-size: 1.15em; }
.next { text-align: center; color: var(--faint); margin: 0 0 var(--s2); font-size: 1.05em; letter-spacing: .08em; }
.lede { margin: 0 0 var(--s2); color: var(--ink); }
h2 { font-size: 1.1em; text-transform: uppercase; letter-spacing: .2em; border-bottom: 1px solid var(--rule); margin: var(--s3) 0 var(--s1); padding-bottom: .1rem; color: var(--faint); clear: both; }
.small { color: var(--faint); font-size: .9em; margin: -.3rem 0 .4rem; letter-spacing: .1em; }
p { margin: var(--s1) 0; }
.pop { font-size: 1.3em; text-transform: uppercase; letter-spacing: .06em; }
.muted { color: var(--faint); }
/* the ballot: a paper object, the same in the dark */
.ballot { position: relative; background: #F3EBD6; color: #1C1A16; border: 2px solid #1C1A16; box-shadow: 0 1px 2px rgba(0,0,0,.18); padding: 1.1rem 1.4rem 1rem; margin: var(--s2) 0; }
.ballot h2 { color: #5E5647; border-color: #1C1A16; margin: 0 0 .5rem; }
.ballot .q { font-size: 1.2em; margin: .3rem 0 .9rem; padding-right: 7rem; }
.options { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .6rem; }
.opt { border: 1.5px solid #1C1A16; padding: .5rem .6rem; text-align: center; }
.opt.win { background: #1C1A16; color: #F3EBD6; }
.stamp { position: absolute; top: .7rem; right: .9rem; transform: rotate(-8deg); color: #B4281E; border: 2px solid #B4281E; padding: .05em .5em; font-size: 1.05em; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.ballot .note { color: #5E5647; font-size: .9em; margin: .9rem 0 0; }
.ballot form.options { margin: 0; }
.ballot button.opt { font-family: var(--serif); font-size: 1em; background: #F3EBD6; color: #1C1A16; border: 1.5px solid #1C1A16; padding: .5rem .6rem; text-transform: none; letter-spacing: 0; cursor: pointer; }
.ballot button.opt:hover { background: #1C1A16; color: #F3EBD6; opacity: 1; }
.informed { color: #B4281E; letter-spacing: .12em; margin: .8rem 0 0; }
.ballot .tally { list-style: none; padding: 0; margin: .2rem 0 0; }
.ballot .tally li { margin: .35rem 0; }
.ballot .tally .lab { display: flex; justify-content: space-between; gap: 1rem; }
.ballot .tally .bar { height: .7em; background: #D9CFB2; margin-top: .15rem; }
.ballot .tally .bar span { display: block; height: 100%; background: #1C1A16; }
.ballot .tally .win .lab { font-weight: bold; }
/* the Bulletin */
.head { font-size: 1.5em; margin: .3rem 0 .2rem; letter-spacing: .02em; }
ul.items { padding-left: 1.2rem; margin: .2rem 0; }
ul.items li { margin: .3rem 0; }
.doc { float: right; width: 320px; max-width: 45%; margin: var(--s1) 0 var(--s2) var(--s2); }
.doc img { display: block; width: 100%; height: auto; }
.doc .label { display: block; text-align: center; color: var(--faint); letter-spacing: .15em; margin-top: .3rem; }
ul.editions { list-style: none; padding: 0; margin: .3rem 0; }
ul.editions li { margin: .3rem 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1.2rem; margin: .4rem 0; }
dt { color: var(--faint); }
dd { margin: 0; }
.notice { border-left: 3px solid var(--rule); padding: .2rem .8rem; margin: .5rem 0; background: var(--wash); }
footer { clear: both; margin-top: var(--s4); border-top: 1px solid var(--rule); padding-top: var(--s1); color: var(--faint); font-size: .9em; }
/* editions archive */
.edition { margin: var(--s2) 0 var(--s3); }
.edition h2 { margin-bottom: .2rem; }
/* the claim form */
.claim { margin: var(--s3) 0 0; }
.claim label { display: block; color: var(--faint); letter-spacing: .2em; text-transform: uppercase; margin-bottom: var(--s1); }
.claim input { font-family: var(--tt); font-size: 1.2em; letter-spacing: .12em; text-transform: uppercase; width: 12ch; height: 2.4rem; box-sizing: border-box; background: var(--wash); color: var(--ink); border: 1.5px solid var(--rule); padding: 0 .5rem; vertical-align: middle; }
.claim button { margin-left: var(--s1); font-size: 1em; height: 2.4rem; box-sizing: border-box; padding: 0 1rem; vertical-align: middle; }
/* the File */
.file-head { border-bottom: 4px double var(--rule); padding-bottom: .8rem; margin-bottom: .5rem; }
.file-head .portrait { display: block; margin: 0 0 .6rem; }
.file-head h1 { font-size: 2.2em; margin: 0; letter-spacing: .06em; line-height: 1; }
.file-head .id { margin: .1rem 0 .6rem; color: var(--faint); letter-spacing: .08em; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .1rem 1.2rem; margin: .4rem 0; }
.facts dt { color: var(--faint); letter-spacing: .15em; }
.facts dd { margin: 0; letter-spacing: .04em; }
.aside { color: var(--faint); margin: .1rem 0 .6rem; }
.since { margin: .6rem 0 0; letter-spacing: .06em; }
.matters .entry { grid-template-columns: 9.5rem 1fr; }
@media (min-width: 40rem) { .matters .entry { grid-template-columns: 9.5rem minmax(0, 1fr) minmax(0, 40%); } }
.marker { color: var(--red); letter-spacing: .2em; margin: var(--s1) 0 .2rem; }
.boundary { border: 0; border-top: 1px solid var(--rule); margin: .4rem 0 .6rem; }
.acked { text-align: center; font-size: 1.6em; letter-spacing: .1em; margin: 4rem 0; }
.file-foot { letter-spacing: .06em; }
.day { margin-top: var(--s2); }
.day h2 { margin-bottom: .2rem; }
.entry { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0 .6rem; padding: .12rem 0; }
.entry .t { color: var(--faint); }
.entry .txt { font-size: 1.1em; }
.entry .note { color: var(--faint); grid-column: 2; font-size: .92em; }
.entry.unread .txt::before { content: '\\2022 '; }
@media (min-width: 40rem) { .entry { grid-template-columns: 4.2rem minmax(0, 1fr) minmax(0, 44%); } .entry .note { grid-column: auto; } }
.withheld { color: var(--faint); font-style: italic; padding-left: 4.8rem; }
form.ack { margin: 2rem 0 0; text-align: center; }
button { font-size: 1.2em; background: var(--ink); color: var(--paper); border: 0; padding: .4rem 1.4rem; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
button:hover { opacity: .85; }
.ack-note { text-align: center; color: var(--faint); font-size: .95em; }
.sprout { display: inline-block; margin-left: .4rem; }
/* /about prose */
.prose { max-width: 65ch; margin: 0 auto; }
.prose h1 { font-size: 1.8em; letter-spacing: .04em; margin: 1rem 0 .2rem; }
.prose h2 { margin-top: var(--s3); }
.prose p { margin: var(--s1) 0; }
.prose ul, .prose ol { padding-left: 1.4rem; margin: .5rem 0; }
.prose li { margin: .25rem 0; }
.prose hr { border: 0; border-top: 1px solid var(--rule); margin: var(--s3) 0; clear: both; }
.prose em { font-style: italic; }
.prose > p:first-of-type { font-size: 1.15em; }
.prose pre { overflow-x: auto; }
/* illustrations (docs/ILLUSTRATION_BRIEF.md §4, floats per the weekend pass) */
.ill { position: relative; margin: var(--s3) auto; }
.ill img { display: block; width: 100%; height: auto; } /* trimmed drawings: the width/height attributes are honest now */
.ill-full { max-width: 560px; }
.ill-they-united { margin-top: var(--s4); margin-bottom: var(--s4); }
.ill-float { width: 42%; float: right; margin: 6px 0 var(--s2) var(--s3); }
.ill-left { float: left; margin: 6px var(--s3) var(--s2) 0; }
@media (max-width: 640px) { .ill-float { float: none; width: 100%; margin: var(--s3) auto; } }
.artifact { width: 60%; max-width: 480px; margin: var(--s3) auto; clear: both; }
.artifact svg { width: 100%; height: auto; display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.18)); }
.artifact-bulletin svg { transform: rotate(-1.5deg); }
.artifact-neighbor svg { transform: rotate(1.5deg); }
.artifact-text { background: #F3EBD6; color: #1C1A16; border: 1px solid #1C1A16; padding: .8rem 1rem; font-family: var(--tt); font-size: .9em; white-space: pre-wrap; margin: 0; }
`;

// Progressive enhancement only. Every time on the page is already correct in UTC; the countdown is server-rendered first.
const TIME_SCRIPT = `
(function () {
  var WD = ['SUN','MON','TUE','WED','THU','FRI','SAT'], MO = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var f12 = function (d) { var hh = d.getHours(), ap = hh >= 12 ? 'PM' : 'AM'; return (hh % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + ap; };
  var f24 = function (d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var els = document.querySelectorAll('[data-utc]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i], d = new Date(Number(el.getAttribute('data-utc')) * 1000);
    if (isNaN(d.getTime())) continue;
    if (el.hasAttribute('data-local-24')) el.textContent = f24(d);
    else if (el.hasAttribute('data-local-day')) el.textContent = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()];
    else if (el.hasAttribute('data-local-daytime')) el.textContent = WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()] + ' ' + f24(d);
    else if (el.hasAttribute('data-local-end')) { var slot = el.parentNode.querySelector('.local-slot'); if (slot) slot.textContent = ' \\u00b7 ' + f12(d) + ' where you are'; }
    else el.insertAdjacentText('afterend', ' \\u00b7 ' + f12(d) + ' where you are');
  }
  var file = document.querySelector('[data-file-utc]');
  if (file) {
    var rows = Array.prototype.slice.call(file.querySelectorAll('.entry, .withheld'));
    var sections = Array.prototype.slice.call(file.querySelectorAll('.day'));
    if (rows.length && sections.length) {
      var keyOf = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
      var frag = document.createDocumentFragment(), cur = null, curKey = '';
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j], dt = new Date(Number(r.getAttribute('data-utc')) * 1000), k = keyOf(dt);
        if (k !== curKey) {
          curKey = k; cur = document.createElement('section'); cur.className = 'day';
          var hd = document.createElement('h2'); hd.textContent = WD[dt.getDay()] + ' ' + dt.getDate() + ' ' + MO[dt.getMonth()];
          cur.appendChild(hd); frag.appendChild(cur);
        }
        cur.appendChild(r);
      }
      sections[0].parentNode.insertBefore(frag, sections[0]);
      for (var s = 0; s < sections.length; s++) sections[s].parentNode.removeChild(sections[s]);
    }
    var note = document.querySelector('[data-tz-note]');
    if (note) note.textContent = 'Times are local to you.';
  }
  // The return signal. Mornings print at 00:00 UTC, evenings at 23:00 UTC.
  var nx = document.querySelector('[data-next-utc]');
  if (nx) {
    var last = Number(nx.getAttribute('data-printed-utc') || 0);
    var nextPrint = function (now) { var ds = Math.floor(now / 86400) * 86400, c = [ds + 82800, ds + 86400]; for (var q = 0; q < c.length; q++) if (c[q] > now) return c[q]; return ds + 86400 + 82800; };
    var tick = function () {
      var now = Math.floor(Date.now() / 1000), next = nextPrint(now), diff = next - now, hh = Math.floor(diff / 3600), mm = Math.floor((diff % 3600) / 60);
      if (last && now - last < 1800) nx.textContent = 'EDITION PRINTED. NEXT IN ' + Math.max(1, Math.round(diff / 3600)) + ' H.';
      else nx.textContent = 'NEXT EDITION IN ' + (hh ? hh + ' H ' : '') + mm + ' MIN.';
    };
    tick(); setInterval(tick, 60000);
  }
})();`;

export function layout(title, body, { bodyClass = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${h(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
<script>${TIME_SCRIPT}</script>
</body>
</html>`;
}

const PRIVACY_LONG = 'Your device never sends where it is. It never sends audio — only whether the room is quiet or loud. Nothing is shown here until at least five potatoes are involved. Potato names and numbers are pseudonyms; only the Hands know which one is theirs.';
const LEDE = 'Every potato is connected to the Net. When the Net reaches a conclusion, the Council announces it.';
const EDITION_TIMES = { morning: 0, evening: 23 };

// "13:00 UTC" with the instant attached, so the script can add the viewer's time after it.
const utc = (t, attrs = '') => `<time data-utc="${Math.round(t)}"${attrs}>${h(hm(t))} UTC</time>`;

// One sentence and the privacy record. On /about the record is on the page itself, so no link there.
export function footer({ tuberUrl = '', privacyHere = false } = {}) {
  const record = privacyHere ? 'Privacy record →' : '<a href="/about#privacy">Privacy record →</a>';
  return `<footer><p>No location. No audio. Public counts start at five potatoes. ${record}</p>${tuberUrl ? `<p>Editions are also issued on X: <a href="${h(tuberUrl)}">${h(tuberHandle(tuberUrl))}</a>.</p>` : ''}</footer>`;
}

// Server-side first render of the countdown; the script keeps it current.
export function nextLine(now, lastPrint, nextPrint) {
  const diff = Math.max(0, nextPrint - now), hh = Math.floor(diff / 3600), mm = Math.floor((diff % 3600) / 60);
  if (lastPrint && now - lastPrint < 1800) return `EDITION PRINTED. NEXT IN ${Math.max(1, Math.round(diff / 3600))} H.`;
  return `NEXT EDITION IN ${hh ? `${hh} H ` : ''}${mm} MIN.`;
}

// Bulletin copy is stored as text; any "HH:MM UTC" in it refers to the edition's own UTC day.
function withTimes(text, t) {
  return h(text).replace(/\b(\d\d):(\d\d) UTC\b/g, (m, hh, mm) => (t ? utc(dayStart(t) + Number(hh) * 3600 + Number(mm) * 60) : m));
}

function editionHtml(b, { link = false } = {}) {
  const when = `${dayHeader(b.t)} · ${String(b.edition).toUpperCase()}`;
  return `<article class="edition"><h2>${link ? `<a href="/editions/${h(b.day)}/${h(b.edition)}">${h(when)}</a>` : h(when)}</h2>
<div class="small">No. ${h(b.no)}</div>
<p class="head">${withTimes(b.headline, b.t)}</p>
<ul class="items">${b.items.map((i) => `<li>${withTimes(i, b.t)}</li>`).join('')}</ul>
<div class="small">Issued by The Tuber.</div></article>`;
}

function ballotHtml(b) {
  let stamp = 'NO POLL', body = '', note = '';
  if (b.silence) body = `<p class="q">${h(b.silenceLine)}</p>`;
  else if (!b.question) body = `<p class="q muted">No Question today.</p>`;
  else {
    const q = b.question;
    stamp = q.state === 'open' ? 'POLL OPEN' : q.state === 'upcoming' ? `OPENS ${h(hm(q.opens_at))} UTC` : 'COUNT IN';
    body = `<p class="q">${h(q.text)}</p>`;
    if (q.state === 'closed' && q.withdrawn) body += `<p>${h(q.remark)}</p>`;
    else if (q.state === 'closed') {
      const hideSmall = q.total < 5 || q.options.some((o) => o.count < 5);
      body += `<ul class="tally">${q.options.map((o) => `<li class="${o.winner ? 'win' : ''}">
<div class="lab"><span>${h(o.label)}</span><span>${hideSmall ? (o.count < 5 ? 'fewer than five' : h(o.count)) : `${h(o.count)} (${h(o.pct)}%)`}</span></div>
<div class="bar"><span style="width:${q.total < 5 ? 0 : Math.max(2, o.pct)}%"></span></div></li>`).join('')}</ul>
${q.total < 5 ? '<p class="muted">Fewer than five voted. The Council does not publish small Counts.</p>' : ''}
${q.remark ? `<p>${h(q.remark)}</p>` : ''}`;
    } else {
      body += `<div class="options">${q.options.map((o) => `<div class="opt">${h(o.label)}</div>`).join('')}</div>`;
      note = `<p class="note">Votes are cast on the potato. Yours has until ${utc(q.closes_at, ' data-local-end')} to respond<span class="local-slot"></span>.</p>`;
    }
  }
  return `<section class="ballot"><span class="stamp">${stamp}</span><h2>The Question</h2>${body}${note}</section>`;
}

export function renderBoard(b, { tuberUrl = '' } = {}) {
  const A = b.aggregates;
  const agg = b.small
    ? `<p>Reports begin at five potatoes.</p>`
    : `<dl>
<dt>Left home</dt><dd>${h(fewerThanFive(A.left_home))}</dd>
<dt>Six hours in the dark</dt><dd>${h(fewerThanFive(A.dark6))}</dd>
<dt>Shakings</dt><dd>${h(fewerThanFive(A.shakes))}</dd>
<dt>Drops</dt><dd>${h(fewerThanFive(A.drops))}</dd>
<dt>In transit</dt><dd>${h(fewerThanFive(A.transit))}</dd>
<dt>Dormant</dt><dd>${h(fewerThanFive(A.dormant))}</dd>
<dt>Curing</dt><dd>${h(fewerThanFive(A.curing))}</dd>
</dl>`;
  const population = b.small ? 'POPULATION: FEWER THAN FIVE. A COMMITTEE HAS ALREADY FORMED.' : `POPULATION: ${b.population}.`;
  const doc = b.incident && b.incidentSrc ? `<figure class="doc"><img src="${h(b.incidentSrc)}" width="320" alt="" loading="lazy"><span class="label">DOCUMENTED.</span></figure>` : '';
  const bulletin = b.bulletin
    ? `<h2>The Bulletin · ${h(String(b.bulletin.edition).toUpperCase())}</h2><div class="small">No. ${h(b.bulletin.no)}</div>${doc}
<p class="head">${withTimes(b.bulletin.headline, b.bulletin.t)}</p>
<ul class="items">${b.bulletin.items.map((i) => `<li>${withTimes(i, b.bulletin.t)}</li>`).join('')}</ul><div class="small">Issued by The Tuber.</div>`
    : `<h2>The Bulletin</h2>${doc}<p class="muted">No Bulletin yet. The press is warming up.</p>`;
  const earlier = b.earlier && b.earlier.length
    ? `<h2>Earlier editions</h2><ul class="editions">${b.earlier.map((e) => `<li><a href="/editions/${h(e.day)}/${h(e.edition)}">${h(dayHeader(e.t))} · ${h(String(e.edition).toUpperCase())} — ${h(e.headline)}</a></li>`).join('')}</ul>`
    : '';
  const missing = b.missing.length ? `<h2>Missing</h2>${b.missing.map((m) => `<p class="notice">${h(m)}</p>`).join('')}` : '';
  const potd = b.potd ? `<h2>Potato of the Day</h2><p>${h(b.potd.name)} #${h(b.potd.id)} · ${h(b.potd.variety)}</p>${b.potd.excerpt ? `<p class="notice">${h(b.potd.excerpt)}</p>` : ''}` : '';
  return layout('POTATOES UNITE!', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">The Net · ${h(dayHeader(b.t))} · Day ${h(b.no)} · <a href="/about">About</a> · <a href="/flash">Flash</a></div></header>
<p class="tt paper-name">THE TUBER</p>
<p class="now">It is ${utc(b.t)}.</p>
<p class="next" data-next-utc="${h(b.nextPrint)}" data-printed-utc="${h(b.lastPrint || 0)}">${h(nextLine(b.t, b.lastPrint, b.nextPrint))}</p>
<p class="lede">${h(LEDE)}</p>
<p class="pop">${h(population)}</p>
${ballotHtml(b)}
${bulletin}
${earlier}
<h2>On the Net Today</h2>
${agg}
${missing}
${potd}
<form class="claim" method="post" action="/claim"><label class="tt" for="claim-code">Claim your File</label><input id="claim-code" name="code" size="8" maxlength="8" placeholder="BRK-7H2" autocomplete="off" spellcheck="false"><button type="submit">Open</button></form>
${footer({ tuberUrl })}`);
}

export function renderEditions(list, { single = false, tuberUrl = '' } = {}) {
  const title = single && list[0] ? `Potatoes Unite! — Edition No. ${list[0].no}, ${list[0].edition}` : 'Potatoes Unite! — Editions';
  const body = list.length ? list.map((b) => editionHtml(b, { link: !single })).join('\n') : '<p class="muted">No editions yet. The press is warming up.</p>';
  return layout(title, `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">The Net · Editions · <a href="/">Front page</a></div></header>
${body}
${footer({ tuberUrl })}`);
}

export function renderFile(f) {
  const title = `${f.name.toUpperCase()} #${f.id} · ${f.variety.name.toUpperCase()} · STANDING: ${f.standing.toUpperCase()}`;
  const live = !f.offsetKnown;
  const tAttr = (t) => (live ? ` data-utc="${Math.round(t)}" data-local-24` : '');
  const entry = (e) => `<div class="entry${e.unread ? ' unread' : ''}"${live ? ` data-utc="${Math.round(e.t)}"` : ''}><span class="t"${tAttr(e.t)}>${h(e.time)}</span><span class="txt">${h(e.text)}</span><span class="note">${h(e.note)}</span></div>`;
  // THE RECORD, newest first. The new entries come first; a rule marks where they end.
  let boundaryDone = f.unread === 0;
  const days = f.days.length ? f.days.map((d) => {
    const rows = d.entries.map((e) => {
      let pre = '';
      if (!boundaryDone && !e.unread) { boundaryDone = true; pre = '<hr class="boundary">'; }
      return pre + entry(e);
    }).join('\n');
    return `<section class="day"><h2>${h(d.header)}</h2>
${rows}
${d.withheld ? `<div class="withheld"${live ? ` data-utc="${Math.round(dayStart(d.t) + 43200)}"` : ''}>${h(f.withheldText)}</div>` : ''}
</section>`;
  }).join('\n') : `<p class="muted">${h(f.emptyText)}</p>`;
  const matters = f.matters.length
    ? f.matters.map((m) => `<div class="entry${m.unread ? ' unread' : ''}"><span class="t"${live ? ` data-utc="${Math.round(m.t)}" data-local-daytime` : ''}>${h(m.day)} ${h(m.time)}</span><span class="txt">${h(m.text)}</span><span class="note">${h(m.note)}</span></div>`).join('\n')
    : `<p class="muted">${h(f.mattersEmpty)}</p>`;
  const neighbor = f.neighbor ? `${f.neighbor.name.toUpperCase()} #${f.neighbor.id}${f.neighbor.tags.map((x) => ` · ${x}`).join('')}` : f.neighborLine.toUpperCase();
  return layout(title, `
<header class="file-head">
${potatoSvg(f.variety, f.seed, { name: f.name, expression: f.expression, sprouted: f.sprouted, size: 120 })}
<h1>${h(f.name.toUpperCase())}</h1>
<p class="tt id">#${h(f.id)} · ${h(f.variety.name.toUpperCase())}${f.curing ? ' · CURING' : ''}${f.sprouted ? ' · SPROUTED' : ''}</p>
<dl class="facts tt"><dt>Standing</dt><dd>${h(f.standing.toUpperCase())}</dd><dt>Current neighbor</dt><dd>${h(neighbor)}</dd></dl>
${f.neighborAside ? `<p class="aside">${h(f.neighborAside)}</p>` : ''}
<p class="tt since">${h(f.sinceLine)}</p>
<p class="muted"><span${live ? ' data-tz-note' : ''}>${f.offsetKnown ? 'Times are local to the potato.' : 'Times are UTC.'}</span></p>
</header>
${fileBallotHtml(f)}
<h2>Matters of record</h2>
<div class="matters">
${matters}
</div>
<form class="ack" method="post" action="/file/${h(f.key)}/ack"><button type="submit">Acknowledge</button></form>
<p class="ack-note">It does nothing except mark that the Hands have read it. The potato will know.</p>
<h2>The record</h2>
${f.unread ? `<p class="tt marker">${h(f.newMarker)}</p>` : ''}
<div${live ? ' data-file-utc' : ''}>
${days}
</div>
<footer class="tt file-foot">${h(f.footer)}</footer>`);
}

// The File's ballot card. Working buttons only for a board that cannot be tapped; otherwise read-only.
function fileBallotHtml(f) {
  const b = f.ballot;
  if (!b) return '';
  const stamp = b.voted ? 'COUNT IN' : 'POLL OPEN';
  let options;
  if (b.canVote) {
    options = `<form class="options vote" method="post" action="/file/${h(f.key)}/vote">${b.options.map((o) => `<button type="submit" class="opt" name="choice_id" value="${h(o.id)}">${h(o.label)}</button>`).join('')}</form>`;
  } else {
    options = `<div class="options">${b.options.map((o) => `<div class="opt${b.voted === o.id ? ' win' : ''}">${h(o.label)}</div>`).join('')}</div>`;
  }
  const informed = f.informed ? `<p class="tt informed">${h(f.informed)}</p>` : '';
  const when = b.kind === 'question' ? `<p class="note">Polls close at ${utc(b.closes_at, ' data-local-end')}<span class="local-slot"></span>.</p>` : '';
  return `<section class="ballot"><span class="stamp">${h(stamp)}</span><h2>${b.kind === 'question' ? 'The Question' : 'The Council asks'}</h2><p class="q">${h(b.text)}</p>${options}${informed}${when}</section>
<p class="aside">${h(b.aside)}</p>`;
}

// After POST /file/<token>/ack: one line, nothing else.
export function renderAcknowledged(line) {
  return layout('Acknowledged', `<p class="tt acked">${h(line)}</p>`);
}

// GET /about — docs/STORY.md, already converted to HTML.
export function renderAbout(storyHtml, { tuberUrl = '' } = {}) {
  return layout('Potatoes Unite! — About', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">About · <a href="/">Front page</a></div></header>
<div class="prose">
${storyHtml}
</div>
${footer({ tuberUrl, privacyHere: true })}`, { bodyClass: 'paper-doc' });
}

// GET /flash — flash a spare board into a citizen. ESP Web Tools, vendored; no CDN.
export function renderFlash({ boards, githubUrl = '', tuberUrl = '' } = {}) {
  const cards = boards.map((b) => `<div class="board-card">
${b.portrait}
<h3>${h(b.citizen)}</h3>
<p>${h(b.blurb)}</p>
<esp-web-install-button manifest="/releases/${h(b.id)}/webflash.json">
<button slot="activate" class="connect">Connect</button>
<span slot="unsupported" class="unsupported">This browser has no Web Serial. Chrome or Edge, on a computer — or the command below.</span>
<span slot="not-allowed" class="unsupported">Serial needs an https page (or localhost).</span>
</esp-web-install-button>
</div>`).join('\n');
  return layout('Potatoes Unite! — Flash', `
<script type="module" src="/vendor/esp-web-tools/install-button.js"></script>
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">Flash · <a href="/">Front page</a></div></header>
<p class="lede">A spare board becomes a citizen. The flasher writes the whole image; the potato does the rest.</p>
<div class="boards">
${cards}
</div>
<p class="requirements">Chrome or Edge, on a computer, with a USB data cable.</p>
<noscript><p class="muted">Without JavaScript the button cannot reach the port. The command works anywhere Python does:</p>
<pre class="oneliner">pip install esptool && esptool --port /dev/ttyUSB0 write_flash 0x0 webflash-&lt;version&gt;.bin   # image: /releases/&lt;board&gt;/webflash.json</pre></noscript>
<h2>Then</h2>
<ol>
<li>The potato opens a Wi-Fi network called POTATO-xxxx. Join it once.</li>
<li>Give it the county's network on the little page that appears.</li>
<li>It names itself. Name, number and variety come from its seed. You are not consulted.</li>
<li>Claim its File with the code on the screen, at <a href="/">the front page</a> under CLAIM YOUR FILE.</li>
</ol>
<p><a href="/flash/agent">Or hand this page to your coding agent →</a></p>
<p class="muted">Tested on exactly these two devices. Another model needs a port — its pins and its display — and the protocol is small. Both show a potato. One of them takes fifteen seconds to change its mind.</p>
<footer><p>No location. No audio. Public counts start at five potatoes. <a href="/about#privacy">Privacy record →</a>${githubUrl ? ` <a href="${h(githubUrl)}">CODE →</a>` : ''}</p>${tuberUrl ? `<p>Editions are also issued on X: <a href="${h(tuberUrl)}">${h(tuberHandle(tuberUrl))}</a>.</p>` : ''}</footer>`);
}

// GET /flash/agent — docs/FLASH_WITH_AN_AGENT.md, when it exists.
export function renderFlashAgent(docHtml) {
  return layout('Potatoes Unite! — Flash with an agent', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">Flash · <a href="/flash">By hand</a> · <a href="/">Front page</a></div></header>
<div class="prose">
${docHtml}
</div>`, { bodyClass: 'paper-doc' });
}

export function renderMessage(title, text) {
  return layout(title, `<header class="mast"><h1>${h(title)}</h1></header><p>${h(text)}</p><p><a href="/">Front page.</a></p>`);
}
