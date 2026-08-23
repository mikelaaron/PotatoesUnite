#!/usr/bin/env node
// Publish a firmware image: npm run release -- <board> <path-to.bin> <version> "notes"
// Copies the bin to data/releases/<board>/<version>.bin and writes manifest.json atomically.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseVersion, BOARD_RE } from '../lib/releases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELEASES = process.env.RELEASES_DIR || path.join(here, '..', 'data', 'releases');

function fail(msg) { console.error(`release: ${msg}`); process.exit(1); }

export function release([board, src, version, notes = ''], dir = RELEASES, now = new Date()) {
  if (!board || !src || !version) fail('usage: release <board> <path-to.bin> <version> ["notes"]');
  if (!BOARD_RE.test(board)) fail(`board "${board}" must be a slug (amoled18, epaper154)`);
  if (!parseVersion(version) || !/^\d+\.\d+\.\d+$/.test(version)) fail(`version "${version}" must be a.b.c`);
  if (notes.includes('\n')) fail('notes: one line');
  let data;
  try { data = fs.readFileSync(src); } catch (e) { fail(`cannot read ${src}: ${e.message}`); }
  if (data.length < 1024) fail(`${src} is ${data.length} bytes; that is not an app image`);
  const target = path.join(dir, board);
  fs.mkdirSync(target, { recursive: true });
  const file = `${version}.bin`;
  const binTmp = path.join(target, `${file}.tmp`);
  fs.writeFileSync(binTmp, data);
  fs.renameSync(binTmp, path.join(target, file));
  const manifest = { version, file, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, notes: String(notes), published: now.toISOString().replace(/\.\d+Z$/, 'Z') };
  const manTmp = path.join(target, 'manifest.json.tmp');
  fs.writeFileSync(manTmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(manTmp, path.join(target, 'manifest.json'));
  return `${board} ${version}: ${file} (${data.length} bytes, sha256 ${manifest.sha256.slice(0, 12)}…) — the server offers it within ~2 s`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(release(process.argv.slice(2)));
