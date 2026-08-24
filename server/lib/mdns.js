// The portal pre-fills http://potatoes.local:8080, so a LAN Net must answer to
// the name — the rehearsal proved nobody edits that field (24 Aug: Yvonne sat
// on the Wi-Fi knocking on a name nothing served). On macOS the system's
// mDNSResponder does the talking via a `dns-sd -P` proxy registration; other
// platforms log and move on until someone runs a desk server on one. The
// public Net never advertises: it has a real domain, and Railway is linux,
// which makes this a no-op there by construction.
import { spawn } from 'node:child_process';

export function advertiseMdns({ name = 'potatoes', host = 'potatoes.local', port, ip, log = () => {} } = {}) {
  if (process.platform !== 'darwin') { log('mdns: not advertising (only the macOS dns-sd path exists so far)'); return () => {}; }
  if (!ip || !port) { log('mdns: no LAN address to advertise'); return () => {}; }
  let child = null, stopped = false;
  const start = () => {
    if (stopped) return;
    child = spawn('dns-sd', ['-P', name, '_http._tcp', 'local', String(port), host, ip], { stdio: 'ignore' });
    child.on('error', (e) => log(`mdns: dns-sd failed to start: ${e.message}`));
    child.on('exit', (code) => {
      if (stopped) return;
      log(`mdns: dns-sd exited (${code}); restarting in 5 s`);
      setTimeout(start, 5000).unref();
    });
  };
  start();
  log(`mdns: ${host} -> ${ip}:${port}`);
  return () => { stopped = true; if (child) child.kill(); };
}
