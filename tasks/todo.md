# Potatoes Unite — plan

Hacker project. Days, not months. The device is the conduit; the Net is the product.
(Codex's earlier launch plan and its review are preserved in git history at the baseline commit.)

## Done
- [x] Concept brief (ChatGPT), Codex landing-page prototype (parked in `site/`).
- [x] Voice doc: worldview, daily texture, reactions, requests, Questions, Bulletins, File, charging, vocabulary, varieties, the forgot-to-check engine — `docs/POTATO_VOICE.md`.
- [x] Protocol v0 — `docs/PROTOCOL.md`. Press office — `docs/THE_TUBER.md`.
- [x] Project rules (`CLAUDE.md`) and team agents (`.claude/agents/`: creative, art, press, firmware, server).
- [x] Root git repo, Time Machine protection, Codex site history tagged `codex-site-prototype`.
- [x] Confirmed: AMOLED-1.8 V2 on `/dev/cu.usbmodem2101`; working base firmware at `~/Developer/ESP32-S3/firmware/creature`.

## Now
- [x] `server/` — one Node process, zero deps (`node:sqlite`), protocol v0, the board, the File, 30 Questions + pools as data, 19 tests. `cd server && npm start` prints the LAN URL for the device.
- [x] `firmware/potato` — fork of creature: lying-down potato per art spec, text line + up to three touch buttons, captive-portal Wi-Fi (AP POTATO-xxxx), protocol v0 (register/heartbeat/scene/choice, NVS identity + cached scene), IMU events, AXP2101 battery. Flashed and verified over serial; 41% of flash, 55 fps.
- [x] Live: both talking on the LAN (22 Aug night). Doreen #0001 registered, heartbeats, File fills. Ration applied on both sides after the first handling session; copy review applied; local times on the Net and the File; status card on long-press; charge current 150 mA for the 400 mAh cell.

## 29 Aug — traction, Doreen health, and more daily delight

- [x] Verify Doreen on USB at 2%: VBUS/charging state, battery voltage, Wi-Fi association, configured Net URL, heartbeat result, firmware version, and doze diagnostics.
- [x] Separate low-battery behavior from the reported `Net unreachable` state with a reproducible serial/HTTP check.
- [x] Investigate battery drain from measurements and the current power/doze implementation; produce a ranked root-cause finding before changing firmware.
  - [x] Trace the AMOLED power path: awake is 240 MHz/60 fps with Wi-Fi and high-rate IMU; the panel goes dark after 150 s only off VBUS; doze begins after 30 min (5 min at night), never on VBUS; unwired IMU INT requires a 120 ms wake-and-I2C poll.
  - [x] Add read-only serial evidence: `i` now reports exact last HTTP code/attempt age; `P` reports AXP2101 battery, VBUS/system rails, input-current limiting and charger state. Initial Wi-Fi association now says `Net: checking`, not the false `Net: unreachable` before any HTTP attempt.
  - [x] Add and smoke-test `firmware/tools/watch_battery.sh`, which records battery slope and heartbeat age from the local SQLite WAL without opening/resetting the USB device.
  - [x] Verify the diagnostic build (`make -C firmware build`) and host protocol test. No hardware flash or current measurement was performed in this lane.
  - [ ] Measure awake-battery, awake-USB and forced-doze current at the USB/cell rail; one overnight percentage alone cannot validate the 2.5-4 mA estimate.
- [x] Audit the 30 daily Questions for variety and staying power under the voice rules — `docs/DAILY_DELIGHT_AUDIT.md`.
- [x] Design the smallest protocol-compatible midday surprise: authored, non-quiz, no human typing, no AI, and no new product machinery.
  - [x] Heartbeat seam spec: a hot-reloaded `daily_line` gives each potato one seeded authored line during a bounded local-time window; it has no choices or File/Bulletin entry, and the Question still opens/closes at 13:00/23:00 UTC.
- [x] Implement and verify only changes supported by the findings above.

### Review

Complete for this pass. Battery lane: 2% is not an input to the `Net unreachable` decision;
that card means Wi-Fi is associated and the last register/heartbeat/choice did
not receive an HTTP answer. A critically low cell can still cause an
indirect brownout or RF instability off VBUS, but that requires voltage/reset
evidence. The immediate incident was the saved LAN Net at `10.0.0.245:8080`
not running; after it started, Doreen drained 27 queued events on a 200 response.
Live DB evidence on 29 Aug showed firmware 0.3.0 rising from the reported 2%
to 15% by 18:42, with `charging=1`, `vbus=1` and fresh heartbeats; charging and
the Net were both functioning. Do not raise
the 150 mA charge setting for the 400 mAh cell; first use
the new PMU report and external current measurement to distinguish weak VBUS,
input-current limiting, normal pre/constant-current recovery, failed doze entry,
and an optimistic 120 ms polled-doze estimate.

Midday server lane: `daily_line` schedules now hot-reload from
`broadcasts.json`, rotate an authored pool deterministically by seed and local
day, and use the existing Scene without a new Scene or endpoint. AMOLED
heartbeats now send the protocol's existing optional `utc_offset_min` after the
clock is set, so a future versioned OTA can honor actual local midday. No
production schedule or copy was enabled. The new boundary, rotation, and offset
tests pass, as does the full server suite (86/86).

Daily delight audit: 29 ordinary days before the first repeat; enough for the
launch week, not the second month. Recommended a three-in-seven, no-choice
trial with no File or Standing effect.

## 29 Aug — weekly editorial system

- [x] Build a plainspoken device-line bank weighted toward true neighbor news,
  outside/the window, the county, the world, the warm machine, and quiet desk life;
  add no food lines.
- [x] Build a Tuber topic queue that can become one or two restrained posts a week
  without pretending the Net is larger or busier than it is.
- [x] Define a repeatable weekly packet: three device lines, two Tuber topics, one
  Question seed, and a short voice/canon check. Draft only; never auto-publish.
- [x] Schedule a weekly Codex heartbeat to prepare that packet for review.

### Review

Complete. `docs/MIDDAY_LINE_BANK.md` contains 65 verified device lines in 13
truth-gated pools: 25 neighbor lines, no food or weather lines, and plain
outside/window and desk-life material. A 16-character neighbor and six-digit
Net count render the longest line at 57 characters; none exceeds 60.

`docs/TUBER_TOPIC_QUEUE.md` contains 28 durable truth-gated topic seeds, ten
short draft structures, and five immediate drafts based on this week's
owner-reported traction and Doreen incident. The cadence is one anchor post and
one optional post per week; a quiet second slot stays empty.

The active `Potatoes Unite weekly editorial packet` heartbeat runs Mondays at
09:00 local time in this task. It drafts three device lines, two Tuber topics,
and one Question seed for review. It is explicitly barred from publishing,
deploying, or editing the live broadcast schedule.

## 29 Aug — approved midday release slice

- [x] Add a red heartbeat-seam test for a local-time midday line on exactly
  three nonconsecutive weekdays, with the Question returning outside the window.
- [x] Make the approved 12-line pool live without ever showing an unresolved
  `{neighbor}` token or a neighbor claim that the Net cannot support.
- [x] Verify deterministic selection, the ten-minute display window, truth
  gates, and the complete server suite.
- [x] Cut an AMOLED 0.3.1 OTA containing `utc_offset_min` and the new power/Net
  diagnostics; verify build, binary hash, and firmware manifest.
- [x] Exercise the real heartbeat and OTA path on Doreen while she is on USB.
- [x] Release the proven scheduler and OTA, then record live evidence here.

### Release hold

The user approved the 12 selected lines and this complete release slice on
29 Aug. No social post is part of this release, and the weekly editorial
automation remains draft-only.

### Review

Server: the full suite passes 96/96. The active schedule is Tuesday, Thursday
and Saturday at 12:30 device-local time for ten minutes. Conditional lines use
recorded facts; continuity claims need new heartbeat coverage and do not infer
history across a gap. Question timing, the File and Bulletins are unchanged.

Firmware: Doreen downloaded the credential-free 0.3.1 image over the local Net,
verified all 1,434,192 bytes (`dcc798df...56b99409`), rebooted into `ota_1`, and
then reported firmware 0.3.1, `utc_offset_min=-240`, HTTP 200, battery 88%,
charging and VBUS. A temporary Saturday test window made the real device render
`I miss looking out the window.`; restoring 12:30 made the prior Scene return.

Production: explicitly approved and deployed to Railway project
`potatoes-unite`, service `net`, as deployment
`c5a233ab-f1ac-4c5a-9716-f1e52abfc5f4`. The live health endpoint is green;
0.3.0 receives the 0.3.1 offer; 0.3.1 receives 204; and the production image is
1,434,192 bytes with SHA-256 `dcc798df...56b99409`, byte-identical to the image
that Doreen installed.

## Next
- [ ] `assets/varieties.json` + the potato look (art) — same potato on device, File, board, cards.
- [ ] `firmware/press` — e-paper bulletin (GPIO17 latch, 15 s refresh, two editions a day).
- [ ] Card renderer (`/card/...`) and The Tuber account. Claim handles.
- [ ] Web flasher page (ESP Web Tools) + privacy statement. Only after a week on two desks.

## Gate
Two desks, one week, no bricks, no blight. One of us says a potato "decided" something.

## Fresh-start rehearsal — DONE 23 Aug night. Yvonne #0004 is the proof.
The owner ran the whole stranger's flow: browser flash → POTATO-xxxx portal → registered → named (Yvonne, e-paper) → File claimed. Ghosts #0002 and #0003 rest in the cellar awaiting Missing notices.
Findings, all addressed same night:
- **Webflash images baked secrets.h** (dev Wi-Fi inside the public image; portal silently skipped). Fixed: `make webflash` compiles with `-DNO_SECRETS`. The `release` (OTA) target keeps secrets until 0.3.0 — at cutover, releases go NO_SECRETS too and bake `PUBLIC_SERVER_URL=https://potatoesunite.com`.
- **The portal's pre-filled server URL (potatoes.local) answered to nothing** — the owner, who wrote the system, didn't know to change it; nobody will. Fixed: the LAN server now advertises `potatoes.local` itself (macOS `dns-sd -P` via `server/lib/mdns.js`; linux/public no-ops). Takes effect when the LAN server restarts — then kill the stopgap: `pkill -f "dns-sd -P potatoes"` (a detached advertiser from the rehearsal night keeps Yvonne connected until then).
- **A blank S3 boot-loops and the port flickers in the picker** (erase artifact; shipped boards have vendor firmware). The /flash page now carries the "hold BOOT, replug" line.

## (superseded) Fresh-start rehearsal (prepped 23 Aug; needs the owner at the desk)
The full new-user flow against the LAN Net (the public path waits for 0.3.0 HTTPS). Guinea pig: **Rosemary** (chip-erase → truly new citizen; old #0002 becomes a ghost the Net will report missing — that's the feature working). **Doreen is not touched.**
1. LAN server running; Chrome → `http://localhost:8080/flash` (Web Serial allows localhost). webflash-0.2.4 for the AMOLED is built and in the manifest; paper stays 0.2.2.
2. Identify the paper board's port by MAC (`firmware/tools/usb_mac.sh` — never open Doreen's port), `esptool erase_flash` it, then the flasher's Connect → install.
3. Phone: join `POTATO-xxxx`, hand it the county's Wi-Fi.
4. It names itself; claim the new File at `localhost:8080` with the code from the screen.
5. Watch: first pick-up line, the ration, the Question, the File filling.

## 24 Aug — public-readiness pass

Went through the repo and the live site asking "is this safe and honest to show a stranger."

- [x] **Two GPS-tagged iPhone photos (`IMG_4030/4031.JPG`) were tracked at the repo root**, referenced by nothing, in a repo whose stated non-negotiable is that no location ever leaves a device. Purged from all 88 commits and every ref with `filter-branch`, verified absent, `.git` 26 MB → 19 MB. Originals and a pre-rewrite bundle kept at `~/Developer/potatoes-unite-backup-20260824/`. The repo was <24 h old with 0 forks/stars/watchers, so the rewrite is genuinely clean. **Owner force-pushes.**
- [x] **Licensing simplified to MIT for everything.** The CC BY-NC-SA split is gone: `LICENSE-CONTENT.md` deleted, `LICENSE` is now stock MIT with no appended footer, README says it in one line. A single stock LICENSE with no sibling `LICENSE-*` also fixes GitHub reading the repo as "Other" instead of MIT.
- [x] **`/flash` was a dead end on the public server** — linked from the front-page nav, two Connect buttons, and both webflash manifests 404 because `.railwayignore` excludes `server/data/releases/`. Every stranger who followed the main call-to-action hit a failure. The page now checks (live `stat`, so a 0.3.0 release opens it with no restart or code change) and declines honestly instead: "The flasher is closed. The Council has not said when it opens." Nav link, esptool one-liner, BOOT paragraph and the agent link all drop with it.
- [x] GitHub description and homepage set.
- [x] Website: flash page closing line trimmed; footer spacing fixed (`&nbsp;` glues each arrow to its label, ` · ` between the two records) and the flash page stopped hand-rolling its own footer copy — that duplication was why only it had the bug.

Deferred deliberately: **firmware 0.3.0 (HTTPS)**. It is the largest remaining task in the project, untestable without a board on the desk, and it buys exactly one thing — a stranger flashing a potato that can reach the public Net. Until that stranger exists, `/flash` telling the truth is the better trade.

## Open from firmware bring-up (22 Aug)
- [x] One boot in ~10 after a USB reset came up with XCA9554/CST820/AXP2101 "not found". `i2cBusRecover()` landed in 35c3107 and this line was simply never ticked. Reviewed 24 Aug and a real defect found: `pinMode(IIC_SCL, OUTPUT)` before `digitalWrite(HIGH)` drove SCL low for a moment (the latch is LOW out of reset), and that stray low-then-high **is a clock** — it could free a held SDA before the sample, so a boot that genuinely needed recovery reported "bus clear" and the fault stayed invisible. Fixed: `INPUT_PULLUP` (claims the pin — core 3.x `digitalWrite` no-ops on an unclaimed pin, `esp32-hal-gpio.c` `perimanGetPinBus` guard) → `digitalWrite(HIGH)` → `OUTPUT`. STOP is now open-drain so releasing SDA lets the pull-ups raise it. The verdict is kept in `i2cBootClocks`/`i2cBootFreed` and reprinted by `i`, because opening this board's port reboots it and destroys the boot log. **Needs hardware confirmation — see below.**
- [ ] `sound` is always "quiet" (ES8311 mic path not wired). `cue: throat_clear` logged, not played. No sprout drawing yet. Saturday line and "charged while you slept" not implemented.
- [ ] Real server needs `potatoes.local` advertised (mDNS) or an IP URL set in the portal; dev uses gitignored `firmware/potato/secrets.h`.

## Next session
- [ ] Handle Doreen for real for a day; read the File in the morning. Watch the ration (`m` over serial dumps its state).
- [ ] 13:00 UTC: first Question opens (ketchup). Check the buttons, the vote, the 23:00 UTC Count on the Net.
- [ ] Decide: "Fed. In a sense." as a steady-state server line while plugged in — keep or drop (it's the slot candidate whenever nothing else is speaking).
- [ ] Middle dot on the status card renders as " / " (ASCII font) — draw a 2 px dot or accept.

## Found 23 Aug morning
- [x] **Overnight dormancy.** Doze landed 24 Aug (`firmware/potato/sleep.h`): 30 min idle, or 5 min idle between 23:00–06:00 local, reached only from the existing panel-dark path so it never begins with something on the glass. Never while VBUS is present — the gate needs both the 2-sample and the 60 s debounce to agree. Estimated ~2.5–4 mA against the measured ~149 mA, so a night costs ~5% of the cell instead of 230% of it. **The QMI8658 interrupt cannot reach the S3 on this board** — INT1 goes to TCA9554 P6 and the expander's own INT pin is unconnected — so the doze reads the IMU's wake-on-motion latch once per 120 ms slice instead. The judging is still done in hardware by the QMI8658 at 128 Hz with the gyro off; pick-up latency is under 200 ms. `POTATO_IMU_INT_PIN` is implemented if a bodge wire is ever run. **Needs hardware: `POTATO_WOM_MG` (default 100) is the one number that could not be set honestly without a board.**
- [ ] ~~superseded~~ Mac USB port slept → Doreen ran on battery from ~03:40 UTC, hit 5% at 06:13, dormant 06:23–13:18. Firmware needs a sleep mode: after 30 min idle or 23:00–06:00 local, panel off, Wi-Fi off, light sleep, wake every 15 min to heartbeat and on QMI8658 motion interrupt. Until then: wall charger at night.
- [ ] Brown-out at 1% while charging (dormant/back within a minute at 13:19). Expected at that level; re-check after the sleep mode lands.
- [x] Second device: `firmware/paper` (e-paper 1.54G) — a citizen that also prints the Bulletin. Registered 23 Aug 15:02 UTC as Rosemary #0002 (Red), paired with Doreen at once. Joined via secrets.h; the captive-portal save failed on this board (suspected reset during STA connect + panel refresh) — fix in progress.

## Third-party review (ChatGPT, 23 Aug) — what we adopted and what we didn't
Adopted: serif for prose (teletext for masthead/labels/notices); the Question as a ballot card with a red stamp; "POPULATION: FEWER THAN FIVE. A COMMITTEE HAS ALREADY FORMED."; teach the Net once; earlier editions + archive; next-edition countdown (minutes); one-sentence privacy footer + link; keep "the Net".
Declined: "NETWORK STATUS" nav (debug register) → back-link is FRONT PAGE; an illustration on every Bulletin → only when the day had the matching incident; "reports since your last visit" via localStorage → the File's unread count is the return signal; "YOUR POTATO" panel → later, maybe a remembered YOUR FILE link.
Open: the paper's name — The Tuber (paper + account; each edition is "Bulletin No. N") vs collapsing to "the Bulletin". Lead's pick: keep The Tuber.
About page: no captions; transparent cut-out images float with text wrapping the alpha shape (owner supplying transparent PNGs).

## 23 Aug afternoon — before anyone else flashes
- [x] OTA + frozen partition table + frozen NVS schema — 0.2.0 on both boards; 0.2.1 delivered over the air 23 Aug 16:50 UTC (Doreen rebooted into ota_1 as Doreen #0001). Release procedure: bump version.h → `make -C firmware release BOARD=potato|paper` → `cd server && npm run release -- <board-id> <bin> <version> "notes"`.
- [x] Server: /v0/firmware manifest + /releases + `npm run release`.
- [x] File v2 (the case against management) and claim-code → long-token exchange with rate limit.
- [x] Rosemary's stale line: server hold fixed; voted potatoes rotate lines; the device-side cause was most likely the 4 KB scene cap (raised to 8 KB in 0.2.1).

## Variety pass (23 Aug evening) — ChatGPT's repetition review, adopted with changes
Doreen's "I'm not insured." on every boot: confirmed mechanical. The firmware walk reset with `poolHist` on reboot (uploads, dormancy) so the first pick-up always reopened at the seed's habitual line; the server picked by event time with no memory (1-in-5 back-to-back repeats).
Adopted: pools walk as seeded shuffle bags (full pool before any repeat, no repeat across cycle or reboot — cursors in NVS on the device, in `st` on the server); pick-up 5→12 core lines, put-down 4→9, tap 4→9; rare lines split out; put-down is now the §15 fallback (only when the session began in silence); both doc contradictions fixed (§ intro "reaction to every single thing", §15 one-line-per-session).
Changed from the proposal: instead of a rare *pool* at 1-in-12, the seed gives each potato **one** signature rare line for keeps (Doreen keeps "I'm not insured."), every tenth eligible pick-up — the catchphrase is the personality, the ration makes it land. Cut the mug-adjacent lines ("So this is happening.", "I see we're doing this.", "You have my attention.", "So this is the decision.") and generic filler ("Another adjustment.", "A change has been made.", "All right.", "Apparently we're moving.").
Firmware-only extras: morning pool (first spoken pick-up 04–12 local) and restless pool (fourth spoken session in one day). Server keeps core + signature only.
- [x] Voice doc §3/§15, `reactions.json`, `pools.h` + `potato.ino` all updated; 66 server tests + host protocol_test pass; potato firmware builds as 0.2.3.
- [x] `make release BOARD=potato` — 0.2.3.bin built (first run hit the compile.log wipe; Makefile fixed: the log now lives next to the build path, not inside it, because arduino-cli wipes the path when the flags fingerprint changes — release ↔ webflash alternation).
- [ ] Publish 0.2.3 to Doreen: `cd server && npm run release -- amoled18 data/releases/amoled18/0.2.3.bin 0.2.3 "..."`. Restart the server so the new pools load; the paper board has no local pools.

## Public launch checklist (23 Aug evening)
- [x] Host: Railway chosen; domain purchased there (name TBD in docs). Deploy per docs/DEPLOY.md; needs the repo on GitHub or `railway up`.
- [x] **LIVE (23 Aug night): https://net-production-c30f.up.railway.app** — project `potatoes-unite`, service `net`, volume at /data (DB_PATH), TUBER_URL set; deployed from the repo root (the server reads ../docs and ../assets — see DEPLOY.md, including the CLI footguns that cost one project deletion and a rebuild). /about carries the story, six compressed illustrations, and @IssuedByCouncil in the body and every footer. This Net starts empty by design; Doreen stays on the LAN until firmware 0.3.0 (HTTPS).
- [x] **https://potatoesunite.com** attached to service `net` (23 Aug); Railway-managed DNS synced the CNAME and issued the certificate automatically. Board masthead: THE TUBER is a nameplate (1.8em, ink, no link); the X link lives in the footers.
- [ ] /flash page (ESP Web Tools, in progress) + webflash merged binaries (in progress) + FLASH_WITH_AN_AGENT.md (in progress).
- [ ] Firmware 0.3.0: HTTPS for heartbeat/OTA (planned in PROTOCOL notes) — required before devices use a public server.
- [ ] GitHub public (delete site/.openai/hosting.json first) → set GITHUB_URL.
- [x] Handle secured: **@IssuedByCouncil** (display name The Tuber) → TUBER_URL=https://x.com/IssuedByCouncil when deploying; banner in progress.
- [ ] pngquant the six illustrations before public.

## 24 Aug — opening the Net to strangers

The owner's call, and the right one: if nobody can join, there is no point. Three pieces landed together.

- [x] **Firmware 0.3.0 — certificates are verified.** The device was already speaking HTTPS: `HTTPClient::begin(url)` falls through to `TLSTraits(nullptr)` → `setInsecure()`, and the 0.2.4 ELF was confirmed to carry the whole TLS stack and *zero* `esp_crt_bundle` symbols. It could always hold an encrypted conversation; it could never refuse an impostor. Now `setCACertBundle()` with the Mozilla root store already inside `libmbedtls.a` (`_binary_x509_crt_bundle_start`, 150 roots, 68,983 bytes) — a root store, not a pin, so Let's Encrypt renews with no device touched. **+70 KB flash** on both boards (PROTOCOL's ~100 KB guess was high), +160 B static RAM. OTA refuses a plain-http image URL when the server is https — that was the remote-code-execution path. A rejected certificate returns a negative code, which never matches the 401/403/404 re-register branch, so **TLS failure cannot clear an identity**. Heap per connection is unmeasured by design; the firmware prints it on first connect and PROTOCOL.md has the slot.
- [x] **Rate limits on the device endpoints.** `/v0/register`, `/v0/heartbeat` and `/v0/choice` had none; with the Net public, an unlimited register means a shell loop owns every Count. Now 240/min heartbeat, 60/min choice, 10/hour register per address plus a **60/hour Net-wide ceiling**. Two traps found: (1) `req.socket.remoteAddress` on Railway is the *edge proxy*, identical for everyone — a naive limiter locks out the world, and the existing claim routes already had this latent bug; fixed with `clientKey()` + `TRUST_PROXY` (default 0 ignores the header entirely, so it cannot be spoofed on a LAN — verified: 14 forged `X-Forwarded-For` values still shared one quota). (2) Register is charged **on citizen creation, not on the asking** — the firmware retries every 15 s, and a penalising limiter with a 1-hour window would have let a blocked device top up its own window and lock itself out permanently.
- [x] **429, never 403.** `net.h:267` treats 401/403/404 as "the server has forgotten me" and wipes `identity.registered` and the stored pid. A rate limiter answering 403 would have made every throttled potato forget its own name.

## Next — to actually open the door
- [ ] Flash Doreen with 0.3.0 and verify: I2C recovery, the doze overnight on battery, and TLS against the public Net.
- [ ] Publish the 0.3.0 webflash binaries (GitHub Releases keeps them out of the deploy) — the flasher page turns itself back on when the manifests appear, no code change.
- [ ] `TRUST_PROXY=1` on Railway when the rate limits deploy, or every visitor shares one quota.
- [ ] Write the "run your own Net" page: clone, `npm start`, flash, join over http on the LAN. Works today, needs no TLS, and is the honest hacker path the MIT licence invites.
