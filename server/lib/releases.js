// Firmware releases: data/releases/<board>/<version>.bin beside a manifest.json the device compares itself against.
// a.b.c only; more parts are compared in order, missing parts are zero.
export function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}
export function cmpVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export const BOARD_RE = /^[a-z0-9]+$/;
export const BIN_RE = /^[a-z0-9][a-z0-9.-]*\.bin$/;

// The manifest the device gets, with a server-relative url. Null when nothing is newer than fw.
export function offer(manifest, board, fw) {
  if (!manifest || !manifest.version || !manifest.file) return null;
  if (cmpVersion(manifest.version, fw) <= 0) return null;
  return { version: String(manifest.version), url: `/releases/${board}/${manifest.file}`, sha256: String(manifest.sha256 || ''), size: Number(manifest.size) || 0, notes: String(manifest.notes || '') };
}
