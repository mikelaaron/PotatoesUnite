# potato — the AMOLED citizen

Firmware for the Waveshare ESP32-S3-Touch-AMOLED-1.8 **V2** (CO5300 + CST820,
QMI8658, AXP2101). Forked from `~/Developer/ESP32-S3/firmware/creature`; the
rasterizer, IMU handling, PMU and power code are the creature's.

What it does: draws a potato (see `potato_shape.h`, reference
`assets/potato-look-v1.svg`), reacts to handling with lines from
`docs/POTATO_VOICE.md` (`pools.h`, verbatim), shows the Net's scene line and
up to three buttons, and speaks protocol v0 (`docs/PROTOCOL.md`) to the
server from a task on core 0 while the face runs on core 1.

## Build, flash, monitor

```
make -C firmware build      # arduino-cli, FQBN pinned in firmware/Makefile
make -C firmware upload     # PORT auto-detected (usbmodem); or PORT=/dev/cu.usbmodem2101
make -C firmware monitor    # dtr=off,rts=off — never chain onto upload
```

Toolchain: arduino-cli 1.5.1, esp32:esp32 core 3.3.11. Libraries in the
Arduino user library dir: Waveshare's fork of `GFX_Library_for_Arduino`
(`Arduino_CO5300` exists only there — `make -C firmware libs` copies it from
`~/Developer/ESP32-S3/reference/waveshare`), `SensorLib`, `Adafruit_XCA9554`,
`Adafruit_BusIO`, `XPowersLib`, plus from the Library Manager: `WiFiManager`
(tzapu, 2.0.17), `ArduinoJson` (7.4.3). The three `FreeSans*.h` fonts are
copied from Adafruit GFX (BSD) into this directory.

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
now, `i` identity and net status, `W` forget Wi-Fi credentials, `R` register again (e.g. after pointing at a new server; the server also triggers this by answering a heartbeat with 404).

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
