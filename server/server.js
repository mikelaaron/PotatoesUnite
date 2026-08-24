// Potatoes Unite — the Net. One process, zero dependencies. Protocol v0 (docs/PROTOCOL.md).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from './lib/world.js';
import { createApp } from './lib/app.js';
import { advertiseMdns } from './lib/mdns.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(here, 'data', 'potatoes.db');
const TICK_MS = 30_000;

// Logs never carry secrets, claim codes, or anything that maps a potato to a person.
const log = (...a) => console.log(new Date().toISOString(), ...a);

const docsDir = path.join(here, '..', 'docs');
const world = new World({ dbPath: DB_PATH, dataDir: path.join(here, 'data'), assetsDir: path.join(here, '..', 'assets'), docsDir, log });
world.data.start();
world.tick();
const ticker = setInterval(() => { try { world.tick(); } catch (e) { log('tick failed:', e.message); } }, TICK_MS);

const server = http.createServer(createApp({
  world, log,
  illustrationsDir: path.join(docsDir, 'illustrations'),
  artifactsDir: path.join(here, '..', 'assets', 'illustrations'),
  githubUrl: process.env.GITHUB_URL || '',
  tuberUrl: process.env.TUBER_URL || '',
}));

let stopMdns = () => {};
server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  log(`POTATOES UNITE! The Net is open on http://${HOST}:${PORT}`);
  for (const ip of lan) log(`  LAN: http://${ip}:${PORT}   (point a device at this)`);
  log(`  db: ${DB_PATH}`);
  // The portal's default server URL is potatoes.local; a LAN Net answers to it.
  stopMdns = advertiseMdns({ port: PORT, ip: lan[0], log });
});

const shutdown = () => { clearInterval(ticker); stopMdns(); server.close(); world.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
