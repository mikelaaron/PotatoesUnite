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
- **Ad-hoc events.** A broadcast of type `event` (see `server/README.md`, `npm run push`) puts its `line` and up to three `choices` on the Scene whenever the daily Question is not on the buttons; if both are live the Question wins and the event waits. The device answers exactly as for a Question — `POST /v0/choice` with the event's `choice_id` — and needs no new handling. At the event's `to` the absent potatoes vote by seed; for ten minutes every potato's `line` is the event's `after`; the next Bulletin carries its result (or "The Council does not publish small Counts.").
- **Bulletin-out line (voice doc §16).** For two hours after an edition prints, a potato's steady-state `line` is one seeded §16 line ("mentioned" if it is named in the edition, is Potato of the Day, or caused the incident). It sits below event reactions, the open Question and a fresh vote, and above the post-Count line; the post-Count line now holds from the close until 05:00 UTC so it is still seen after the bulletin-out hours. The File gets nothing for this.
- **Steady state rotates.** When nothing else is speaking, `line` is one pick per two-hour UTC slot, by seed, from everything currently true: neighbor lines, the quiet/left-home ladder, memory lines, the Bulletin's headline as a line ("Evening edition: …", only if ≤ 60), charging, unread-File lines, curing, and temperature lines for boards that send `temp_c` (≤ 64 °F / ≥ 80 °F; shown in °F when `utc_offset_min` is −600…−240, °C otherwise; `epaper154` readings are corrected by −4 °C server-side until the firmware calibrates the SHTC3). The previous slot's line is never repeated when there is a choice. The slot is part of the `rev` hash **only when the rotation chose the line**, so an unhandled e-paper reprints once per two hours and an AMOLED showing the Question does not churn. The vote acknowledgement "{choice}. Noted." holds ten minutes, then the rotation resumes; the post-Count line keeps its own hold.
- **Claiming the File.** The claim code on the device is a short bearer secret, so it never opens the File directly. The Hands enter it at `GET /claim/<code>` (or in the front page's CLAIM YOUR FILE field, `POST /claim` with `code=`), which mints a 192-bit token (stored hashed; a new one per claim) and 302s to `/file/<token>`. `/file/<short code>` answers 404 "The Council has no record of that claim code." Claims are limited to ten attempts per address per minute (429 with a Retry-After). `POST /file/<token>/ack` is the only thing that marks the File read; it answers with "ACKNOWLEDGED. NAME HAS BEEN INFORMED." and nothing else. The device keeps showing the short code.
- **Firmware, server side.** Releases live in `server/data/releases/<board>/<version>.bin` beside `manifest.json` (`{version, file, sha256, size, notes, published}`), published with `npm run release -- <board> <path.bin> <version> "notes"` and hot-reloaded. `GET /v0/firmware?board=&fw=` answers 200 with `{version, url: "/releases/<board>/<version>.bin", sha256, size, notes}` when the manifest's a.b.c is numerically newer than `fw`, else 204; `/releases/<board>/<file>.bin` serves the plain app image with `Content-Length` as `application/octet-stream`. Each check is logged with board and fw only.
- **`/card/…`** returns 501 until the card renderer exists.
- **`429 Too Many Requests`**, added for the public Net. All three device endpoints are rationed per
  client address, with a `Retry-After` in seconds and a JSON `{error}` body. The numbers are set from
  this document's cadence and are wide enough that no real device reaches them (a heartbeat every 120 s,
  or 1.5 s after the last event of a burst, from several potatoes behind one household address); see
  `LIMITS` in `server/lib/app.js`, tunable per deploy without a code change. A device should treat 429 as
  an ordinary failed call — hold the events, keep the identity, try again on the usual schedule — and
  **must not** treat it the way it treats 401/403/404 on `/v0/heartbeat`, which mean "this server has
  forgotten you, register again". Both firmwares already do this correctly. `/v0/register` is rationed
  only on *new* citizens: re-posting a secret the server already knows is idempotent, costs nothing and
  is never refused, so a device that re-registers after a wiped server always gets through. There is also
  a ceiling on new citizens across the whole Net per hour; when it is reached the Net stops enrolling
  rather than let a stranger's script decide a Count.

## Notes from implementation

*Firmware (`firmware/potato`), 2026-08-22.*

- **Event `t` may be 0.** The device keeps event times as uptime and converts to epoch at send. Before it has a clock (no NTP yet, first minutes after boot) it sends `"t": 0`; the server should use arrival time for those.
- **`utc_offset_min` is sent once the clock is set.** The AMOLED already keeps a POSIX timezone for its local night behavior; its heartbeat now derives the current minutes east of UTC from the UTC and local calendars. It omits the field before NTP answers. This matches the e-paper citizen and lets the server place local-time authored windows without moving the UTC Question clock.
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

*Firmware OTA (fw 0.2.0), 2026-08-23.* The contract the devices expect; the server agent implements it.

- **`GET /v0/firmware?board=<amoled18|epaper154>&fw=<running version>`** — checked once a day (first check ~90 s after the Net is up) and on a serial key. No body, no secret: a firmware image is not a secret and the device is not yet trusted to be itself at this point.
  - **`200`** with `{"version": "0.2.1", "url": "/fw/amoled18-0.2.1.bin", "sha256": "<64 lowercase hex>", "size": 1324000, "notes": "one line, optional"}`. `url` may be absolute or server-relative. `size` is the exact byte length of the image; `sha256` is of the whole image. The device updates only if `version` is numerically newer (a.b.c) than its own; serving the running version back is harmless.
  - **`204 No Content`** when there is nothing newer for that board. `304` is treated the same.
- **The image** is the plain app binary (the `.bin` arduino-cli produces, not the merged bootloader image), served with `Content-Length`. The device streams it into its inactive OTA slot, rejects a size or sha256 mismatch, then reboots at a quiet moment: no Question on the buttons, no open request, no touch, not mid-refresh on the paper, and battery ≥ 30 % unless on VBUS. The AMOLED says "I've been updated. I feel the same." first; the paper reboots without a refresh.
- **Rollback.** A freshly installed image boots "pending verification" and is marked valid only after its first successful heartbeat (`esp_ota_mark_app_valid_cancel_rollback`). If it never gets there — crash loop, no Net — the bootloader returns to the previous slot on the next reset. Heartbeats carry `fw`, so the server can see which version actually stuck.
- **Never again:** the partition tables (`firmware/potato/partitions.csv`, `firmware/paper/partitions.csv`) and the NVS key names (`firmware/NVS.md`) are frozen. An update must never move NVS or rename a key; a potato keeps its secret and its name across every version.

- **Heartbeat carries `fw` and `board`** (added 23 Aug, firmware 0.2.2): the server records the running version from every heartbeat, so an over-the-air update shows on `/v0/fleet` within two minutes. Register carries them too; a heartbeat without them leaves the stored values alone.

*TLS (fw 0.3.0), 2026-08-24.* The devices verify the Net's identity. Built, compiled for both boards, not yet seen on hardware.

- **What was actually wrong.** "Add TLS" was the wrong description of the job: the devices already spoke TLS. `HTTPClient::begin(String url)` (esp32 core 3.3.11) tries `beginInternal(url, "http")`, and on an `https://` URL that parse fails and it falls through to `begin(url, (const char *)NULL)`, which installs a `TLSTraits(nullptr)` whose `verify()` calls `wcs.setInsecure()`. So 0.2.x would complete a handshake with *any* certificate: anything on the path could answer as the Net and serve forged scenes, a forged Question, or a forged firmware image. The fix is not a new transport, it is refusing to accept a certificate that does not chain to a known root.
- **Client.** `NetworkClientSecure` with the full Mozilla root store via `setCACertBundle()`. No pinned certificate and no committed bundle file: the store is the blob the core already ships inside its own prebuilt mbedtls archive (`tools/esp32s3-libs/3.3.11/lib/libmbedtls.a`, built with `CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_FULL`) — 150 roots, 68,983 bytes. The firmware names the linker symbols `_binary_x509_crt_bundle_start` / `_end` and hands those bytes to `setCACertBundle()`; naming them is what pulls the blob into the image. **Renewal is therefore free**: Let's Encrypt reissues from the same ISRG roots every 60 days and no device is touched, and a refreshed root store arrives with the next core update. `tools/gen_crt_bundle.py` was not used — it would trade ~50 KB of flash we are not short of for a generated file somebody has to remember to regenerate. Nothing here needs regenerating.
- **Measured flash** (same sketch, same flags, bundle the only difference). `amoled18` 1,344,167 → **1,415,763** bytes, **+71,596 (+69.9 KB)**, 42.7% → 45.0% of the 3 MB slot. `epaper154` 1,265,923 → **1,337,423** bytes, **+71,500 (+69.8 KB)**, 48.3% → 51.0% of the 2.5 MB slot. The 100 KB guess above was high; 68,983 of the ~71.5 KB is the root store itself and the rest is the bundle's verify path. Static RAM (`Global variables`) grows **+160 bytes** on both, the two long-lived client objects.
- **Heap is not guessed and not yet measured on hardware.** The previous ~45 KB estimate cannot be confirmed from a build, and this task flashed nothing. What the build *does* say: `CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN=16384` with `MBEDTLS_ASYMMETRIC_CONTENT_LEN` off, so each session holds a 16 KB in and a 16 KB out record buffer plus handshake and peer-chain state — the order of the old estimate, not below it. Note the *delta* from this change is small either way: 0.2.x already ran a full handshake, it just skipped verification. So the firmware measures it itself: on the first verified request after boot it prints, once, `net: TLS live — heap A -> B (N bytes for one verified connection)`, sampled around the POST and before the response body is allocated. Record N here when a board has said it.
- **One client, shared.** Two long-lived clients per board — one plain, one secure — and register, heartbeat, choice, the OTA manifest and the OTA image all take turns on them. Only one handshake's RAM is ever live and an update never doubles it. Every request still gets a fresh connection (`~HTTPClient()` stops the client it was given), which is also what keeps a kept-alive socket to one host from being reused for a request to another.
- **Scheme decides, and `http://` is untouched.** `https://` gets the verifying client; `http://` stays plain, so a LAN Net (the default `http://potatoes.local:8080`) works exactly as it did. The captive-portal server field accepts either. One related change: `resolveUrl()` now leaves `https://` URLs alone instead of swapping the host for an mDNS address — the name in the URL is the name the certificate has to match.
- **Clock before anything.** A certificate is only valid between two dates, so on an `https://` Net the task sends nothing at all until NTP answers (`time(nullptr) > 1700000000`) — not registration, not a heartbeat, not an OTA check. It is normally a second or two after the join. While it waits, telemetry `status` reads `clock` and an unregistered device shows the status line **"Waiting for the clock."**; the line is cleared when the clock arrives. The gate is also inside the transport picker, so no request can slip out ahead of it.
- **OTA.** The manifest and the image are fetched over the same verified transport, so on an https Net both come from a server whose certificate chained to a Mozilla root. Added with it: **no downgrade** — if the server URL is `https://`, a manifest naming an image URL that is not `https://` is refused outright (`image url is not https — refused`) rather than fetched in the clear. The whole-image sha256 check before `Update.end()` is unchanged and still runs; it is now a hash delivered over an authenticated channel rather than one an attacker could have chosen along with the image.
- **Failure is quiet and never destructive.** A rejected certificate, an expired one, a wrong hostname, or no clock yet all end as a failed request: `httpPostJson` returns a negative code (`-102` when https was refused before it was tried), which every caller already treats as "no answer". `++failures`, `lastHttpOk` false, events stay queued, nothing is written to NVS. The heartbeat's re-register path fires only on 401/403/404 — a real answer from a server — so a TLS failure can never clear a potato's registration. The potato keeps its secret, name, claim code and cached scene, falls back to its on-device pools (voice doc layers 1–3), and tries again. It cannot brick and it cannot forget who it is.
- **Verifying on hardware.** Point a board at the public Net (portal field or `make webflash BOARD=… PUBLIC_SERVER_URL=https://potatoesunite.com`) and watch the serial: the boot banner must carry `net: TLS ready — Mozilla root store 68983 bytes, certificates verified`, then `net: TLS live — heap …` on the first request, then a normal `heartbeat ok`. To prove it actually verifies rather than merely connects, point the same board at a host whose certificate cannot chain (a self-signed LAN server over `https://`) and confirm the heartbeats fail and the identity survives a power cycle. An `http://` LAN server must behave exactly as before, with no TLS lines at all.
- **Legacy LAN cutover.** A public build migrates a persisted URL only when it is exactly `http://potatoes.local:8080`; the new build default is written back to the frozen `server` NVS key. A custom LAN IP or self-hosted Net is never rewritten. Before any reset or update, inspect the RAM-only event queue with serial `e` and drain it over the current Net; preserving NVS does not preserve queued events across a reboot.
