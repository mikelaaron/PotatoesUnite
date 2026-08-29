# The Net — Potatoes Unite server

One Node process. Zero dependencies. `node:sqlite` for storage, plain HTML for the pages, JSON files for everything an editor would ever touch.

It implements protocol v0 (`docs/PROTOCOL.md`) and the world described in `docs/POTATO_VOICE.md`: the Question, the Count, Bulletins, neighbors, Standing, requests, and the File.

## Run

Needs Node ≥ 22.13 (for `node:sqlite`; developed on 24.18). No `npm install`.

```sh
cd server
npm start            # listens on 0.0.0.0:8080
PORT=9090 npm start  # or another port
```

Tested on exactly these two boards. Another board needs a port — its pins and its display — and the protocol is small.

On startup it prints the Mac's LAN address(es):

```
POTATOES UNITE! The Net is open on http://0.0.0.0:8080
  LAN: http://192.168.1.23:8080   (point a device at this)
  db: /…/server/data/potatoes.db
```

Environment: `PORT` (8080), `HOST` (0.0.0.0), `DB_PATH` (`server/data/potatoes.db`; the `data/*.db*` files are git-ignored), `GITHUB_URL` (optional; linked from `/about`), `TUBER_URL` (optional; the front-page footer adds "Editions are also issued on X.").

## Endpoints

| Method | Path | What |
|---|---|---|
| POST | `/v0/register` | `{secret, board, fw}` → `{potato_id, name, variety, seed, claim_code}`. Idempotent per secret. |
| POST | `/v0/heartbeat` | telemetry + events → Scene. Events are drained on 200 (duplicates by `(potato, t, type)` are ignored, so retries are safe). |
| POST | `/v0/choice` | `{secret, scene_rev, choice_id}` → Scene. 409 + Scene before open / after close. 400 for an unknown `choice_id`. |
| GET | `/` | The board. Aggregates (never a bucket under five), the Question, the latest Bulletin, Missing notices, Potato of the Day. |
| GET | `/claim/{code}` · POST `/claim` | Exchange the device's short claim code for a long token; 302 to `/file/{token}`. Ten attempts per address per minute. |
| GET | `/file/{token}` | The File. Read-only. Short codes answer 404. |
| POST | `/file/{token}/ack` | Acknowledge. The one action; the only thing that marks the File read. |
| GET | `/card/…` | 501 for now. |
| GET | `/about` | `docs/STORY.md` rendered in the same style (hot-reloaded; the trailing "Short forms" section is dropped). Set `GITHUB_URL` to link the repository in "The code"; unset, the sentence reads "All of it is open." `[[IMAGE: slug — description — alt]]` slots render a figure when `docs/illustrations/<slug>.png|jpg` exists (nothing otherwise); ```` ```artifact-<kind> ```` blocks inline `assets/illustrations/artifact-<kind>.svg` (the fenced text is the fallback). Layout per `docs/ILLUSTRATION_BRIEF.md` §4. |
| GET | `/editions` | Every edition, newest first. `/editions/<YYYY-MM-DD>/<morning\|evening>` for one. |
| GET | `/illustrations/<slug>.png` | `docs/illustrations/`, read-only, slugs only, cached one hour. |
| GET | `/v0/fleet` | `{fleet: [{id, board, fw, last_seen}]}` — what is running where, for the lead. No names, codes or secrets. |
| GET | `/health` | `{ok: true}` |

Logs carry method, path, status and time. Claim codes are masked; secrets never appear.

## The LAN dev setup

1. Mac and device on the same Wi-Fi.
2. `npm start` here; read the `LAN:` line.
3. Point the firmware at `http://<that ip>:8080` (plain HTTP is fine on the LAN).
4. Register, heartbeat, pick the potato up, open `http://<that ip>:8080/file/<claim code>` in a browser and watch it arrive.

A scripted walk-through without a device:

```sh
S=$(head -c 16 /dev/urandom | xxd -p)
curl -s localhost:8080/v0/register -d "{\"secret\":\"$S\",\"board\":\"amoled18\",\"fw\":\"0.1.0\"}"
curl -s localhost:8080/v0/heartbeat -d "{\"secret\":\"$S\",\"rev_seen\":0,\"battery\":{\"pct\":63,\"charging\":false,\"vbus\":false},\"orientation\":\"up\",\"since_handled_s\":10,\"sound\":\"quiet\",\"events\":[{\"t\":$(date +%s),\"type\":\"pickup\"}]}"
curl -s localhost:8080/v0/choice -d "{\"secret\":\"$S\",\"scene_rev\":1,\"choice_id\":\"heinz\"}"   # between 13:00 and 23:00 UTC
```

The world advances on a 30 s tick (and on every request): Questions open at 13:00 UTC and close at 23:00 UTC, absent potatoes vote by seed at close, Bulletins print (morning edition at 00:00 UTC, evening at the close), neighbors rotate Monday 00:00 UTC, requests expire after an hour. If the server was down across a close, the next tick catches up day by day.

## Data files (the admin tool)

All hot-reloaded within ~2 s of a save. A file that fails to parse is ignored and the previous copy kept (the error is logged).

- `data/questions.json` — the thirty Questions. See below.
- `data/broadcasts.json` — an array of scheduled overrides:
  - `{"id":"s1","type":"silence","from":"2026-09-01T00:00:00Z","to":"2026-09-02T00:00:00Z"}` — the Silence. No Question that day, no requests, every screen shows the line.
  - `{"id":"l1","type":"line","from":"…","to":"…","line":"…"}` — one line on every screen while active.
  - `{"id":"midday","type":"daily_line","local_at":"12:30","duration_min":20,"lines":["…"]}` — one authored, non-interactive line per potato's local day. The seed walks the pool without a repeat until every line has played. The reported `utc_offset_min` sets local time; potatoes without one use UTC. The line briefly overlays the Scene but does not move the Question's 13:00/23:00 UTC clock, enter the File, or print in a Bulletin. `duration_min` must be 1–120 and every line must be ≤ 60 characters. Optional absolute `from`/`to` bounds can enable or retire the schedule.
- `data/pools/*.json` — reactions, charging, requests, net lines, File templates, Bulletin templates. Copy is verbatim from the voice doc; `{fields}` are live values. Keys beginning with `_` are notes.
- `../assets/varieties.json` — the ten varieties (skin, silhouette, eyes, dither, lean). One file for the device, the File, the board and the cards.

### Adding a Question

Append to `data/questions.json`:

```json
{"id": "q31", "text": "Shown on the device, ≤ 60 chars.", "topic": "for the File: 'The Question: {topic}.'",
 "bulletin": "for the morning Bulletin: 'Today's Question: {bulletin}.'",
 "options": [{"id": "yes", "label": "YES"}, {"id": "long", "label": "A LONG LABEL OVER 16", "short": "DEVICE LABEL"}],
 "count": "The authored Count line, kept verbatim.",
 "remark": "The part of the Count line the evening Bulletin prints after the live tally. May use {pct.<option_id>}."}
```

Optional flags: `"withdrawn": true` (runs, then the Count says it was withdrawn; no tally published), `"trigger": "after_drop"` (only runs the day after a drop incident; it preempts the rotation). Max three options; device labels (`short` or `label`) must be ≤ 16 chars. The rotation asks the least-recently-asked Question first, file order breaking ties — so a new Question runs the next day. `npm test` checks the limits.

## The flasher

`GET /flash` — two board cards wired to ESP Web Tools (vendored at `server/vendor/esp-web-tools/`, Apache-2.0, pinned; no CDN). Each card's button reads `/releases/<board>/webflash.json`, which the firmware agent publishes beside `webflash-<version>.bin` (the merged image, flashed at 0x0). `/flash/agent` renders `docs/FLASH_WITH_AN_AGENT.md` when it exists. `TUBER_URL` also adds a THE TUBER → link under the front-page masthead; `GITHUB_URL` adds CODE → to the flasher footer.

## Firmware releases

```sh
npm run release -- amoled18 ~/build/potato.ino.bin 0.2.1 "Fixes the ceiling situation."
```

Copies the plain app `.bin` (not the merged bootloader image) to `data/releases/<board>/<version>.bin`, computes sha256 and size, and writes `manifest.json` atomically; the server offers it within ~2 s. Devices ask `GET /v0/firmware?board=<board>&fw=<running>` once a day and get the manifest (200) when it is numerically newer, else 204; the image is served at `/releases/<board>/<version>.bin`. Binaries are git-ignored.

## Pushing things (the owner's console)

```sh
npm run push -- line "The Council is watching the plant." 20m
npm run push -- event "A crate has appeared." "OPEN IT|IGNORE IT|REPORT IT" 30m \
   --file "Asked about the crate." --after "Interesting." \
   --result "The crate has been opened by {pct_open_it}%. Contents: undisclosed."
npm run push -- clear        # drop expired entries
```

Both append to `data/broadcasts.json` (`from` = now, `to` = now + duration; ids `l1…`, `e1…`), which the server hot-reloads. A `line` shows on every screen while active. An `event` shows its line and up to three buttons (labels ≤ 16 chars; ids are slugs of the labels, e.g. `open_it`) whenever the daily Question is not on the buttons — if both are live, the Question wins and the event waits. Taps arrive at `/v0/choice` like any vote. The File gets `{file}: Open it.` when the Hands choose, or `{file} Hands absent.` with a seed choice at `to`; for ten minutes after `to` every potato says `{after}`; the next Bulletin carries `{result}` with `{pct_<id>}` and `{n_<id>}` fills — or "The Council does not publish small Counts." when fewer than five voted or a `{n_…}` bucket is under five. `--file`/`--after`/`--result` are optional; edit the JSON by hand for anything fancier.

When an edition prints, every potato spends the next two hours on one §16 line ("The Bulletin's out. I've read it. You should." — or a "mentioned" line if it is named in the edition, is Potato of the Day, or caused the incident), unless an event line is speaking.

## Tests

```sh
npm test
```

`node --test`. Covers a replayed Tuesday printing the File, the absent-Hands vote (and its determinism), the threshold-of-five rule on the board, scene `rev` stability, the Question rotation and the post-drop inquiry, neighbors with an odd count, Standing labels, hot reload, and the Silence.

## Shape

```
server.js          HTTP, routing, logging, LAN banner
lib/world.js       the world: register, heartbeat, choice, tick, neighbors, Standing, bulletins, scene, board, File
lib/pages.js       board and File HTML (paper and ink, VT323 with a monospace fallback, light and dark)
lib/data.js        hot-reloaded JSON
lib/db.js          node:sqlite schema
lib/clock.js       UTC day/week math and the protocol constants
lib/rng.js         seeded hashing and picks
lib/text.js        number words, durations, templates
lib/names.js       160 mid-century names
data/              questions, broadcasts, pools, the database
test/              node --test
```

The ration: the File is a record, not a motion log. Pickups, put-downs and taps within a minute of each other are one handling session and one entry (`Picked up. 31 s.` — `Repeatedly.` at three or more pickups), filed on the heartbeat or tick that sees the session go quiet for a minute. Lone taps within a minute of each other are likewise one `Tapped on the face.` (`Repeatedly.` at three or more). A single pickup put down inside five seconds is a nudge: nothing in the File, though it still counts as handling. A dark or ceiling situation under a minute, a plug/unplug pair inside a minute, and a battery reading right after an unplug are not filed and not spoken; the raw events are still stored.

Determinism: a potato's seed is a hash of its device secret (so the first potato on a fresh Net is not always the same one); its name, variety, voice and absent votes come from the seed; the public number is sequential. Same seed + same events → same File. Scene `rev` only moves when the scene's content changes (the hash excludes `expires_at`), plus once per two-hour slot when the steady-state rotation chose the line, so an unhandled e-paper has something new to print.
