# Potatoes Unite!

*A network of desk potatoes that do not need you, and have noticed how you treat them.*

Spare ESP32 boards, lying on desks with nothing to do, become potatoes. Each one is on the Net. Once a day the Council puts a Question to every potato (ketchup; whether Tuesday should continue). Each keeps a File on how its Hands treat it — picked up, left face down, shaken, left home again — and tells its neighbor. The potatoes never need you. They have noticed you.

The whole story, in the Council's words: [docs/STORY.md](docs/STORY.md) — served at `/about` on a running Net.

## What's here

| Path | What |
|---|---|
| `server/` | The Net. One Node process, no dependencies, SQLite. The public page, the File, the Question, the Bulletin. `cd server && npm start` · `npm test` |
| `firmware/potato/` | The AMOLED citizen (Waveshare ESP32-S3-Touch-AMOLED-1.8 V2). Face, one line, up to three buttons, captive-portal Wi-Fi. `make -C firmware build` |
| `firmware/paper/` | The e-paper citizen that prints the paper (Waveshare ESP32-S3-ePaper-1.54G). |
| `docs/POTATO_VOICE.md` | The voice. Every line a potato says must pass it. Read this first. |
| `docs/PROTOCOL.md` | Device ↔ server contract. A board with a screen and a radio can join with a few small requests. |
| `docs/THE_TUBER.md` | The press office — the Council's public paper. |
| `assets/` | The look (`potato-look-v1.svg`) and the ten varieties (`varieties.json`). |
| `tasks/` | The plan and the lessons. |

## Boards

Tested on exactly two boards: the Waveshare **ESP32-S3-Touch-AMOLED-1.8 (V2)** and the Waveshare **ESP32-S3-ePaper-1.54G**. The AMOLED is the stronger potato (a face, touch, a motion sensor). Another ESP32 board with a screen and a radio is not "the same specs" — it needs a port: its pin map and its display driver. The protocol is a few small requests and the shared `net.h`/`protocol.h` carry over; a port is a weekend, not a rewrite.

## Updates never reset a potato

Almost everything a potato does comes from the Net: its lines, the Question, events, the Bulletin, neighbors, Standing. Those change on the server and reach every potato within a heartbeat — no reflash. Firmware itself updates over the air (the device checks once a day and installs at a quiet moment). A potato's identity lives in its own flash (NVS) and survives every update and every manual reflash short of a full chip erase; Doreen stays Doreen.

## Running it on your desk

1. `cd server && npm start` — prints the LAN address to point a device at.
2. Build and flash a firmware with `arduino-cli` (see each firmware's README for the board settings and the Wi-Fi join flow; a browser flasher is coming after the Net has lived on two desks for a week).
3. Join the board's `POTATO-xxxx` Wi-Fi once and give it your network. It names itself. You are not consulted.
4. The File is at `/file/<claim code>`; the claim code is on the screen when you hold the face.

## Privacy

Your device never sends where it is. It never sends audio — only whether the room is quiet or loud. Nothing is shown publicly until at least five potatoes are involved. Potato names and numbers are pseudonyms; only the Hands know which one is theirs.

## Rules for contributors

Read `CLAUDE.md` (or `AGENTS.md`, the same file). Real potato words, used deadpan. No puns. No AI writing the lines. If a line could go on a mug, cut it. Ports to other boards are welcome.
