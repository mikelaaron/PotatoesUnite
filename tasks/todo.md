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
- [ ] `server/` — one Node process, SQLite, protocol v0, the board, the File, `questions.json` from the voice doc, deterministic replay test.
- [ ] `firmware/potato` — fork of creature: potato silhouette + eyes, text line, up to three touch buttons, Wi-Fi captive portal, heartbeat/scene/choice, events from the existing IMU code, battery from AXP2101. Flashed and verified on the desk.
- [ ] Live: both talking on the LAN. Pick it up, see it in the File.

## Next
- [ ] `assets/varieties.json` + the potato look (art) — same potato on device, File, board, cards.
- [ ] `firmware/press` — e-paper bulletin (GPIO17 latch, 15 s refresh, two editions a day).
- [ ] Card renderer (`/card/...`) and The Tuber account. Claim handles.
- [ ] Web flasher page (ESP Web Tools) + privacy statement. Only after a week on two desks.

## Gate
Two desks, one week, no bricks, no blight. One of us says a potato "decided" something.
