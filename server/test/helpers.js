import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../lib/world.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
export const ASSETS_DIR = path.join(here, '..', '..', 'assets');

// Tue 25 Aug 2026. A Tuesday, as in the voice doc.
export const BASE = Date.UTC(2026, 7, 25) / 1000;
export const at = (h, m = 0, dayOffset = 0) => BASE + dayOffset * 86400 + h * 3600 + m * 60;

export function makeWorld({ start = at(7, 0), random = () => 0.5 } = {}) {
  const clock = { now: start };
  const w = new World({ dbPath: ':memory:', dataDir: DATA_DIR, assetsDir: ASSETS_DIR, now: () => clock.now, random, log: () => {} });
  return { w, clock, set: (t) => { clock.now = t; } };
}

export const SECRET = (n) => String(n).padStart(2, '0').repeat(16);

export function hb(w, secret, events = [], extra = {}) {
  return w.heartbeat({ secret, rev_seen: 0, battery: { pct: 63, charging: false, vbus: false }, orientation: 'up', since_handled_s: 60, sound: 'quiet', events, ...extra });
}

// The File as plain text, the way §9 draws it.
export function fileText(f) {
  const out = [`${f.name.toUpperCase()} #${f.id} · ${f.variety.name.toUpperCase()} · STANDING: ${f.standing.toUpperCase()}`, f.neighborLine, ''];
  for (const d of f.days) {
    out.push(d.header);
    for (const e of d.entries) out.push(`  ${e.time}  ${e.text.padEnd(46)} ${e.note}`.trimEnd());
    if (d.withheld) out.push(`         ${f.withheldText}`);
    out.push('');
  }
  return out.join('\n');
}
