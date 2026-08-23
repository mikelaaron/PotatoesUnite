// Deterministic picks. Same seed + same salts → same answer, forever.

// FNV-1a 32-bit over the joined parts, then a final avalanche. Always a non-negative integer.
export function h32(...parts) {
  const s = parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // murmur3 fmix32
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// A potato's seed comes from its device secret, not its slot: the first potato on a fresh Net is not
// always Doreen. Deterministic per device, idempotent on re-register. 31-bit positive so every JSON
// parser on earth is happy.
export function seedFromSecret(secret) {
  return h32('potato-seed', String(secret).toLowerCase(), 0x5eed) & 0x7fffffff;
}

export function pick(arr, ...salts) {
  if (!arr || arr.length === 0) return undefined;
  return arr[h32(...salts) % arr.length];
}

// A bag order: 0..n-1 shuffled by h32, deterministic per (salts). One cycle
// of a pool plays out in this order before any line comes back.
export function bagOrder(n, ...salts) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = h32(...salts, i) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fisher–Yates with an injectable random() for tests.
export function shuffle(arr, random = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
