// Potatoes Unite — the Net. One process, zero dependencies. Protocol v0 (docs/PROTOCOL.md).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from './lib/world.js';
import { createApp, parseRate, LIMITS } from './lib/app.js';
import { advertiseMdns } from './lib/mdns.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(here, 'data', 'potatoes.db');
const TICK_MS = 30_000;

// How many proxies in front of us are ours. 0 (the default, and what a LAN Net gets) ignores
// x-forwarded-for entirely, so nothing a stranger types can pass for an address. Railway is one hop:
// set TRUST_PROXY=1 there, or every visitor on earth shares the edge's address and one busy minute
// locks out the internet. See docs/DEPLOY.md.
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(process.env.TRUST_PROXY || '') ? 1 : Math.max(0, Number(process.env.TRUST_PROXY) || 0);
// Loosen a limit without a code change: RATE_HEARTBEAT=480/60, or RATE_REGISTER=off.
const rates = {
  trustProxy: TRUST_PROXY,
  heartbeatLimit: parseRate(process.env.RATE_HEARTBEAT, LIMITS.heartbeat),
  choiceLimit: parseRate(process.env.RATE_CHOICE, LIMITS.choice),
  registerLimit: parseRate(process.env.RATE_REGISTER, LIMITS.register),
  netRegisterLimit: parseRate(process.env.RATE_REGISTER_NET, LIMITS.register_net),
  claimLimit: parseRate(process.env.RATE_CLAIM, LIMITS.claim),
};

// Logs never carry secrets, claim codes, or anything that maps a potato to a person.
const log = (...a) => console.log(new Date().toISOString(), ...a);

const docsDir = path.join(here, '..', 'docs');
const world = new World({ dbPath: DB_PATH, dataDir: path.join(here, 'data'), assetsDir: path.join(here, '..', 'assets'), docsDir, log });
world.data.start();
world.tick();
const ticker = setInterval(() => { try { world.tick(); } catch (e) { log('tick failed:', e.message); } }, TICK_MS);

const server = http.createServer(createApp({
  world, log,
  projectClosed: /^(1|true|yes|on)$/i.test(process.env.PROJECT_CLOSED || ''),
  illustrationsDir: path.join(docsDir, 'illustrations'),
  artifactsDir: path.join(here, '..', 'assets', 'illustrations'),
  githubUrl: process.env.GITHUB_URL || '',
  tuberUrl: process.env.TUBER_URL || '',
  ...rates,
}));

let stopMdns = () => {};
server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  log(`POTATOES UNITE! The Net is open on http://${HOST}:${PORT}`);
  for (const ip of lan) log(`  LAN: http://${ip}:${PORT}   (point a device at this)`);
  log(`  db: ${DB_PATH}`);
  // Say it out loud: unset behind an edge proxy is the failure where every visitor shares one address.
  log(`  addresses: ${TRUST_PROXY ? `x-forwarded-for, ${TRUST_PROXY} trusted hop(s)` : 'the socket (TRUST_PROXY unset — correct on a LAN, wrong behind a proxy)'}`);
  // The portal's default server URL is potatoes.local; a LAN Net answers to it.
  stopMdns = advertiseMdns({ port: PORT, ip: lan[0], log });
});

const shutdown = () => { clearInterval(ticker); stopMdns(); server.close(); world.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
