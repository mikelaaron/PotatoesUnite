// A small severe portrait, from assets/varieties.json: the same silhouette the device draws, as inline SVG.
// Lying down, two dimple eyes, no mouth. Expression by eye shape only.
import { escapeHtml } from './text.js';

export function potatoSvg(variety, seed, { name = '', expression = 'neutral', sprouted = false, size = 120 } = {}) {
  const sil = (variety && variety.silhouette) || {};
  const eyes = (variety && variety.eyes) || {};
  const skin = (variety && variety.skin) || '#A8743F';
  const cx = 60, cy = 44, rx = 44 * (sil.size || 1), ry = rx * (sil.h || 0.65);
  const knobs = sil.knobs == null ? 0.2 : sil.knobs;
  const s = Number(seed) || 1;
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const th = (i / 48) * 2 * Math.PI;
    const b = 1 + knobs * (0.14 * Math.sin(2 * th + (s % 7)) + 0.09 * Math.sin(3 * th + ((s >> 3) % 11)) + 0.06 * Math.sin(5 * th + ((s >> 6) % 13)))
      + 0.05 * Math.cos(th); // one end fatter
    pts.push([cx + rx * b * Math.cos(th), cy + ry * b * Math.sin(th)]);
  }
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
    const mx = ((p0[0] + p1[0]) / 2).toFixed(1), my = ((p0[1] + p1[1]) / 2).toFixed(1);
    d += i === 0 ? `M${mx} ${my}` : ` Q${p0[0].toFixed(1)} ${p0[1].toFixed(1)} ${mx} ${my}`;
  }
  d += ' Z';
  const gap = rx * (eyes.gap || 0.25), ey = cy - ry * 0.18, r = rx * (eyes.size || 0.06) * 1.5;
  const slit = expression === 'aggrieved';
  const eye = (x) => slit
    ? `<ellipse cx="${x.toFixed(1)}" cy="${ey.toFixed(1)}" rx="${(r * 1.4).toFixed(1)}" ry="${(r * 0.35).toFixed(1)}" fill="#1A120C"/>`
    : `<ellipse cx="${x.toFixed(1)}" cy="${ey.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 1.3).toFixed(1)}" fill="#1A120C"/>`;
  let dimples = '';
  const n = Math.max(0, (eyes.count || 4) - 2);
  for (let i = 0; i < n; i++) {
    const a = ((s >> (i * 2)) % 360) * Math.PI / 180, rr = 0.45 + ((s >> (i * 3)) % 40) / 100;
    const x = cx + rx * rr * Math.cos(a), y = cy + ry * rr * Math.sin(a);
    dimples += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.7).toFixed(1)}" ry="${(r * 0.45).toFixed(1)}" fill="#1A120C" opacity=".55" transform="rotate(${(s >> i) % 60 - 30} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  const sprout = sprouted ? `<path d="M${(cx + rx * 0.3).toFixed(1)} ${(cy - ry).toFixed(1)} q 2 -9 8 -12 m -8 12 q -5 -6 -3 -11" fill="none" stroke="#1A120C" stroke-width="1.6" stroke-linecap="round"/>` : '';
  return `<svg class="portrait" viewBox="0 0 120 80" width="${size}" height="${Math.round(size * 2 / 3)}" role="img" aria-label="${escapeHtml(name)}">` +
    `<path d="${d}" fill="${escapeHtml(skin)}" stroke="#1A120C" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<ellipse cx="${(cx + 4).toFixed(1)}" cy="${(cy + ry * 0.35).toFixed(1)}" rx="${(rx * 0.8).toFixed(1)}" ry="${(ry * 0.45).toFixed(1)}" fill="#000" opacity=".12"/>` +
    dimples + eye(cx - gap) + eye(cx + gap) + sprout + '</svg>';
}
