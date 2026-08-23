# paper — the e-paper press

Firmware for the Waveshare **ESP32-S3-ePaper-1.54G** (ESP32-S3-PICO-1-N8R8:
8 MB flash, 8 MB OPI PSRAM; 200×200 four-colour e-paper, black/white/red/
yellow, ~15–20 s full refresh; SHTC3; PCF85063 RTC; ES8311 codec + mic;
ETA6098 charger; microSD; green LED; BOOT and PWR keys; a GPIO17 power
latch).

A citizen that also prints the paper. It registers with board `epaper154`,
gets its own name and variety, heartbeats every 120 s and after a key press,
and prints the Bulletin. It is the potato that never gets picked up: its
senses are a thermometer and a button.

## Build, flash, monitor

Two boards share the Mac. The paper targets never guess a port.

```
make -C firmware paper-build                              # arduino-cli, FQBN in the Makefile
make -C firmware paper-upload PORT=/dev/cu.usbmodemXXXX   # explicit PORT only; reads the MAC
                                                          # first and refuses Doreen's
make -C firmware paper-monitor PORT=/dev/cu.usbmodemXXXX  # dtr=off,rts=off
make -C firmware paper-mac PORT=/dev/cu.usbmodemXXXX      # just print the MAC on that port
make -C firmware paper-preview                            # render the page on the host → /tmp/paper-*.png
make -C firmware paper-portrait                           # regenerate portrait.h from the SVG
```

FQBN: `esp32:esp32:esp32s3:PSRAM=opi,CDCOnBoot=cdc,FlashSize=8M,PartitionScheme=default_8MB`
(the vendor's IDE settings: OPI PSRAM, 8 MB, USB CDC on boot). Toolchain:
arduino-cli 1.5.1, esp32:esp32 core 3.3.11, `WiFiManager` 2.0.17,
`ArduinoJson` 7.4.3. No display library: the panel driver is `epd154g.h`,
ported from the vendor's `EPD_1in54g.cpp` onto hardware SPI, and the text
engine is `paper_gfx.h` (Adafruit GFX font tables, BSD, copied into this
directory: FreeSerifBold 12/9 pt, TomThumb, the classic 5x7). GxEPD2 was not
used: it has no driver for this four-colour 1.54" G panel.

If the panel comes up upside down relative to the USB port, build with
`make paper-build PAPER_ROTATE=1` (sets `EPD_ROTATE_180`).

Scripted capture (boot banner, dev keys), same as the potato:

```
python3 firmware/tools/serial_capture.py /dev/cu.usbmodemXXXX 30 /tmp/paper.log "5:i,3:p"
```

## Pins (`board_pins.h`)

Verified against the vendor repo's `user_config.h` / `DEV_Config.h` and the
schematic. Summary: e-paper SCK 12, MOSI 13, CS 11, DC 10, RST 9, BUSY 8
(LOW while busy), panel rail enable GP6 (LOW = on); I2C SDA 47 / SCL 48 with
SHTC3 at 0x70, PCF85063 at 0x51, ES8311 at 0x18; battery ADC GP4 through
200K/200K (volts = mV × 2); LED GP3 (LOW = on); BOOT GP0; PWR GP18;
**GP17 = BAT_Control**, the power latch.

**The latch.** GP17 drives an 8050 that pulls the gate of the P-FET between
VBAT and VSYS. The PWR key holds that gate only while pressed, so the first
thing `setup()` does is drive GP17 HIGH, release any pad hold a previous
firmware left, drive it HIGH again and hold it (`gpio_hold_en`) so a soft
reset on battery does not dip the pin and power the board off. USB feeds
VSYS directly through a diode, so on USB the latch is moot — which is why
the board seems fine during development and dies on battery if this is
forgotten. PWR held 3 s releases the latch (power off on battery; a no-op on
USB, and the firmware says so).

## What is live and what is stubbed

- **Panel**: live. Full refresh through the vendor's register sequence;
  sleep between refreshes. 2-bit frame, 10 000 bytes, hardware SPI at 8 MHz.
- **SHTC3**: live. `temp_c` in the heartbeat is the raw reading minus
  `SHTC3_BOARD_HEAT_C` = 4 °C, the self-heating offset the vendor example
  applies (`SHTC3_PETP_NUM`). The banner prints both.
- **RTC**: live. At boot the system clock is set from the PCF85063 if it
  holds a valid time (so local time, editions and the night rule work before
  Wi-Fi); after the first NTP sync the RTC is written back.
- **Battery**: live via the ADC; percentage from a LiPo open-circuit curve
  (3.30 V = 0 %, 4.20 V = 100 %). **Charging/vbus are inferred**: the
  ETA6098's STAT pin only drives an LED, no GPIO sees it. `vbus` is true when
  the USB CDC sees a host or the cell reads ≥ 4.15 V (the charger's CV
  phase); `charging` = vbus and under 100 %.
- **Orientation**: always `up`. **Events**: only `tap` (a BOOT burst outside
  a Question), plus `wifi_restore` and `dormant_resume` from the Net code.
  `since_handled_s` counts from the last key press.
- **Sound**: stubbed, always `"quiet"`. The ES8311 mic path is not wired
  (it needs the codec over I2C plus I2S RX and a loudness bucket; more than
  the hour it was worth).
- **Cues**: `incident` prints the headline in red. `throat_clear` and
  `silence` do nothing here.
- **Requests** (`scene.request`) are not acted on; there is no IMU and no
  DONE button layout yet.

## The page (`layout.h`)

**The screen is the potato.** The lying-down body from
`assets/potato-look-v1.svg` (`portrait.h`, generated at 140 px wide by
`tools/make_portrait.py`) sits centred about 40 % down: a 2 px black
outline, the skin a Bayer dither at the variety's density with a darker
underside and a highlight, four dimples, two eyes. Red and Désirée print
their skin in the panel's red; King Edward is pale with red flecks; every
other variety is black on white (`skinFor()` in `paper_gfx.h`, from
`assets/varieties.json`). Expressions are the AMOLED's, by eye shape:
neutral/waiting/pleased ovals, aggrieved slits, asleep/dormant arcs, `cue:
incident` wide rings, and a glance toward the edge while `file_unread > 0`.
Under the potato, in the 5x7: `ROSEMARY #0002 · RED` (the claim code in its
place for ten minutes after registration, or after a short PWR press); then
the scene `line` (≤ 60 chars, wrapped, centred). No masthead, no Bulletin
layout — a headline arrives as a line like any other.

**Voting in one refresh.** With `choices` in the Scene the options print
under the line, numbered `1 HEINZ / 2 HUNT'S / 3 WHATEVER'S THERE`, in the
same refresh as the Question. Press BOOT N times within two seconds; the LED
blinks the running count back after each press (no panel refresh). Two
seconds after the last press the choice for option N goes to `/v0/choice`,
and the page prints once more — after the Scene the choice returns, so the
mark and the new line land in one refresh — with the chosen row inverted. A
count outside 1..N gets a triple blink and no refresh. Outside a Question a
burst is one `tap`. The vote is remembered by option id across heartbeats.

**Unregistered and off the Net**, the page is the join card: `NOT YET A
CITIZEN.`, then `JOIN WI-FI / POTATO-XXXX / then open 192.168.4.1` large
and centred, `Could not join <ssid>. Try again.` after a failed portal save,
and a small unnamed potato at the bottom. Nothing on it depends on the
portal's state, the clock or the battery, so it prints once.

**Refresh policy.** Full refresh only when the rendered page changes (a hash
of the frame; the serial log names the first field that differed), never
more than once per 60 s, never between 23:00 and 06:00 local unless the line
changed, never while Wi-Fi is joining. E-paper persists; silence is free. A
key press gets the panel as soon as it is idle and the keys have been quiet
for 2 s. The first page waits up to 20 s for the Net. The LED is on while
the panel is refreshing.

`make paper-preview` renders sample pages with the same code on the host
(`tools/paper_preview.cpp`); `p` over serial prints the text of the current
page, `s`/`S` a character dump of it.

## Net (`net.h`, `protocol.h`)

Copied from `firmware/potato` with three changes: board name `epaper154`;
a 4 KB scene cap (the Scene carries `bulletin` plus `bulletins.morning/
evening`; a scene over ~3.9 KB is shown but not cached, NVS strings stop
there); `temp_c` and `utc_offset_min` in the heartbeat, and the Bulletin
parsed out of the Scene. `events.h` is an unchanged copy. **The two copies
should be unified** once both boards have run a week; until then a fix in
one must be made in the other by hand.

Same captive portal (AP `POTATO-XXXX`, last four of the MAC; Server URL and
POSIX TZ fields), same NVS namespace `potato` (secret, identity, cached
scene, server, tz, last_epoch), same 120 s heartbeat, 1.5 s after an event.
For development copy `secrets.example.h` to `secrets.h` (gitignored).
`firmware/potato/secrets.h` only sets `SERVER_URL`; Doreen's Wi-Fi came
through the portal. Add `WIFI_SSID`/`WIFI_PASS` to `paper/secrets.h` or join
`POTATO-XXXX` from a phone and enter the network there.

## Serial keys

`h` lists them: `t` one BOOT press, `1`/`2`/`3` a burst of N presses, `k`
PWR short (claim code), `q` demo Question (local, not from the Net), `b`
heartbeat now, `r` force refresh, `n` night override, `p` page text, `s`/`S`
screen dump (100×100 / 200×200), `T` sensors, `c` clock, `e` events, `i`
identity and net status, `x` clear scene, `W` forget Wi-Fi, `R` register
again, `O` power off (latch low).

## Bring-up notes (2026-08-23, MAC 70:04:1D:D7:A8:C4)

- **Reset timing is the whole panel driver.** The vendor's ESP-IDF driver
  resets with 50/20/50 ms; with that, every command after reset was ignored —
  BUSY still went idle on its own and a "refresh" finished in 200 ms with
  nothing on the glass. The vendor's Arduino example (200 ms high, 2 ms low,
  200 ms high) works, and flashing it unmodified with timestamps on its BUSY
  waits proved the hardware: power-on busy ~100 ms, a full refresh 13.9 s,
  BUSY reads LOW while busy. Our driver uses that timing; a refresh measures
  14.5 s over FSPI (`PAPER_HW_SPI=0` bit-bangs, same result).
- **Two boards, one Mac.** Port names change on every re-plug (Doreen went
  from `usbmodem1101` to `usbmodem201301`), and opening an S3's CDC port on
  macOS resets the chip even with DTR/RTS "off" — a six-second listen
  rebooted Doreen once. `tools/usb_mac.sh` maps a port to its MAC from the
  USB descriptors without opening it; `paper-upload`/`paper-monitor` refuse
  Doreen's MAC. Also seen: the press's USB CDC wedged on the host after a
  reset mid-capture (port present, no bytes, esptool and openocd both failing
  on control transfers); a libusb port reset (`pyusb` `dev.reset()` on the
  press's device only) cleared it without a re-plug.
- **SHTC3 runs hot.** 31 °C raw at a cold start, 34–37 °C after ten minutes
  with the Wi-Fi portal up, on a desk in August. The vendor's 4 °C offset is
  what the heartbeat carries; at steady state it under-compensates. Calibrate
  against a real thermometer before trusting `temp_c` to a degree.
- **Wi-Fi and the watchdog.** The first portal attempts failed with the
  panel "flashing": WiFiManager's blocking portal loop only `yield()`s, IDLE0
  never ran, and the task watchdog reset the chip every ~40 s (every reset
  reprinted the page and killed the AP mid-save). The net task now drives the
  portal non-blocking (`process()` + `vTaskDelay`), holds panel refreshes
  while Wi-Fi is joining, persists credentials the moment the portal hands
  them to the driver, and logs the pre-save, the save and the connect result
  (`WL_CONNECT_FAILED` = wrong password, `WL_NO_SSID_AVAIL` = not found). A
  failed save prints "Could not join <ssid>. Try again." on the page. The
  banner names the reset reason. `paper/secrets.h` `WIFI_SSID`/`WIFI_PASS`
  are used when non-empty and never printed. Registered on the LAN as
  Rosemary #0002 (red), neighbor Doreen #0001.
- **Panel orientation** relative to the USB port is unconfirmed (no eyes on
  it from here); `PAPER_ROTATE=1` if it is upside down.


## Partitions, versions, updates

`paper/partitions.csv` is the **frozen** 8 MB layout (`PartitionScheme=custom`):
`nvs` 0x9000/20 KB, `otadata` 0xe000, `ota_0` 0x10000/2.5 MB, `ota_1`
0x290000/2.5 MB, `littlefs` 0x510000/1 MB, `coredump`. `nvs`/`otadata`/`ota_0`
are where Arduino's `default_8MB` had them, so an existing press keeps its
NVS. The real app limit is the 2.5 MB slot (2,621,440 bytes). `version.h`
holds the one `FW_VERSION`. OTA: once a day and on serial `u`, `GET
/v0/firmware?board=epaper154&fw=<version>`; a newer image goes into the
inactive slot (SHA-256 checked) and the press reboots at a quiet moment —
never mid-refresh, no Question open, ≥30 % or on VBUS — with no refresh of
its own; the new image is marked valid after its first good heartbeat, else
the bootloader rolls back. `ota.h` is an identical copy of the potato's.
A `/v0/choice` is posted once per distinct (rev, option); repeating the same
press count on the same Scene is not re-posted. NVS keys: `firmware/NVS.md`.
