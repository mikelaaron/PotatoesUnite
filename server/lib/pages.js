// Plain server-rendered HTML. Paper and ink. Teletext (VT323) for the official parts — masthead, dateline,
// section labels, timestamps, stamps, all-caps notices — and a readable serif for everything a person reads.
// Times are rendered in UTC; a tiny inline script adds the viewer's local time and keeps the countdown current.
import { escapeHtml as h, fewerThanFive } from './text.js';
import { hm, dayHeader, dayStart } from './clock.js';

const CSS = `
:root { --paper: #efe6cf; --ink: #1c1a16; --rule: #5e5647; --faint: #7d7462; --bar: #1c1a16; --barbg: #d9cfb2; --wash: #e6dcc2;
  --tt: 'VT323', 'Courier New', Courier, monospace; --serif: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #15130f; --ink: #e8dfc6; --rule: #9a907a; --faint: #a09680; --bar: #e8dfc6; --barbg: #2a2620; --wash: #1e1b16; }
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0 auto; max-width: 65ch; padding: 1.5rem 1rem 3rem; background: var(--paper); color: var(--ink);
  font-family: var(--serif); font-size: 19px; line-height: 1.5; }
a { color: inherit; }
.tt, h2, .mast h1, .mast .sub, .now, .next, .pop, .head, .stamp, .label, .entry .t, .entry .txt, .day h2, .small, .file-head h1, .ack-note, button, .insert, .withheld, .edition h2 { font-family: var(--tt); line-height: 1.25; }
.mast { text-align: center; border-top: 4px double var(--rule); border-bottom: 4px double var(--rule); padding: .4rem 0 .5rem; margin-bottom: .6rem; }
.mast h1 { margin: 0; font-size: 3rem; letter-spacing: .06em; line-height: 1; }
.mast .sub { color: var(--faint); text-transform: uppercase; letter-spacing: .15em; font-size: 1em; margin-top: .3rem; }
.mast .sub a { text-decoration: none; border-bottom: 1px solid var(--faint); }
.now { text-align: center; color: var(--faint); margin: 0; font-size: 1.15em; }
.next { text-align: center; color: var(--faint); margin: 0 0 .8rem; font-size: 1.05em; letter-spacing: .08em; }
.lede { text-align: center; margin: 0 0 1.2rem; color: var(--ink); }
h2 { font-size: 1.1em; text-transform: uppercase; letter-spacing: .2em; border-bottom: 1px solid var(--rule); margin: 1.6rem 0 .5rem; padding-bottom: .1rem; color: var(--faint); clear: both; }
.small { color: var(--faint); font-size: .9em; margin: -.3rem 0 .4rem; letter-spacing: .1em; }
p { margin: .4rem 0; }
.pop { font-size: 1.3em; text-transform: uppercase; letter-spacing: .06em; }
.muted { color: var(--faint); }
/* the ballot: a paper object, the same in the dark */
.ballot { position: relative; background: #F3EBD6; color: #1C1A16; border: 2px solid #1C1A16; box-shadow: 0 1px 2px rgba(0,0,0,.18); padding: 1.1rem 1.4rem 1rem; margin: 1.4rem 0; }
.ballot h2 { color: #5E5647; border-color: #1C1A16; margin: 0 0 .5rem; }
.ballot .q { font-size: 1.2em; margin: .3rem 0 .9rem; padding-right: 7rem; }
.options { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .6rem; }
.opt { border: 1.5px solid #1C1A16; padding: .5rem .6rem; text-align: center; }
.opt.win { background: #1C1A16; color: #F3EBD6; }
.stamp { position: absolute; top: .7rem; right: .9rem; transform: rotate(-8deg); color: #B4281E; border: 2px solid #B4281E; padding: .05em .5em; font-size: 1.05em; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.ballot .note { color: #5E5647; font-size: .9em; margin: .9rem 0 0; }
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
.doc { float: right; width: 320px; max-width: 45%; margin: .4rem 0 1rem 1.5rem; }
.doc img { display: block; width: 100%; height: auto; }
.doc .label { display: block; text-align: center; color: var(--faint); letter-spacing: .15em; margin-top: .3rem; }
ul.editions { list-style: none; padding: 0; margin: .3rem 0; }
ul.editions li { margin: .3rem 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1.2rem; margin: .4rem 0; }
dt { color: var(--faint); }
dd { margin: 0; }
.notice { border-left: 3px solid var(--rule); padding: .2rem .8rem; margin: .5rem 0; background: var(--wash); }
footer { clear: both; margin-top: 2.5rem; border-top: 1px solid var(--rule); padding-top: .6rem; color: var(--faint); font-size: .9em; }
/* editions archive */
.edition { margin: 1.4rem 0 2rem; }
.edition h2 { margin-bottom: .2rem; }
/* the File */
.file-head { border-bottom: 4px double var(--rule); padding-bottom: .5rem; margin-bottom: .5rem; }
.file-head h1 { font-size: 1.5em; margin: 0; letter-spacing: .04em; word-break: break-word; }
.day { margin-top: 1.2rem; }
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
.prose h2 { margin-top: 1.8rem; }
.prose p { margin: .7rem 0; }
.prose ul, .prose ol { padding-left: 1.4rem; margin: .5rem 0; }
.prose li { margin: .25rem 0; }
.prose hr { border: 0; border-top: 1px solid var(--rule); margin: 1.4rem 0; clear: both; }
.prose em { font-style: italic; }
.prose > p:first-of-type { font-size: 1.15em; }
.prose pre { overflow-x: auto; }
/* illustrations (docs/ILLUSTRATION_BRIEF.md §4, floats per the weekend pass) */
.ill { position: relative; margin: 48px auto; }
.ill img { display: block; width: 100%; height: auto; aspect-ratio: 3 / 2; }
.ill-full { max-width: 720px; }
.ill-float { width: 42%; float: right; margin: 0 0 1rem 1.5rem; }
.ill-left { float: left; margin: 0 1.5rem 1rem 0; }
@media (max-width: 640px) { .ill-float { float: none; width: 100%; margin: 48px auto; } }
.insert { position: absolute; top: 14%; right: 10%; background: #000; color: #e8dfcb; font-size: 1.1em; line-height: 1; letter-spacing: .12em; padding: .35em .7em; box-shadow: inset 0 0 0 1px #e8dfcb, 0 0 0 3px #000; }
.artifact { width: 60%; max-width: 480px; margin: 48px auto; clear: both; }
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

export function layout(title, body) {
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
<body>
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

// The front page's footer: one sentence and the privacy record. The Tuber, when it has an address.
export function footer({ tuberUrl = '' } = {}) {
  return `<footer><p>No location. No audio. Nothing reported below five potatoes. <a href="/about#privacy">Privacy record →</a></p>${tuberUrl ? `<p>Editions are also issued on <a href="${h(tuberUrl)}">X</a>.</p>` : ''}</footer>`;
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
<ul class="items">${b.items.map((i) => `<li>${withTimes(i, b.t)}</li>`).join('')}</ul></article>`;
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
<ul class="items">${b.bulletin.items.map((i) => `<li>${withTimes(i, b.bulletin.t)}</li>`).join('')}</ul>`
    : `<h2>The Bulletin</h2>${doc}<p class="muted">No Bulletin yet. The press is warming up.</p>`;
  const earlier = b.earlier && b.earlier.length
    ? `<h2>Earlier editions</h2><ul class="editions">${b.earlier.map((e) => `<li><a href="/editions/${h(e.day)}/${h(e.edition)}">${h(dayHeader(e.t))} · ${h(String(e.edition).toUpperCase())} — ${h(e.headline)}</a></li>`).join('')}</ul>`
    : '';
  const missing = b.missing.length ? `<h2>Missing</h2>${b.missing.map((m) => `<p class="notice">${h(m)}</p>`).join('')}` : '';
  const potd = b.potd ? `<h2>Potato of the Day</h2><p>${h(b.potd.name)} #${h(b.potd.id)} · ${h(b.potd.variety)}</p>${b.potd.excerpt ? `<p class="notice">${h(b.potd.excerpt)}</p>` : ''}` : '';
  return layout('POTATOES UNITE!', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">The Net · ${h(dayHeader(b.t))} · Day ${h(b.no)} · <a href="/about">About</a></div></header>
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
  const days = f.days.length ? f.days.map((d) => `<section class="day"><h2>${h(d.header)}</h2>
${d.entries.map((e) => `<div class="entry${e.unread ? ' unread' : ''}"${live ? ` data-utc="${Math.round(e.t)}"` : ''}><span class="t"${tAttr(e.t)}>${h(e.time)}</span><span class="txt">${h(e.text)}</span><span class="note">${h(e.note)}</span></div>`).join('\n')}
${d.withheld ? `<div class="withheld"${live ? ` data-utc="${Math.round(dayStart(d.t) + 43200)}"` : ''}>${h(f.withheldText)}</div>` : ''}
</section>`).join('\n') : `<p class="muted">${h(f.emptyText)}</p>`;
  return layout(title, `
<header class="file-head">
<h1>${h(f.name.toUpperCase())} #${h(f.id)} · ${h(f.variety.name.toUpperCase())} · STANDING: ${h(f.standing.toUpperCase())}${f.sprouted ? '<span class="sprout" title="Sprouted">⌇</span>' : ''}</h1>
<p>${h([f.neighborLine, f.curing ? 'Curing.' : '', f.sprouted ? 'Sprouted.' : ''].filter(Boolean).join(' '))}</p>
<p class="muted"><span${live ? ' data-tz-note' : ''}>${f.offsetKnown ? 'Times are local to the potato.' : 'Times are UTC.'}</span>${f.unread ? ` ${f.unread} unread.` : ''}</p>
</header>
<div${live ? ' data-file-utc' : ''}>
${days}
</div>
<form class="ack" method="post" action="/file/${h(f.claim_code)}/ack"><button type="submit">Acknowledge</button></form>
<p class="ack-note">It does nothing except mark that the Hands have read it. The potato will know.</p>
<footer>Read-only. ${h(PRIVACY_LONG)}</footer>`);
}

// GET /about — docs/STORY.md, already converted to HTML.
export function renderAbout(storyHtml, { tuberUrl = '' } = {}) {
  return layout('Potatoes Unite! — About', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">About · <a href="/">Front page</a></div></header>
<div class="prose">
${storyHtml}
</div>
${footer({ tuberUrl })}`);
}

export function renderMessage(title, text) {
  return layout(title, `<header class="mast"><h1>${h(title)}</h1></header><p>${h(text)}</p><p><a href="/">Front page.</a></p>`);
}
