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
