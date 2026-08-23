# Potato Net Protocol — v0

The device is a thin client. The server owns the world. JSON over HTTPS (plain HTTP allowed on LAN for dev). All device calls POST with `{"secret": "<hex>"}` in the body; the secret is generated on first boot (16 random bytes), stored in NVS, and never shown.

## Identity

`POST /v0/register` `{secret, board: "amoled18" | "epaper154", fw: "0.1.0"}`
→ `{potato_id: "0417", name: "Doreen", variety: "russet", seed: 123456789, claim_code: "BRK-7H2"}`

Idempotent: same secret returns the same potato. Name and variety are assigned by the server from the seed. The claim code is shown once on the device (and again on long-press of the face); it opens the File at `/file/BRK-7H2`.

## Heartbeat

Every 120 s, and immediately after any event. Carries what the device knows; gets back what to show.

```json
POST /v0/heartbeat
{
  "secret": "…",
  "rev_seen": 42,
  "battery": {"pct": 63, "charging": true, "vbus": true},
  "orientation": "up" | "down" | "side" | "inverted",
  "since_handled_s": 14400,
  "sound": "quiet" | "normal" | "loud",
  "temp_c": 21.5,
  "events": [
    {"t": 1756000000, "type": "pickup"},
    {"t": 1756000004, "type": "facedown_end", "dur_s": 17100}
  ]
}
```

`temp_c` only from boards that have a sensor. Events are drained on a 200 response. Event types:

`pickup` `putdown` `facedown_start` `facedown_end(dur_s)` `inverted_start` `inverted_end(dur_s)` `shake` `drop` `tap` `transit_start` `transit_end(dur_s)` `charge_start` `charge_end` `battery_low(pct)` `dormant_resume(dur_s)` `wifi_restore(dur_s)` `loud` `request_done(request_id)` `request_expired(request_id)`

The device is the judge of what happened (it has the sensors and the lessons). The server only counts.

## Scene

Returned by heartbeat and by choice. The device renders what it can.

```json
{
  "rev": 43,
  "expression": "neutral" | "waiting" | "aggrieved" | "pleased" | "asleep" | "dormant" | "sprouted",
  "line": "You weren't here. I voted Hunt's. It's in the File.",
  "choices": [{"id": "heinz", "label": "HEINZ"}, {"id": "hunts", "label": "HUNT'S"}, {"id": "whatever", "label": "WHATEVER'S THERE"}],
  "cue": "none" | "throat_clear" | "incident" | "silence",
  "expires_at": 1756036800,
  "file_unread": 3,
  "request": {"id": "r81", "text": "Put me on my side for one minute.", "check": "orientation:side", "for_s": 60, "expires_at": 1756003600},
  "bulletin": {"no": 4, "edition": "evening", "headline": "AN INQUIRY, 9 TO 5 TO 3.", "items": ["The inquiry has concluded. Findings: it was dropped.", "…"]}
}
```

Rules:
- If `rev` equals `rev_seen`, the device keeps showing what it has. On-device reactions (layers 1–3) always take priority for ~8 s after they fire, then the scene line returns.
- `choices` present ⇒ show buttons. Empty ⇒ no buttons. Max three. Labels ≤ 16 chars.
- `request.check` is one of `orientation:side|down|up|inverted`, `still:<s>`, `held:<s>`, `transit`, `tap` (a DONE button). The device verifies and sends `request_done` or `request_expired`.
- `line` ≤ 60 chars. The e-paper shows `bulletin.headline` and the first two `items`; the AMOLED shows `line`.
- Scene is cached in NVS. With no network the device shows the cached scene and its own pools.

## Choice

`POST /v0/choice` `{secret, scene_rev, choice_id}` → Scene. Late (after `expires_at`) → 409 and a Scene saying so.

## Public

- `GET /` — the board. Aggregates (min 5), the Count, the Bulletin, today's Question. No names except Potato of the Day and Missing notices, which are pseudonyms.
- `GET /file/{claim_code}` — the File. Read-only. One `POST /file/{claim_code}/ack`.
- `GET /card/{kind}/{id}.png` — social cards for The Tuber (bulletin, count, potd, missing, incident).

## Admin (v1: files, not UI)

`server/data/questions.json`, `server/data/broadcasts.json`, `server/data/pools/*.json`, `assets/varieties.json`. Hot-reloaded. Basic-auth `/admin` can come later.

## Constants

Question opens 13:00 UTC, closes 23:00 UTC. Bulletins 07:30 and 18:30 *local* (device knows its offset; server sends both editions, device picks). Neighbors rotate Monday 00:00 UTC. Dormant = no heartbeat for 6 h. Missing = no heartbeat for 72 h. Sprouted = no handling event for 7 days.

## Notes from implementation

Clarifications from building `server/` against the contract above. Nothing here removes or changes a field; everything is additive or a resolution of something the text left open.

- **Identity.** `seed` is a hash of the device secret (31-bit), so the same device always becomes the same potato and the first potato on a fresh Net is not always the same one; `potato_id` is the sequential public number. Name and variety derive from the seed with separate salts, so no name is pinned to one variety.
- **Heartbeat, optional `utc_offset_min`.** The File and its day headers render in the device's local time if the heartbeat carries `"utc_offset_min": -240` (minutes east of UTC, clamped to ±840). Absent, the File says "Times are UTC." The Question's open/close stay UTC regardless.
- **Choice labels over 16 chars.** Seven of the thirty Questions have an authored option label longer than 16 characters (e.g. `NO CAT, WHICH IS ALSO SUSPICIOUS`). `questions.json` keeps the label verbatim for the board and the Bulletin and adds a `short` device label; the Scene's `choices[].label` is `short ?? label`, always ≤ 16. `choices[].id` is what `/v0/choice` wants back.
- **Line selection.** Events carried by a heartbeat outrank steady state. Among them the most severe speaks: `drop` > `facedown_end` (≥ 1 h) > `inverted_end` (≥ 20 min) > `shake` > `dormant_resume` > `facedown_end`/`inverted_end` (shorter) > `transit_end` > `wifi_restore` > `loud` > `pickup`/`putdown`/`tap` > `charge_start`/`charge_end`/`battery_low`. A major reaction (shake and above) holds `line` for ten minutes and outranks the open Question; a minor one for two minutes and sits below it. `expression` follows the winning line. Steady-state lines (charging, quiet, left home, memory, the neighbor) appear only when no event is speaking. A fresh lesser event does not displace a major one still within its window.
- **Scene `line` ≤ 60.** Guaranteed by test: every pool line fits at its worst-case fill (longest name, longest short label, longest duration words); `{choice}` in a scene line is the device's short label said back, so the potato repeats the button it showed. Enforced server-side as a last resort. A few pool lines run longer; the server sends the longest run of whole sentences that fits rather than truncating mid-word. `line` may be `""` (nothing to say; show the face).
- **`request` and `bulletin` are `null` when absent**, not omitted. `bulletin` is the latest printed edition. A sibling `bulletins: {morning, evening}` carries both of today's editions (either may be `null`) so a device that knows its offset can pick. The morning edition prints at 00:00 UTC (it announces the day's Question); the evening edition prints at the close, 23:00 UTC, with the Count. Bulletin `no` counts days since the Net opened.
- **`rev`** is a content hash of `{expression, line, choices, cue, file_unread, request, bulletin, bulletins}`; `expires_at` is excluded, so a scene that merely got a new expiry keeps its `rev`. A 409 Scene from a late or early `/v0/choice` never bumps `rev`.
- **`/v0/choice` outcomes.** 200 + Scene on success (re-tapping before the close changes the vote). 409 + Scene before 13:00 UTC, after 23:00 UTC, on a Silence day, or when the day's Question has no options. 400 for an unknown `choice_id`. A `scene_rev` that doesn't match the current rev is accepted and logged, not rejected.
- **"Tell me one thing. [YES] [NO]".** While that request is open the Scene's `choices` are `[{id:"yes"},{id:"no"}]`; the device answers with `/v0/choice` (which counts as `request_done`) or with a `request_done` event. It is only issued outside the Question window, so Question and request buttons never collide.
- **"Stand me up."** checks `orientation:side` for 30 s (the protocol has no separate "standing" orientation).
- **The ration (voice doc §15, server side).** The File is a record, not a motion log. `pickup`/`putdown`/`tap` within 60 s of each other form one handling session, filed as one entry when the session has been quiet for 60 s — `Picked up. 31 s.` (first pickup to last putdown; no duration if it was never put down), note `Repeatedly.` at three or more pickups. Taps inside a session fold in; a lone tap is filed as itself. `facedown_end`/`inverted_end` under 60 s file nothing, cost nothing and say nothing (`Placed in the dark.` is only filed once the dark has lasted a minute). `charge_start`/`charge_end` are held for 60 s; an opposite event inside that minute cancels both. `battery_low` within 60 s of a `charge_end` is dropped. Raw events are stored regardless. The reaction line only considers events the ration accepted, so a pickup 20 s after another does not refresh it. Quiet/left-home lines and the idle thresholds key off the end of the last session (server-side), not the device's `since_handled_s`, which is used only before the server has seen any handling. Session entries appear on the heartbeat or tick that observes the close, so up to a heartbeat late.
- **Event timestamps.** An event whose `t` is before 2001 or more than five minutes in the future is stamped with server time (ESP clocks boot in 1970). Events are keyed `(potato, t, type)`; a retried heartbeat can't double-file.
- **Absent Hands at the close.** The seed picks (`h32(seed, question_id, day) % options`); the File records `The Question closed. Hands absent.` with the note `You weren't here. I chose X.`; the Scene line for the next three hours is one of the §7 "voted alone" lines.
- **Neighbors.** Full random re-pairing Monday 00:00 UTC among potatoes heard from in the last 72 h. Potatoes that register mid-week are paired with each other (or with the odd one out) on the next tick so a two-desk dev Net has neighbors immediately. An odd count leaves one potato with `No neighbor this week. The count was odd.` in its File.
- **Standing** is five labels, never a number: `Exemplary · Reasonable · Under Review · Provisional · Not Discussed`. A potato under two days old is `Provisional`. The formula is not documented on purpose.
- **Under-five rule on the board.** Population, every aggregate, and every tally bucket under five show "fewer than five". With fewer than five members the board withholds all aggregates, Missing notices and Potato of the Day. The evening headline uses the `OPTION N, OPTION M.` form only when every bucket is ≥ 5; otherwise `"WINNER," NN%.`
- **Incident day.** A drop on day D schedules the inquiry Question (`trigger: "after_drop"`) for D+1 and the D+1 morning Bulletin leads with `INCIDENT.`; day D's Question is not suspended.
- **Gaps.** A heartbeat after more than 6 h of silence with no `dormant_resume`/`wifi_restore` event files `Unheard from. 7h 2m. — Presumed resting.`
- **`/card/…`** returns 501 until the card renderer exists.

## Notes from implementation

*Firmware (`firmware/potato`), 2026-08-22.*

- **Event `t` may be 0.** The device keeps event times as uptime and converts to epoch at send. Before it has a clock (no NTP yet, first minutes after boot) it sends `"t": 0`; the server should use arrival time for those.
- **Orientation, as the AMOLED judges it** (screen +y is down): `down` = face down (az > 0.72); `inverted` = standing on its top edge (in-plane gravity > 0.6 g pointing up the screen); `side` = standing on a long edge (in-plane gravity mostly along x); `up` = everything else, i.e. flat face-up or standing upright. A request with `orientation:up` is therefore satisfied by a potato lying flat.
- **`sound` is `"quiet"` on `amoled18` for now.** The ES8311 mic path is not wired; the field is present so the schema is stable.
- **`cue: throat_clear` is accepted and skipped** on `amoled18` (no audio path). `incident` widens the eyes for four seconds. `silence` does nothing on the device.
- **Requests with `check: tap`** add a `DONE` button; pressing it sends `request_done` as an event, not a `/v0/choice`. `request_id` travels as the string from the scene (`"r81"`). `orientation:*`, `still:<s>`, `held:<s>` and `transit` are verified on the device for `for_s` seconds (or the seconds in the check); `request_expired` is sent when `expires_at` passes unmet.
- **Heartbeat timing.** Every 120 s, and 1.5 s after the last event in a burst (pickup followed by putdown is one heartbeat, not two). Events are held through failed heartbeats and drained only on a 200; the queue keeps the newest 32.
- **`temp_c` is omitted** (no sensor on `amoled18`).
- **`/v0/choice` 409** is treated like 200: the returned Scene is rendered.
- **Server URL.** Default `http://potatoes.local:8080`; `.local` is resolved by mDNS query from the device, so the server host should advertise itself (or the Hands set an IP URL in the portal).

*Firmware ration (§15), 2026-08-22.*

- **`facedown_start`/`facedown_end` are sent only for episodes of 60 s or more.** A flip in the hand (face-down under a minute) produces neither. The device already applies the voice-doc ration; the server still coalesces whatever arrives.
- **`charge_start`/`charge_end` are sent only after 60 s continuously in the new VBUS state**, so a cable that loses contact briefly in the hand is not an event. `battery_low` fires only while VBUS has been stably absent that long. `pickup`/`putdown`/`tap`/`shake`/etc. are still sent as they happen; the server is expected to coalesce a burst into one session.

*Firmware (`firmware/paper`, the e-paper press), 2026-08-23.*

- **Board `epaper154` sends `temp_c`** (SHTC3, raw minus the 4 °C board-heat offset the vendor example applies, one decimal) and **`utc_offset_min`** (from its POSIX TZ, once the clock is set from the RTC or NTP). `sound` is `"quiet"`: the ES8311 mic path is not wired. `orientation` is always `"up"`; it has no IMU. The only physical event is `tap`, from a short BOOT press; `since_handled_s` counts from the last BOOT press.
- **`battery.charging` / `vbus` are inferred** on this board. The ETA6098's STAT pin drives an LED and no GPIO, so `vbus` is "a USB host is on the CDC, or the cell reads ≥ 4.15 V", and `charging` is `vbus` under 100 %. `pct` is from a LiPo open-circuit curve over the GP4 divider (×2).
- **The Bulletin is parsed, not printed.** The press reads `bulletin` and `bulletins.{morning,evening}` (`no`, `edition`, `headline`, first two `items`) but the page is the potato, not a newspaper; a headline reaches the paper only if the server sends it as `line`. Kept in the parser so a later edition page costs nothing on the wire.
- **The Question on paper.** With `choices` present the options print numbered 1..3 under the `line` in the same refresh. The vote is N BOOT presses within two seconds; two seconds after the last press the press sends `/v0/choice {scene_rev, choice_id}` for option N, waits up to 3 s for the Scene it returns, and prints once. A 409 Scene is rendered like a 200. The confirmed option is remembered by `id` and printed as an inverted row for as long as the same `choices` come back; a Scene without `choices` (what the server returns after a vote) shows its `line` instead.
- **Refresh is rationed on the device**, not by the protocol: the panel refreshes only when the rendered page would change, at most once per 60 s, not 23:00–06:00 local unless the `line` changed, and never while Wi-Fi is joining. The server should not expect a Scene to be visible sooner than a minute after it changes, except after a key press. A full refresh is 14–21 s (longer with more red ink).
- **Scene size.** A Scene with `bulletin` plus both editions runs to a few KB; the press parses up to 4 KB and caches in NVS only under ~3.9 KB (the NVS string limit). Keep Bulletin items short.

- **`battery.pct` is `null` when the battery is unknown** (the AXP2101 was not found; the device re-probes it every 60 s). The field itself is always present; `charging` is `false` and `vbus` is the USB-host fallback in that state.
