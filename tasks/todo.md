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

## Next
- [ ] `assets/varieties.json` + the potato look (art) — same potato on device, File, board, cards.
- [ ] `firmware/press` — e-paper bulletin (GPIO17 latch, 15 s refresh, two editions a day).
- [ ] Card renderer (`/card/...`) and The Tuber account. Claim handles.
- [ ] Web flasher page (ESP Web Tools) + privacy statement. Only after a week on two desks.

## Gate
Two desks, one week, no bricks, no blight. One of us says a potato "decided" something.

## Fresh-start rehearsal (prepped 23 Aug; needs the owner at the desk)
The full new-user flow against the LAN Net (the public path waits for 0.3.0 HTTPS). Guinea pig: **Rosemary** (chip-erase → truly new citizen; old #0002 becomes a ghost the Net will report missing — that's the feature working). **Doreen is not touched.**
1. LAN server running; Chrome → `http://localhost:8080/flash` (Web Serial allows localhost). webflash-0.2.4 for the AMOLED is built and in the manifest; paper stays 0.2.2.
2. Identify the paper board's port by MAC (`firmware/tools/usb_mac.sh` — never open Doreen's port), `esptool erase_flash` it, then the flasher's Connect → install.
3. Phone: join `POTATO-xxxx`, hand it the county's Wi-Fi.
4. It names itself; claim the new File at `localhost:8080` with the code from the screen.
5. Watch: first pick-up line, the ration, the Question, the File filling.

## Open from firmware bring-up (22 Aug)
- [ ] One boot in ~10 after a USB reset came up with XCA9554/CST820/AXP2101 "not found" (no touch/PMU until next reboot). Likely an I2C slave holding SDA across reset; add a 9-clock bus-recovery pulse before `Wire.begin`.
- [ ] `sound` is always "quiet" (ES8311 mic path not wired). `cue: throat_clear` logged, not played. No sprout drawing yet. Saturday line and "charged while you slept" not implemented.
- [ ] Real server needs `potatoes.local` advertised (mDNS) or an IP URL set in the portal; dev uses gitignored `firmware/potato/secrets.h`.

## Next session
- [ ] Handle Doreen for real for a day; read the File in the morning. Watch the ration (`m` over serial dumps its state).
- [ ] 13:00 UTC: first Question opens (ketchup). Check the buttons, the vote, the 23:00 UTC Count on the Net.
- [ ] Decide: "Fed. In a sense." as a steady-state server line while plugged in — keep or drop (it's the slot candidate whenever nothing else is speaking).
- [ ] Middle dot on the status card renders as " / " (ASCII font) — draw a 2 px dot or accept.

## Found 23 Aug morning
- [ ] **Overnight dormancy.** Mac USB port slept → Doreen ran on battery from ~03:40 UTC, hit 5% at 06:13, dormant 06:23–13:18. Firmware needs a sleep mode: after 30 min idle or 23:00–06:00 local, panel off, Wi-Fi off, light sleep, wake every 15 min to heartbeat and on QMI8658 motion interrupt. Until then: wall charger at night.
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
