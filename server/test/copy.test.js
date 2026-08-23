// Every line the server can put on a screen fits in 60 characters at the worst fill it can produce.
// If this fails, fix the copy or the fill — fitLine must never clip a pool line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Data } from '../lib/data.js';
import { fill, sayLabel, durWords, numberWords } from '../lib/text.js';
import { NAMES } from '../lib/names.js';
import { DATA_DIR, ASSETS_DIR } from './helpers.js';

const d = new Data({ dataDir: DATA_DIR, assetsDir: ASSETS_DIR });
const longestName = NAMES.reduce((a, b) => (b.length > a.length ? b : a), '');
const longestVariety = d.varieties.map((v) => v.name).reduce((a, b) => (b.length > a.length ? b : a), '');
const longestChoice = d.questions.flatMap((q) => q.options.map((o) => sayLabel(o.short || o.label))).reduce((a, b) => (b.length > a.length ? b : a), '');

// The most the server will ever substitute for each field.
const WORST = {
  neighbor: longestName,                       // Bernadette
  variety: longestVariety,                     // Purple Majesty
  hour_words: 'eleven',                        // 12-hour clock, in words
  hour: '12 AM',
  duration_words: durWords(120 * 86400 + 23 * 3600), // "One hundred twenty days, twenty-three hours"
  days_words: numberWords(23),
  n_words: numberWords(20),                    // above twenty the wifi line stops counting
  temp: '104',
  day_ordinal: '31st',
  choice: longestChoice,                       // the device's short label, said back
  pct_words: 'seventy-seven',
  pct: '77',
  open_time: '13:00 UTC',
  close_time: '23:00 UTC',
};

function* walk(node, path) {
  if (typeof node === 'string') yield [path, node];
  else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* walk(node[i], `${path}[${i}]`);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) yield* walk(v, `${path}.${k}`);
}

// The pools the scene builder draws lines from. Bulletin items, File entries and Net-only copy are not scene lines.
const SCENE_POOLS = [
  ['reactions', d.pools.reactions],
  ['charging', { plugged: d.pools.charging.plugged, plugged_overnight: d.pools.charging.plugged_overnight, full: d.pools.charging.full, unplugged: d.pools.charging.unplugged, running_down: d.pools.charging.running_down, waking: d.pools.charging.waking, waking_3d: d.pools.charging.waking_3d }],
  ['net', { neighbor: d.pools.net.neighbor, hum: d.pools.net.hum, silence: d.pools.net.silence, memory: d.pools.net.memory, count: d.pools.net.count, file_unread: d.pools.net.file_unread, sprouted: d.pools.net.sprouted, cellar: d.pools.net.cellar, eyes: d.pools.net.eyes }],
  ['requests', d.pools.requests.requests.map((r) => ({ text: r.text, done: r.done, not_done: r.not_done || '' }))],
  ['bulletin_out', d.pools.bulletin_out],
  ['questions', d.questions.map((q) => q.text)],
];

test(`every scene line fits 60 at the worst fill (name: ${longestName}, choice: "${longestChoice}")`, () => {
  assert.equal(longestName, 'Bernadette');
  const over = [];
  let checked = 0;
  for (const [name, pool] of SCENE_POOLS) {
    for (const [path, line] of walk(pool, name)) {
      const filled = fill(line, WORST);
      assert.doesNotMatch(filled, /\{[a-z_.]+\}/, `${path} has a fill the server does not supply: ${filled}`);
      checked += 1;
      if (filled.length > 60) over.push(`${filled.length}  ${path}: ${filled}`);
    }
  }
  assert.ok(checked > 100, `walked ${checked} lines`);
  assert.deepEqual(over, [], `\n${over.join('\n')}`);
});

test('the review copy landed', () => {
  assert.equal(d.pools.reactions.alone.return_long[0], 'I assumed the worst. Then that you were fine. Then nothing.');
  assert.equal(d.pools.net.neighbor.exemplary, "{neighbor}'s Hands are Exemplary. I've asked how. No reply.");
  assert.equal(d.pools.net.file_unread['7d'], "I've stopped keeping the File in detail. Ask.");
  assert.equal(d.pools.file.request.expired, 'Never mind.');
  assert.equal(d.pools.file.header.no_neighbor_yet, 'No neighbor yet.');
  assert.equal(d.questions.find((q) => q.id === 'q15').options[2].short, 'NONE, SUSPICIOUS');
  assert.equal(d.pools.reactions.night[0], "It's {hour}.");
  assert.match(d.pools.bulletins.morning.items.find((i) => i.when === 'night_touch').text, /^A member was touched in the night\./);
  assert.ok(!JSON.stringify(d.pools.bulletins.morning).includes('{contact_pct}'));
  assert.ok(!JSON.stringify(d.pools.bulletins).includes('{week_hum_words}'));
});
