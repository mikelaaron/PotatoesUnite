// Words for numbers, durations, and the little template language the pools use.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberWords(n) {
  n = Math.round(Number(n) || 0);
  if (n < 0) return `minus ${numberWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  return String(n);
}

export function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// "4h 45m" / "12m" / "2d 4h" / "40s" — the File's right-hand column.
export function durShort(s) {
  s = Math.max(0, Math.round(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// "Four hours, forty-five minutes" — for the line that counted.
export function durWords(s) {
  s = Math.max(0, Math.round(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${numberWords(d)} day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${numberWords(h)} hour${h === 1 ? '' : 's'}`);
  if (m || parts.length === 0) parts.push(`${numberWords(m)} minute${m === 1 ? '' : 's'}`);
  return capitalize(parts.slice(0, 2).join(', '));
}

// 24h hour → "four" (12-hour clock, words).
export function hourWords(h) { const x = h % 12; return numberWords(x === 0 ? 12 : x); }

// {key} and {a.b} substitution. Missing fields render as ''.
export function fill(template, fields = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), fields);
    return v === undefined || v === null ? '' : String(v);
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Protocol: scene line ≤ 60 chars. Never truncate mid-word: keep the longest run of whole sentences that fits.
export function fitLine(s, max = 60) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  const sentences = s.match(/[^.!?…]+[.!?…]*\s*/g) || [s];
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).trimEnd().length > max) break;
    out += sen;
  }
  out = out.trimEnd();
  return out.length ? out : s.slice(0, max).trimEnd();
}

// Nothing below five potatoes is shown publicly.
export function fewerThanFive(n) { return n < 5 ? 'fewer than five' : String(n); }

// "Put me somewhere high. I need to think." → "put me somewhere high."
export function requestShort(text) {
  const first = String(text).split(/(?<=[.?!])\s/)[0];
  return first ? first[0].toLowerCase() + first.slice(1) : text;
}

export function pct(n, total) { return total ? Math.round((100 * n) / total) : 0; }

// A choice label as the potato says it: "HUNT'S" → "Hunt's", "WHATEVER'S THERE" → "Whatever's there".
export function sayLabel(label) {
  const s = String(label).toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
