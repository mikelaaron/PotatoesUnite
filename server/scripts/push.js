#!/usr/bin/env node
// Push a line or an ad-hoc event to every potato, or clear expired entries from data/broadcasts.json.
//   npm run push -- line "A crate has appeared." 20m
//   npm run push -- event "A crate has appeared." "OPEN IT|IGNORE IT|REPORT IT" 30m [--file "Asked about the crate."] [--after "Interesting."] [--result "…{pct_open}%…"]
//   npm run push -- clear
// Durations: 90s, 20m, 2h, 1d. The server hot-reloads the file within ~2 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.BROADCASTS_PATH || path.join(here, '..', 'data', 'broadcasts.json');
const MAX_LINE = 60, MAX_LABEL = 16, MAX_CHOICES = 3;

function fail(msg) { console.error(`push: ${msg}`); process.exit(1); }
function load() { try { const v = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function save(list) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
  fs.renameSync(tmp, FILE);
}
function duration(s) {
  const m = String(s || '').match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) fail(`bad duration "${s}" (try 20m, 2h, 1d)`);
  return Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase()]);
}
function nextId(list, prefix) {
  let n = 1;
  while (list.some((b) => b.id === `${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
function slug(label, used) {
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'choice';
  let base = id, k = 2;
  while (used.has(id)) id = `${base}_${k++}`;
  used.add(id);
  return id;
}
function flags(args) {
  const out = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { out[args[i].slice(2)] = args[i + 1]; i += 1; } else out.rest.push(args[i]);
  }
  return out;
}

export function push(argv, now = Math.floor(Date.now() / 1000)) {
  const { rest, ...opt } = flags(argv);
  const [kind, ...a] = rest;
  const list = load();
  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  if (kind === 'clear') {
    const kept = list.filter((b) => !b.to || Date.parse(b.to) / 1000 > now);
    save(kept);
    return `cleared ${list.length - kept.length} expired; ${kept.length} remain`;
  }
  if (kind === 'line') {
    const [line, dur] = a;
    if (!line) fail('line: text required');
    if (line.length > MAX_LINE) fail(`line is ${line.length} chars; max ${MAX_LINE}`);
    const id = nextId(list, 'l');
    const to = now + duration(dur || '20m');
    list.push({ id, type: 'line', from: iso(now), to: iso(to), line });
    save(list);
    return `${id}: "${line}" until ${iso(to)}`;
  }
  if (kind === 'event') {
    const [line, labels, dur] = a;
    if (!line || !labels) fail('event: "line" "A|B|C" [duration]');
    if (line.length > MAX_LINE) fail(`line is ${line.length} chars; max ${MAX_LINE}`);
    const used = new Set();
    const choices = labels.split('|').map((l) => l.trim()).filter(Boolean).map((label) => ({ id: slug(label, used), label }));
    if (!choices.length || choices.length > MAX_CHOICES) fail(`between 1 and ${MAX_CHOICES} choices`);
    for (const c of choices) if (c.label.length > MAX_LABEL) fail(`label "${c.label}" is ${c.label.length} chars; max ${MAX_LABEL}`);
    const after = opt.after || 'Noted.';
    if (after.length > MAX_LINE) fail(`after is ${after.length} chars; max ${MAX_LINE}`);
    const id = nextId(list, 'e');
    const to = now + duration(dur || '30m');
    list.push({
      id, type: 'event', from: iso(now), to: iso(to), line, choices,
      result: opt.result || `${line} ${choices.map((c) => `${c.label} {pct_${c.id}}%`).join(', ')}.`,
      file: opt.file || 'Asked by the Council.',
      after,
    });
    save(list);
    return `${id}: "${line}" [${choices.map((c) => c.label).join(' · ')}] until ${iso(to)}`;
  }
  fail('usage: push line "text" [20m] | push event "line" "A|B|C" [30m] [--file …] [--after …] [--result …] | push clear');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(push(process.argv.slice(2)));
