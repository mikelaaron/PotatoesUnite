// The admin tool in v1 is a text editor. questions.json, broadcasts.json, pools/*.json and
// assets/varieties.json are read from disk and re-read whenever their mtime changes.
import fs from 'node:fs';
import path from 'node:path';

export class Data {
  constructor({ dataDir, assetsDir, pollMs = 2000, log = () => {} }) {
    this.dataDir = dataDir;
    this.assetsDir = assetsDir;
    this.pollMs = pollMs;
    this.log = log;
    this.files = new Map(); // path → { mtimeMs, value }
    this.questions = [];
    this.broadcasts = [];
    this.pools = {};
    this.varieties = [];
    this.timer = null;
    this.reload(true);
  }

  // Re-read anything whose mtime moved. Cheap enough to call on every tick.
  reload(force = false) {
    let changed = false;
    const read = (file, fallback) => {
      let st;
      try { st = fs.statSync(file); } catch { return fallback; }
      const prev = this.files.get(file);
      if (!force && prev && prev.mtimeMs === st.mtimeMs) return prev.value;
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.files.set(file, { mtimeMs: st.mtimeMs, value });
        if (prev) this.log(`reloaded ${path.relative(this.dataDir, file)}`);
        changed = true;
        return value;
      } catch (err) {
        this.log(`could not parse ${file}: ${err.message} (keeping the previous copy)`);
        return prev ? prev.value : fallback;
      }
    };
    this.questions = read(path.join(this.dataDir, 'questions.json'), []);
    this.broadcasts = read(path.join(this.dataDir, 'broadcasts.json'), []);
    const poolsDir = path.join(this.dataDir, 'pools');
    let names = [];
    try { names = fs.readdirSync(poolsDir).filter((f) => f.endsWith('.json')); } catch { /* no pools dir */ }
    const pools = {};
    for (const f of names) pools[f.replace(/\.json$/, '')] = read(path.join(poolsDir, f), {});
    this.pools = pools;
    const v = read(path.join(this.assetsDir, 'varieties.json'), { varieties: [] });
    this.varieties = Array.isArray(v) ? v : (v.varieties || []);
    return changed;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.reload(), this.pollMs);
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  question(id) { return this.questions.find((q) => q.id === id) || null; }
  variety(id) { return this.varieties.find((v) => v.id === id) || null; }
}
