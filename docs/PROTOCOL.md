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
