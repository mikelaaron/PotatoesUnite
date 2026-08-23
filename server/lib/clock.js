// All world time is UTC unix seconds. The Question is the clock; these are its hands.
export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;

// Protocol constants (docs/PROTOCOL.md §Constants)
export const OPEN_H = 13;              // Question opens 13:00 UTC
export const CLOSE_H = 23;             // closes 23:00 UTC
export const DORMANT_S = 6 * HOUR;     // no heartbeat for 6 h
export const MISSING_S = 72 * HOUR;    // no heartbeat for 72 h
export const SPROUT_S = 7 * DAY;       // no handling for 7 days
export const REQUEST_TTL_S = HOUR;     // requests expire after one hour
export const HUM_H = 2, HUM_M = 13;    // 02:13

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n) => String(n).padStart(2, '0');

export function dayStart(t) { return Math.floor(t / DAY) * DAY; }
export function dayKey(t) {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function dayStartOfKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}
export function openAt(t) { return dayStart(t) + OPEN_H * HOUR; }
export function closeAt(t) { return dayStart(t) + CLOSE_H * HOUR; }
export function humAt(t) { return dayStart(t) + HUM_H * HOUR + HUM_M * MIN; }

// Monday 00:00 UTC that begins the week containing t.
export function weekStart(t) {
  const ds = dayStart(t);
  const wd = new Date(ds * 1000).getUTCDay(); // 0 = Sunday
  const sinceMonday = (wd + 6) % 7;
  return ds - sinceMonday * DAY;
}
export function weekKey(t) { return dayKey(weekStart(t)); }
export function weekday(t) { return new Date(t * 1000).getUTCDay(); }
export function weekdayName(t) { return WD_LONG[weekday(t)]; }

// Rendering. offsetMin shifts a UTC instant into the Hands' local time when the device told us its offset.
export function hm(t, offsetMin = 0) {
  const d = new Date((t + offsetMin * MIN) * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function dayHeader(t, offsetMin = 0) {
  const d = new Date((t + offsetMin * MIN) * 1000);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function localDayKey(t, offsetMin = 0) { return dayKey(t + offsetMin * MIN); }
export function dayOrdinal(t, offsetMin = 0) {
  const n = new Date((t + offsetMin * MIN) * 1000).getUTCDate();
  const s = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${s}`;
}
export function hourOf(t, offsetMin = 0) { return new Date((t + offsetMin * MIN) * 1000).getUTCHours(); }
export function isoDate(t) { return new Date(t * 1000).toISOString().replace(/\.\d+Z$/, 'Z'); }
