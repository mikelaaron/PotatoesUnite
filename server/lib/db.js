// node:sqlite, no native add-ons. One file, WAL mode, a handful of tables.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS potatoes (
  id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, name TEXT NOT NULL, variety TEXT NOT NULL,
  seed INTEGER NOT NULL, claim_code TEXT UNIQUE NOT NULL, board TEXT, fw TEXT,
  created_t INTEGER NOT NULL, last_seen_t INTEGER NOT NULL,
  battery_pct INTEGER, charging INTEGER DEFAULT 0, vbus INTEGER DEFAULT 0, orientation TEXT DEFAULT 'up',
  since_handled_s INTEGER DEFAULT 0, sound TEXT DEFAULT 'quiet', temp_c REAL, utc_offset_min INTEGER,
  state TEXT NOT NULL DEFAULT '{}', scene_rev INTEGER NOT NULL DEFAULT 0, scene_hash TEXT NOT NULL DEFAULT '',
  file_read_t INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, potato_id TEXT NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL,
  dur_s INTEGER, pct INTEGER, request_id TEXT, received_t INTEGER NOT NULL,
  UNIQUE(potato_id, t, type)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY, potato_id TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL,
  text TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', standing REAL NOT NULL DEFAULT 0,
  dur_s INTEGER NOT NULL DEFAULT 0, withheld INTEGER NOT NULL DEFAULT 0, created_t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_potato_t ON entries(potato_id, t);
CREATE INDEX IF NOT EXISTS entries_kind_t ON entries(kind, t);
CREATE TABLE IF NOT EXISTS question_days (
  day TEXT PRIMARY KEY, question_id TEXT, opened INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, tally TEXT
);
CREATE TABLE IF NOT EXISTS votes (
  day TEXT NOT NULL, potato_id TEXT NOT NULL, choice_id TEXT NOT NULL, by_hands INTEGER NOT NULL, t INTEGER NOT NULL,
  PRIMARY KEY(day, potato_id)
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, potato_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, chk TEXT NOT NULL,
  for_s INTEGER NOT NULL DEFAULT 0, issued_t INTEGER NOT NULL, expires_t INTEGER NOT NULL,
  outcome TEXT, outcome_t INTEGER, day TEXT NOT NULL, slot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS requests_potato ON requests(potato_id, issued_t);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, potato_id TEXT NOT NULL, created_t INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS neighbors (week TEXT NOT NULL, potato_id TEXT NOT NULL, neighbor_id TEXT, PRIMARY KEY(week, potato_id));
CREATE TABLE IF NOT EXISTS bulletins (
  day TEXT NOT NULL, edition TEXT NOT NULL, no INTEGER NOT NULL, headline TEXT NOT NULL, items TEXT NOT NULL, t INTEGER NOT NULL,
  PRIMARY KEY(day, edition)
);
`;

export class Store {
  constructor(file = ':memory:') {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.cache = new Map();
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get(sql, ...p) { return this.stmt(sql).get(...p) ?? null; }
  all(sql, ...p) { return this.stmt(sql).all(...p); }
  run(sql, ...p) { return this.stmt(sql).run(...p); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  meta(key, fallback = null) { const r = this.get('SELECT value FROM meta WHERE key = ?', key); return r ? r.value : fallback; }
  setMeta(key, value) { this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value)); }
  close() { this.db.close(); }
}
