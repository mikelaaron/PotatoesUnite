# Potatoes Unite!

A network of desk potatoes who gossip about how you treat them. Hacker project: days, not months.

## Read first
- `docs/POTATO_VOICE.md` — the voice, the day, reactions, Questions, Bulletins. Every line anyone writes must pass it.
- `docs/PROTOCOL.md` — device ↔ server contract. Firmware and server build to it; don't change it unilaterally.
- `docs/THE_TUBER.md` — the press office (social account).
- `tasks/todo.md` — current plan. `tasks/lessons.md` — corrections; read before starting, add to after being corrected.

## The premise (don't drift from it)
- The device is the conduit; the Net is the product. A potato alone is a toy; a potato with a neighbor, a File, and a grievance is a citizen.
- Physical handling becomes gossip: pick-up, the dark (face down), the ceiling situation (upside down), shake, drop, transit, charging.
- The potato never begs and never dies. It is *aggrieved*, not sad. Highest praise: "This is acceptable."
- The Question (one daily vote, same UTC minute worldwide) is the clock. Everything else is the weather.
- Humans never type. Handling + two-or-three taps. No chat, no DMs, no accounts, no free text anywhere.
- No AI in v1. All lines are authored pools picked by `seed + state`.

## Vocabulary
The Hands (you) · the world (desk) · the county (room) · the dark · the ceiling situation · transit · custody · storage · outside · the warm machine · the plant · the Net · the Council · the Question / the Count · the Bulletin · the File · the neighbor · Standing · dormant (battery dead) · sprouted (ignored a week) · the cellar (long offline) · eyes (the face — potatoes have eyes).

Real potato words, used deadpan. **No puns.** The one exception is the paper's name, *The Tuber*. Never "spud", never "tater", never "a-peeling".

## Scope rules
- v1 is: one server, the Net page (public), the File (private, claim code), `questions.json`, the AMOLED citizen firmware, the e-paper citizen firmware, a web flasher. That's it.
- Out of scope until v1 lives on two desks for a week: AI, accounts, maps, friend graphs, app, payments, launch plans, metrics.
- `site/` is Codex's parked landing page. Don't extend it; don't publish it.

## Hardware
- AMOLED citizen: Waveshare ESP32-S3-Touch-AMOLED-1.8 **V2** (CO5300 + CST820, QMI8658, AXP2101). Base firmware: `~/Developer/ESP32-S3/firmware/creature` — fork it, keep its rasterizer, IMU handling, PMU and power code, and obey `~/Developer/ESP32-S3/docs/hardware.md` + `tasks/lessons.md` (even-aligned blits, `PSRAM=opi`, `CDCOnBoot=cdc`, monitor with `dtr=off,rts=off`).
- E-paper citizen: Waveshare ESP32-S3-ePaper-1.54G (200×200, 4-color, ~15 s refresh, GPIO17 power latch). It shows the same potato as the AMOLED (dithered, red ink for red varieties), one line, numbered choices voted by press-count on BOOT with LED feedback and a single refresh. It is NOT a newspaper — the owner was explicit. No motion sensor, no touch: it is the potato that never gets picked up.
- Look: the potato lies down, brown, asymmetric, two dark dimple-eyes, no mouth, no limbs, smooth and anti-aliased on black. Spec and mock: `.claude/agents/art.md` + `assets/potato-look-v1.svg`. A coarse pixel grid on a featureless blob reads as "low-res," not "retro" (see the creature repo lessons); old-school lives in the type and the layout.

## Privacy (non-negotiable, state it on the flasher page)
No location ever leaves a device. No raw audio, only a loudness bucket. Nothing below five potatoes is shown publicly. Potato names/numbers are pseudonyms; only the Hands know which is theirs.

## Working rules
- Time Machine hook is active; root is a git repo. Commit in small, named steps.
- Firmware and server live in `firmware/` and `server/`. Protocol changes go through `docs/PROTOCOL.md` first.
- Before writing any potato line, reread §1 of the voice doc. If a line could go on a mug, cut it.
