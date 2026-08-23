# potato — the AMOLED citizen

Firmware for the Waveshare ESP32-S3-Touch-AMOLED-1.8 **V2** (CO5300 + CST820,
QMI8658, AXP2101). Forked from `~/Developer/ESP32-S3/firmware/creature`; the
rasterizer, IMU handling, PMU and power code are the creature's.

I2C bring-up: before `Wire.begin` the firmware runs a bus-recovery sequence
(if SDA is held low by a slave that was mid-transaction at reset, SCL is
clocked up to nine times, then a STOP); the expander, touch and PMU are then
probed up to three times 50 ms apart, and anything still missing is re-probed
every 60 s from the loop (the PMU re-run repeats its full setup). While the
PMU is missing the heartbeat carries `"battery": {"pct": null, …}`.

Battery: a 3.7 V / 400 mAh / 1.48 Wh Li-ion cell. At boot the firmware sets
the AXP2101 constant charge current to **150 mA** (0.375C, under 0.5C) and
the charge target voltage to **4.20 V**, and prints both plus the precharge
and termination currents (left at the PMU defaults). Do not raise the charge
current without a different cell.

What it does: draws a potato (see `potato_shape.h`, reference
`assets/potato-look-v1.svg`), reacts to handling with lines from
`docs/POTATO_VOICE.md` (`pools.h`, verbatim), shows the Net's scene line and
up to three buttons, and speaks protocol v0 (`docs/PROTOCOL.md`) to the
server from a task on core 0 while the face runs on core 1.

## Build, flash, monitor

```
make -C firmware build      # arduino-cli, FQBN pinned in firmware/Makefile
make -C firmware upload     # PORT auto-detected only if exactly one board is plugged in
make -C firmware upload PORT=/dev/cu.usbmodem201301   # with two boards on USB, always explicit
make -C firmware monitor    # dtr=off,rts=off — never chain onto upload
```

Toolchain: arduino-cli 1.5.1, esp32:esp32 core 3.3.11. Libraries in the
Arduino user library dir: Waveshare's fork of `GFX_Library_for_Arduino`
(`Arduino_CO5300` exists only there — `make -C firmware libs` copies it from
`~/Developer/ESP32-S3/reference/waveshare`), `SensorLib`, `Adafruit_XCA9554`,
`Adafruit_BusIO`, `XPowersLib`, plus from the Library Manager: `WiFiManager`
(tzapu, 2.0.17), `ArduinoJson` (7.4.3). The three `FreeSans*.h` fonts are
copied from Adafruit GFX (BSD) into this directory.

With two boards on USB (Doreen and the e-paper press) `make upload` refuses to
guess. Map a board to its port with `ioreg -p IOUSB -l -w0`: find its
`USB Serial Number` (Doreen is `28:84:85:90:B4:58`) and the `locationID` in
the same block; `0x20130000` is `/dev/cu.usbmodem201301`, `0x02100000` is
`/dev/cu.usbmodem2101`. Ports move when cables do — check before every flash.

The S3's USB CDC is the chip itself: DTR/RTS feed its reset sequence, so a
monitor that asserts them parks the chip and prints nothing. For scripted
capture (boot banner, sending dev keys) use `tools/serial_capture.py`, which
needs pyserial:

```
python3 firmware/tools/serial_capture.py /dev/cu.usbmodem2101 20 /tmp/potato.log "5:q,3:t"
```

Serial dev keys (lower case, `h` lists them): `t` tap, `n` night, `p` pickup,
`d` drop, `k` dark-restored, `q` demo Question with three buttons, `1`/`2`/`3` press a button, `x` clear,
`a`/`w`/`z`/`v` expressions, `e` event queue, `c` status card (what long-press shows), `b` heartbeat
now, `u` OTA check now, `i` identity and net status, `W` forget Wi-Fi credentials, `R` register again (e.g. after pointing at a new server; the server also triggers this by answering a heartbeat with 404).

## Wi-Fi setup

First boot, or whenever the saved network is unreachable for 20 s, the potato
opens a captive portal: join the Wi-Fi network **POTATO-XXXX** (XXXX = last
four hex digits of its MAC; the screen says which) from a phone or laptop,
and the portal page opens (or go to `http://192.168.4.1`). Pick your network,
enter its password, and optionally change:

- **Server URL** — default `http://potatoes.local:8080` (`.local` names are
  resolved over mDNS).
- **POSIX TZ** — default `EST5EDT,M3.2.0,M11.1.0`; the device keeps local
  time for night lines and bulletin editions.

The portal closes after 180 s without a save and reopens on the next retry;
the face keeps running throughout. Credentials live in the ESP32's Wi-Fi NVS
(`W` over serial erases them). For development, copy `secrets.example.h` to
`secrets.h` (gitignored) with `WIFI_SSID`, `WIFI_PASS` and/or `SERVER_URL`;
`SERVER_URL` there overrides the stored one.

Stand-in server for bring-up: `python3 firmware/tools/stub_server.py` answers
register/heartbeat/choice with a fixed Question and logs every body.

## What runs on the device alone (layers 1–3)

Breathing, blinking, glances, lean with gravity, slosh; reactions with lines
from the voice doc for pick-up, put-down, the dark (with 10 min / 1 h / 3 h
escalation and the counted duration on restore), the ceiling situation,
shake, drop (blank second first), tap, night touch, left-alone thresholds
(4 h … 7 d) and the return, transit, plugged/unplugged/full, battery
30/20/10/5 %, Wi-Fi lost/restored, dormancy on wake. Night sleep: five idle
minutes between 23:00 and 06:00 close the eyes, dim the body and blank the
line. Face-down sleeps the panel; on battery it sleeps after 150 s idle (from
the creature). All of it works with no server; the last scene is cached.

**The ration (voice doc §15) governs how often she speaks. Silence is the
default; a line is an event.** A *handling session* begins at the first
pick-up and ends after 60 s of stillness, and earns at most one line, at the
start. Pick-up speaks only as a fresh encounter (10 min+ since the last
session ended); put-down only after a 30 s+ session and one time in three.
Minor lines — pick-up, put-down, tap, plug, unplug — share a 3-minute
cooldown and fire about six times in ten, chosen by a seeded RNG so a given
potato is consistent. Major lines bypass the budget: shake (5-min refractory),
drop (always), the dark past 10 min, the ceiling past 5 min, the battery
thresholds. The dark is confirmed only after 5 s face-down *and still*, and is
spoken — and reported to the server — only once the episode passes 60 s; a
flip in the hand leaves no line and no `facedown_start/end`. Plug/unplug and
the battery thresholds require 60 s continuously in the new VBUS state, so a
cable that loses contact in the hand is not an event. Physical events
(`pickup`, `putdown`, `tap`, …) are still sent as they happen — the server
coalesces them; only the *lines* are rationed.

**Night touch** fills its time line from the clock ("It's 11 PM.", hour only)
and skips that variant until NTP has set the time. **Long-press** on the body
shows a plain status card in the text band for 20 s (name, number and
variety; claim code; battery and charging state; local and UTC time; Net
state) — no quips, a tap dismisses it early. The claim code is still shown as
a line for 30 s right after registration.

## Partitions, versions, updates

`potato/partitions.csv` is the **frozen** 16 MB layout (`PartitionScheme=custom`;
the core copies the sketch's csv into the build): `nvs` 0x9000/20 KB, `otadata`
0xe000, `ota_0` 0x10000/3 MB, `ota_1` 0x310000/3 MB, `littlefs` 0x610000/1 MB,
`coredump`. The first three sit exactly where Arduino's `huge_app` put them,
so flashing this layout over an older device keeps its NVS — secret, name,
scene — and arduino-cli's hardcoded upload offsets still apply. The
"Sketch uses" line is reported against 16 MB under the custom scheme; the
real limit is the 3 MB slot (3,145,728 bytes). NVS keys: `firmware/NVS.md`.

`version.h` holds the one `FW_VERSION`. Once a day (and on serial `u`) the
net task asks `GET /v0/firmware?board=amoled18&fw=<version>`; a newer
manifest is streamed into the inactive slot, SHA-256-checked, and the
potato reboots at a quiet moment (no Question, no request, no touch, ≥30 %
or on VBUS) after saying "I've been updated. I feel the same." The new image
boots pending verification and is marked valid after its first good
heartbeat; otherwise the bootloader rolls back. Boot banner: `ota: fw … running
from ota_0 @0x010000 (3072 KB slot), next slot ota_1; image state …`.

## Identity and state (NVS namespace `potato`)

`secret` (16 random bytes, never shown), `pid`/`name`/`variety`/`claim`
from `/v0/register`, `seed` (the server's, once registered; a local random one
before), `scene` (last scene JSON, shown when offline), `server`, `tz`,
`last_epoch` (for `dormant_resume`).

## Layout

Body centred at (184, 146), ~60% of the width; text band from y=292: one line
(FreeSans 18pt, word-wrapped to two lines, 12pt/three lines if it will not
fit) and up to three outlined buttons. The body blit never crosses y=292.
All blits are even-aligned; telemetry prints `ODD!` if one is not.

## Host tools

- `tools/render_preview.cpp` — renders the body with the firmware's own
  rasterizer to a PPM (`c++ -std=c++11 -I firmware/potato ...`).
- `tools/protocol_test.cpp` — checks `protocol.h` (wire format) and the
  counted-duration words against the stub's and the doc's JSON.
