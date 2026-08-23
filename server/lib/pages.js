// Plain server-rendered HTML. Paper and ink, a terminal's worth of type. No framework, no JS except the one POST.
import { escapeHtml as h, fewerThanFive } from './text.js';
import { hm, dayHeader } from './clock.js';

const CSS = `
:root { --paper: #efe6cf; --ink: #1c1a16; --rule: #5e5647; --faint: #7d7462; --bar: #1c1a16; --barbg: #d9cfb2; --wash: #e6dcc2; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #15130f; --ink: #e8dfc6; --rule: #9a907a; --faint: #a09680; --bar: #e8dfc6; --barbg: #2a2620; --wash: #1e1b16; }
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0 auto; max-width: 46rem; padding: 1.5rem 1rem 3rem; background: var(--paper); color: var(--ink);
  font-family: 'VT323', 'Courier New', Courier, monospace; font-size: 22px; line-height: 1.3; }
a { color: inherit; }
.mast { text-align: center; border-top: 4px double var(--rule); border-bottom: 4px double var(--rule); padding: .4rem 0 .5rem; margin-bottom: 1rem; }
.mast h1 { margin: 0; font-size: 3rem; letter-spacing: .06em; line-height: 1; }
.mast .sub { color: var(--faint); text-transform: uppercase; letter-spacing: .15em; font-size: .8em; margin-top: .3rem; }
h2 { font-size: 1em; text-transform: uppercase; letter-spacing: .2em; border-bottom: 1px solid var(--rule); margin: 1.6rem 0 .5rem; padding-bottom: .1rem; color: var(--faint); }
p { margin: .4rem 0; }
.pop { font-size: 1.2em; }
.q { font-size: 1.25em; }
.muted { color: var(--faint); }
.tally { list-style: none; padding: 0; margin: .5rem 0; }
.tally li { margin: .35rem 0; }
.tally .lab { display: flex; justify-content: space-between; gap: 1rem; }
.tally .bar { height: .7em; background: var(--barbg); margin-top: .15rem; }
.tally .bar span { display: block; height: 100%; background: var(--bar); }
.tally .win .lab { font-weight: bold; }
.head { font-size: 1.35em; margin: .3rem 0 .2rem; letter-spacing: .02em; }
ul.items { padding-left: 1.2rem; margin: .2rem 0; }
ul.items li { margin: .2rem 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1.2rem; margin: .4rem 0; }
dt { color: var(--faint); }
dd { margin: 0; }
.notice { border-left: 3px solid var(--rule); padding: .2rem .8rem; margin: .5rem 0; background: var(--wash); }
footer { margin-top: 2.5rem; border-top: 1px solid var(--rule); padding-top: .6rem; color: var(--faint); font-size: .85em; }
/* the File */
.file-head { border-bottom: 4px double var(--rule); padding-bottom: .5rem; margin-bottom: .5rem; }
.file-head h1 { font-size: 1.5em; margin: 0; letter-spacing: .04em; word-break: break-word; }
.file-head .standing { float: right; }
.day { margin-top: 1.2rem; }
.day h2 { margin-bottom: .2rem; }
.entry { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0 .6rem; padding: .12rem 0; }
.entry .t { color: var(--faint); }
.entry .txt { }
.entry .note { color: var(--faint); grid-column: 2; }
.entry.unread .txt::before { content: '\\2022 '; }
@media (min-width: 40rem) { .entry { grid-template-columns: 4.2rem minmax(0, 1fr) minmax(0, 44%); } .entry .note { grid-column: auto; } }
.withheld { color: var(--faint); font-style: italic; padding-left: 4.8rem; }
form.ack { margin: 2rem 0 0; text-align: center; }
button { font: inherit; font-size: 1.1em; background: var(--ink); color: var(--paper); border: 0; padding: .4rem 1.4rem; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
button:hover { opacity: .85; }
.ack-note { text-align: center; color: var(--faint); font-size: .85em; }
.sprout { display: inline-block; margin-left: .4rem; }
`;

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
</body>
</html>`;
}

const PRIVACY = 'No location ever leaves a device. No raw audio, only a loudness bucket. Nothing below five potatoes is shown publicly. Potato names and numbers are pseudonyms; only the Hands know which is theirs.';

function bulletinHtml(b) {
  if (!b) return '<p class="muted">No Bulletin yet. The press is warming up.</p>';
  return `<h2>Potato Bulletin No. ${h(b.no)} — ${h(String(b.edition).toUpperCase())}</h2>
<p class="head">${h(b.headline)}</p>
<ul class="items">${b.items.map((i) => `<li>${h(i)}</li>`).join('')}</ul>`;
}

export function renderBoard(b) {
  const date = dayHeader(b.t);
  let question = '';
  if (b.silence) {
    question = `<h2>The Question</h2><p class="q">${h(b.silenceLine)}</p>`;
  } else if (!b.question) {
    question = `<h2>The Question</h2><p class="muted">No Question today.</p>`;
  } else {
    const q = b.question;
    let body = '';
    if (q.state === 'upcoming') body = `<p class="muted">Opens at ${h(hm(q.opens_at))} UTC. ${h(q.pollsClose)}</p>`;
    else if (q.state === 'open') body = `<p class="muted">${h(q.pollsClose)}</p><p class="muted">${q.options.map((o) => h(o.label)).join(' · ')}</p>`;
    else if (q.withdrawn) body = `<p>${h(q.remark)}</p>`;
    else {
      const hideSmall = q.total < 5 || q.options.some((o) => o.count < 5);
      body = `<ul class="tally">${q.options.map((o) => `<li class="${o.winner ? 'win' : ''}">
<div class="lab"><span>${h(o.label)}</span><span>${hideSmall ? (o.count < 5 ? 'fewer than five' : h(o.count)) : `${h(o.count)} (${h(o.pct)}%)`}</span></div>
<div class="bar"><span style="width:${q.total < 5 ? 0 : Math.max(2, o.pct)}%"></span></div></li>`).join('')}</ul>
${q.total < 5 ? '<p class="muted">Fewer than five voted. The Council does not publish small Counts.</p>' : ''}
${q.remark ? `<p>${h(q.remark)}</p>` : ''}`;
    }
    question = `<h2>The Question</h2><p class="q">${h(q.text)}</p>${body}`;
  }
  const A = b.aggregates;
  const agg = b.small
    ? `<p class="muted">The Net has fewer than five members. Aggregates are withheld until it doesn't.</p>`
    : `<dl>
<dt>Left home</dt><dd>${h(fewerThanFive(A.left_home))}</dd>
<dt>Six hours in the dark</dt><dd>${h(fewerThanFive(A.dark6))}</dd>
<dt>Shakings</dt><dd>${h(fewerThanFive(A.shakes))}</dd>
<dt>Drops</dt><dd>${h(fewerThanFive(A.drops))}</dd>
<dt>In transit</dt><dd>${h(fewerThanFive(A.transit))}</dd>
<dt>Dormant</dt><dd>${h(fewerThanFive(A.dormant))}</dd>
<dt>Curing</dt><dd>${h(fewerThanFive(A.curing))}</dd>
</dl>`;
  const missing = b.missing.length ? `<h2>Missing</h2>${b.missing.map((m) => `<p class="notice">${h(m)}</p>`).join('')}` : '';
  const potd = b.potd ? `<h2>Potato of the Day</h2><p>${h(b.potd.name)} #${h(b.potd.id)} · ${h(b.potd.variety)}</p>${b.potd.excerpt ? `<p class="notice">${h(b.potd.excerpt)}</p>` : ''}` : '';
  return layout('POTATOES UNITE!', `
<header class="mast"><h1>POTATOES UNITE!</h1><div class="sub">The board · ${h(date)} · No. ${h(b.no)}</div></header>
<p class="pop">Population: ${h(fewerThanFive(b.population))}.</p>
${question}
${bulletinHtml(b.bulletin)}
<h2>Today on the Net</h2>
${agg}
${missing}
${potd}
<footer>${h(PRIVACY)}</footer>`);
}

export function renderFile(f) {
  const title = `${f.name.toUpperCase()} #${f.id} · ${f.variety.name.toUpperCase()} · STANDING: ${f.standing.toUpperCase()}`;
  const days = f.days.length ? f.days.map((d) => `<section class="day"><h2>${h(d.header)}</h2>
${d.entries.map((e) => `<div class="entry${e.unread ? ' unread' : ''}"><span class="t">${h(e.time)}</span><span class="txt">${h(e.text)}</span><span class="note">${h(e.note)}</span></div>`).join('\n')}
${d.withheld ? `<div class="withheld">${h(f.withheldText)}</div>` : ''}
</section>`).join('\n') : `<p class="muted">${h(f.emptyText)}</p>`;
  return layout(title, `
<header class="file-head">
<h1>${h(f.name.toUpperCase())} #${h(f.id)} · ${h(f.variety.name.toUpperCase())} · STANDING: ${h(f.standing.toUpperCase())}${f.sprouted ? '<span class="sprout" title="Sprouted">⌇</span>' : ''}</h1>
<p>${h(f.neighborLine)}${f.curing ? ' · Curing.' : ''}${f.sprouted ? ' · Sprouted.' : ''}</p>
<p class="muted">${f.offsetKnown ? 'Times are local to the device.' : 'Times are UTC.'}${f.unread ? ` ${f.unread} unread.` : ''}</p>
</header>
${days}
<form class="ack" method="post" action="/file/${h(f.claim_code)}/ack"><button type="submit">Acknowledge</button></form>
<p class="ack-note">It does nothing except mark that the Hands have read it. The potato will know.</p>
<footer>Read-only. ${h(PRIVACY)}</footer>`);
}

export function renderMessage(title, text, status = 404) {
  return layout(title, `<header class="mast"><h1>${h(title)}</h1></header><p>${h(text)}</p><p><a href="/">The board.</a></p>`);
}
