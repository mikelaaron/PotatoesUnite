# Lessons

Patterns worth not repeating. Added after corrections.

## A second board is not a viable second participant

**2026-09-06.** Mike clarified that the e-paper device is not viable for a
paired experience and he has no suitable second device to give someone.
Do not propose a two-person test on the assumption that owning two boards
means having two usable devices. Respect the decision to finish the project.

## Plain feeling beats compulsory potato bureaucracy

**2026-08-29.** The first midday bank still reached for the Council, forms and
procedure when an ordinary line would do. Mike asked for fewer food comments,
more true neighbor material, and lines as simple as "I miss looking out the
window."

**How to apply:** keep the glossary available but do not force it into every
sentence. Let potatoes notice the window, the afternoon, the room and their
neighbor in plain language. Use Council procedure as one occasional pool, not
the default source of wit. Food is established territory; new weekly batches
should normally add none.

## A brown ellipse with two eyes is an egg

**2026-08-22.** First pass at the potato body: a smooth brown oval, two dark
eyes, low-amplitude sinusoidal bumps. The owner's verdict on the device: it
reads as an egg. What makes a potato a potato is not the outline but the
things the outline alone cannot carry — a fat end, a darker underside, a
highlight that says it is a solid, and the dimples (a potato's real eyes)
scattered asymmetrically. The reference mock (`assets/potato-look-v1.svg`)
had all of those; the first implementation had none.

**How to apply:** when rendering a recognisable object procedurally, list what
makes it *that* object rather than its nearest primitive, and build those in
from the start. Fit the parameters from the art direction (here, a Fourier
fit of the mock's outline) instead of guessing.

## Per-pixel shading is a 3x frame cost; make it per-row

**2026-08-22.** Adding the underside shade and highlight as a per-pixel
ellipse test took the raster from 3.7 ms to 15.5 ms and the frame rate from
60 to 35. The creature's rule — shapes are scanline-analytic, no per-pixel
sqrt/atan2 — applies to shading too: a rotated ellipse is one quadratic per
row, and inside the body a row is a handful of constant-colour runs with
coverage-blended boundary pixels. Same picture, 4.9 ms.

**How to apply:** anything evaluated per pixel inside a ~40k-pixel body is a
frame-budget decision. Ask first whether it is a function of the row.

## Arduino_GFX fonts cannot draw straight to the CO5300

Text through `gfx->print` goes pixel by pixel (odd 1x1 windows) and would
shear the panel. The text band is an `Arduino_Canvas` in PSRAM, drawn with
the GFX font engine and flushed as one even-aligned blit, only when the text
changes (about 20 ms per flush, a few times an hour).

## Silence is the default; every reaction is rationed

**2026-08-22.** First real handling session: every lift produced a line and the
File filed seven entries in thirty seconds, including "Restored from the dark.
1s." Mike's verdict: too many quips, too often. The detectors were right; the
*policy* was missing. A sensor event is not a speaking opportunity.

**How to apply:** model handling as sessions with one line at the start, give
minor lines a shared budget with a random skip, let only major events bypass
it, and debounce physical states (dark, power) before they count. The File
records sessions, not movements. Rules are in `docs/POTATO_VOICE.md` §15.

## A reaction per movement is a motion log, not a character

**2026-08-22.** The first real handling session logged seven lines in thirty
seconds — every lift, every wiggle. The owner: "too many quips, too often."
The fix (voice doc §15) was not shorter lines but a ration: a *session* (first
pick-up to 60 s of stillness) earns one line at the start; minor lines share a
cooldown and a seeded ~60% roll; major lines bypass it. The seed makes the
roll consistent per potato so "six in ten" is a voice, not noise.

**How to apply:** rate a character by encounters, not sensor edges. Cluster
raw events into a session first, decide once per session, and gate the rest.
Silence is a feature; if it seems quiet, it's working.

## A threshold that reads an instantaneous sensor fires on contact bounce

**2026-08-22.** A `battery_low` "Thirty percent" line fired while plugged in:
the USB cable lost contact for 25 s in the owner's hand — `charge_end` →
`battery_low` → `charge_start` — and the threshold read the raw VBUS bit. The
2-sample (2 s) debounce already on the bit was not enough. Charging is a
*state*, not a sample: a plug/unplug now counts only after 60 s continuously
in the new VBUS state, and battery thresholds only fire once VBUS has been
stably absent that long. Same shape as the creature's "condition held for N,
not condition became true" lesson, one layer up.

## A board with a power latch dies the moment the key is released

**2026-08-23.** The ESP32-S3-ePaper-1.54G has no power switch: the PWR key
holds a P-FET's gate while pressed, and GP17 (`BAT_Control`) has to take over
before the finger lifts or the board browns out — but only on battery. On USB
the rail comes from VBUS through a diode, so a firmware that forgets the latch
looks perfect on the bench and is dead on the desk. The schematic is the
source of truth (the vendor examples drive GP17 high in a "board_power_bsp"
constructor and never explain why).

**How to apply:** drive the latch first in `setup()`, before serial, before
the display, and hold it (`gpio_hold_en`) so a soft reset does not dip it.
Test a "works on USB" build on the battery before calling it done. When a
vendor board has an unexplained "power" GPIO in every example, read the
schematic before writing a line.

## The four-colour panel is a 15 s full refresh and nothing else

**2026-08-23.** The 1.54" G panel (black/white/red/yellow) has no partial
refresh and no fast mode worth using: every change is a ~15–20 s flash
sequence, the panel must be reset to wake from deep sleep, and BUSY is LOW
while busy (the vendor's comment says the opposite; its code waits for HIGH).
GxEPD2 has no driver for it; the vendor's bit-banged driver ports to hardware
SPI in forty lines. The frame is two bits per pixel, four per byte, MSB first.
The one thing that bit: the vendor's ESP-IDF driver resets the panel with
50 ms / 20 ms / 50 ms and its Arduino example with 200 / 2 / 200. With the
short timing the controller ignored every command after reset — BUSY still
went idle (that was its own reset finishing), so it *looked* alive and the
refresh "finished" in 200 ms. The vendor's own Arduino sketch, flashed
unmodified with timestamps on its BUSY waits, was the thing that proved the
hardware and isolated the timing (a refresh is 13.9 s, power-on 100 ms).

**How to apply:** treat a refresh as an event, not a frame. Render to a
buffer, hash it, and refresh only when the hash changes, rate-limited; keep
the blocking BUSY wait in its own task so keys and the Net keep running; give
the keys a prompt refresh anyway, because a cursor you cannot see is not a
cursor. Edit the layout on the host (`make paper-preview`), not on the panel.

## Opening an S3's USB port resets it, even "passively"

**2026-08-23.** Doreen's port name changed after a USB re-plug
(`usbmodem1101` → `usbmodem201301`), so a port-watcher that excluded only the
old name reported her as the new board. A six-second *listen* with DTR and
RTS "off" to check whose firmware was talking rebooted her: the banner began
`rst:0x15 (USB_UART_CHIP_RESET)`. On macOS the host raises DTR/RTS when the
TTY opens, and pyserial clears them afterwards — DTR first — which is exactly
the S3 reset sequence. The creature-repo note that `dtr=off,rts=off` "catches
the boot banner" was describing this reset, not avoiding it.

**How to apply:** a board you must not disturb is a board whose port you
never open, for any reason. Identify ESP32-S3 boards from the USB descriptors
instead: the USB serial number is the MAC, and the port name comes from the
locationID (`firmware/tools/usb_mac.sh`). Never key a watcher on a port
*name*; key it on the MAC.

## A reset mid-I2C-transaction leaves a slave holding SDA; probe failures are the symptom, not the cause

**2026-08-23.** One boot in ten came up with "XCA9554 / CST820 / AXP2101 not
found" and ran blind all day — no touch, no battery — until a re-plug. It was
never the chips: a USB re-enumeration resets the S3 while a slave is mid-byte,
the slave keeps driving SDA low waiting for clocks that never come, and every
probe afterwards fails the same way. The bus-recovery sequence (clock SCL
until SDA releases, then STOP) logged `SDA was held low — clocked 3, now
released` on its first real boot, and everything was found on attempt 1.

**How to apply:** when several independent I2C devices vanish together, check
the bus, not the devices. Recover before `Wire.begin`, retry probes a few
times, and keep re-probing from the loop so a bad boot cannot stay bad. And
with two boards on USB, never let a Makefile guess the port.

## The potato goes on every screen

**2026-08-23.** I gave the e-paper board a newspaper layout because it has no
touch and no motion sensor, and the brief had a line about the e-paper being
"the press." Mike's verdict, holding it: "I want a potato on the screen — not
a newspaper." He was also right that a cursor moved one step per 15-second
refresh is unusable. The screen is the product's face; a constraint on a board
is a reason to draw the potato differently, not to replace it.

**How to apply:** every device shows the potato, one line, and choices. Design
input for the medium (press-count voting with LED feedback, one refresh) rather
than designing a different product for it.

## A blocking captive portal starves the idle task and the watchdog reboots the board

**2026-08-23.** The e-paper press "kept flashing" on its join page and every
portal save came back "network couldn't be reached". The owner's hypothesis
was a brown-out (panel refresh plus Wi-Fi TX on one small rail). A
three-minute untouched capture said otherwise: every reset was
`task_wdt: IDLE0 (CPU 0)` with the `net` task running — `RTC_SW_CPU_RST`,
not brownout. WiFiManager's blocking `autoConnect()` loop only `yield()`s,
and on FreeRTOS a yield from a priority-1 task never runs the priority-0 idle
task, which is what the task watchdog watches. With a phone attached
(`setAPClientCheck`) the loop got busier and the watchdog fired every ~40 s;
each reboot reprinted the page and killed the AP mid-save. The same code had
run for 75 s at a time without tripping, which is why it looked like
hardware.

**How to apply:** symbolize the backtrace (`xtensa-esp32s3-elf-addr2line -e
<sketch>.elf`) before theorizing about rails; print `esp_reset_reason()` in
the banner so the next capture names the cause. Drive WiFiManager
non-blocking (`setConfigPortalBlocking(false)` + `process()` with a
`vTaskDelay` between calls) so the task sleeps instead of spinning. And the
capture tool's own resets (`rst:0x15`) must be gone before counting resets,
or the diagnosis counts itself.

## The screen is the potato; the UI is the potato's, not a dashboard's

**2026-08-23.** The e-paper press shipped as a newspaper — masthead, headline,
two items, a cursor and a long press to vote — because the brief said it
"prints the paper". The owner, device in hand: "having trouble selecting on
the e-ink device. I want a potato on the screen — not a newspaper." Two
mistakes in one: the page put the Bulletin where the potato belongs (the
CLAUDE.md look rules apply to every surface), and a cursor on a panel that
takes fifteen seconds to redraw is an interaction that cannot be seen.

**How to apply:** on a slow panel, every interaction must complete in the
*next* refresh, never need one to be understood — count presses, blink the
count back on the LED, cast, print once. And before designing a second
device's screen, put the same potato on it first; the rest is typography.

## macOS does not lock a tty: esptool plus a serial capture on one port parks the chip

**2026-08-23.** To catch a boot banner I armed a pyserial capture on each
board's port and then ran `esptool … --before default_reset --after
hard_reset chip_id` on the same port. macOS let both processes open the tty,
esptool's reset sequence put each S3 into the ROM download mode, and the
closing hard reset did not take while the other process held DTR/RTS. Both
potatoes went silent — no serial, no heartbeats — for five minutes until a
clean `esptool` reset with nothing else on the port. The symptom is
indistinguishable from a crash except that the port still enumerates.

**How to apply:** one process per port, always. To capture a boot: attach the
capture first and reboot from inside (the firmware's serial `X`), or run
esptool first and attach after; never both at once. If a board goes quiet
right after a tool touched its port, reset it with esptool on a free port
before suspecting firmware.

## arduino-cli wipes --build-path when the flags change, and takes your log with it

**2026-08-23.** `make release` died with `grep: build/potato/compile.log: No
such file or directory` — yet the compile had *succeeded*. The recipe
redirected the compile output into the build path, and `release` and
`webflash` share that path while compiling with different flags (webflash
bakes in `SERVER_URL_DEFAULT`). When the recorded flags fingerprint doesn't
match, arduino-cli deletes everything in `--build-path` before rebuilding —
including foreign files, including a log the shell holds open. The redirect
keeps writing to the unlinked inode, the build finishes fine, and the file
simply isn't there afterwards. Proven by planting a marker file and changing
one `-D`: the marker vanished. The failure is one-shot — the next run's
fingerprint matches, so retrying "fixes" it, which is how it hides.

**How to apply:** never put anything you want to keep inside an arduino-cli
`--build-path`; write logs *next to* it (`build/<board>-compile.log`). When a
file that a just-succeeded command wrote is missing, suspect the tool that
owns the directory, not the command that wrote the file.

## A cloud CLI's delete-by-name plus --yes is a loaded gun; its list lags behind the truth

**2026-08-23.** Cleaning up a duplicate Railway project, `railway delete
--project Potatoes-Unite --yes` case-insensitively matched **potatoes-unite**
— the real, live project — and `--yes` had waived the only confirmation that
would have shown the resolution. Compounding it: `railway list` kept showing
already-deleted projects for minutes, so a "verify then retry" loop deleted
the survivor while believing it was deleting the ghost. (Recoverable only
because the project was fifteen minutes old and its database empty; the real
Net lives on the LAN.) The duplicate itself came from a third footgun: the
CLI's project link is per-directory, and `railway up` from an unlinked
directory silently creates a new project instead of erroring.

**How to apply:** destructive cloud-CLI calls go by immutable ID, never by
name, and never with the confirmation flag when any ambiguity exists — or
better, do deletes in the provider's dashboard where the target is visible.
Verify existence by probing the resource itself (link to the ID, curl the
URL), never by membership in a list endpoint, which may be eventually
consistent. And before `up`/`deploy` commands, confirm what the CLI thinks
the current directory is linked to.

## A recovery routine that can mask its own trigger reports success forever

**2026-08-24.** `i2cBusRecover()` had been in the firmware since 35c3107 and the
bug it fixes was still open in the plan — so it got re-reviewed, and the review
found it could lie. It opened with `pinMode(IIC_SCL, OUTPUT)` and only then
`digitalWrite(IIC_SCL, HIGH)`. `pinMode` never writes the output latch, and the
latch is LOW out of reset, so enabling the driver drove SCL low for the moment
before the write — and on a wedged I2C bus a low-then-high *is a clock pulse*.
If that stray pulse happened to be the one the stuck slave needed, SDA released
before the code sampled it, and a boot that genuinely needed recovery printed
`i2c: bus clear`. The routine worked and simultaneously erased the evidence
that it had been needed.

The correct order is not obvious: in esp32 core 3.x `digitalWrite` is gated on
`perimanGetPinBus(pin, ESP32_BUS_TYPE_GPIO) != NULL` (`cores/esp32/esp32-hal-gpio.c`)
and silently does nothing on a pin no `pinMode` has claimed. So preset-then-enable
only works as `INPUT_PULLUP` (claim) → `digitalWrite(HIGH)` (latch) → `OUTPUT`
(enable).

**How to apply:** when a routine both detects a fault and repairs it, check
whether any part of the repair can run *before* the detection. If it can, the
instrument reads clean exactly when the fault was real, and the bug looks fixed
whether or not it is. Separately: on the ESP32, treat "set the level, then
enable the driver" as a three-step sequence, never two — and never trust a
`digitalWrite` on a pin that has not been claimed.

## A reset storm kills the S3's USB console while the firmware keeps running

**2026-08-24.** Verifying the I2C bus-recovery fix meant reproducing "a reset
that lands mid-transaction", so the host drove the DTR/RTS reset sequence in a
loop — about 32 resets at roughly one every seven seconds. The test worked: in
15 scored boots the recovery fired three times (`SDA was held low at boot —
clocked 2 / 4 / 1, now released`) and no boot lost the expander, touch or PMU.
Then the console went silent. The device still enumerated (`ioreg` showed the
MAC and "USB JTAG_serial debug unit"), the port node was recreated, the panel
still rendered and the potato still reacted to handling — but 75 s of handling
produced **zero serial bytes**, and a fresh open with DTR raised produced
nothing. The HWCDC console had died; the firmware had not.

Two things this cost: an hour chasing a phantom "she's dozing on USB" bug that
the silence looked exactly like, and the ability to read `i` — the very command
added so a running potato could report its boot verdict.

**How to apply:** a reset loop against the S3's native USB CDC needs to let the
host fully re-enumerate between resets — seconds, not one second — and should
stop after a batch rather than run tens of iterations. When a board goes quiet
but still enumerates, do not assume a firmware state (sleep, hang, crash):
check whether the *console* died by looking for evidence the app is alive
elsewhere — the panel, the network, the server's heartbeat record. Recovery is
a real power cycle; with a battery attached USB is not the power switch, so it
takes a PWR long-press (~6 s), not a replug.

## A stopped LAN server can be the symptom while the saved LAN URL is the defect

**2026-08-30.** Doreen showed `Net unreachable`; live serial correctly proved
that Wi-Fi and power were healthy and that no LAN server answered. I stopped
at “start the local server,” but the owner corrected the premise: Doreen is a
public citizen and should use the same full online Net as everyone else.

**How to apply:** always compare a citizen's configured URL with its intended
deployment role. For a public citizen, `http://potatoes.local:8080` or a LAN IP
is itself a configuration defect even when starting a local server would make
the heartbeat green. Repair the saved URL to the verified public HTTPS Net,
preserve identity/Wi-Fi/queued events, and prove the public heartbeat.

## An NVS-preserving flash still destroys a RAM event queue

**2026-08-30.** Doreen had 32 events held while her configured Net was
unreachable. I correctly preserved the NVS partition during the public URL
migration, but flashed before checking where the event queue lived. It was a
RAM `EventQueue`, so the reset discarded all 32 events even though her secret,
identity, claim, Wi-Fi, and cached scene survived.

**How to apply:** before any reset, upload, OTA, or power cycle during a Net
migration, send serial `e` and trace the queue's storage. If it is non-empty
and RAM-only, do not reset. Change the live URL through the captive portal or
another no-reset path, get an HTTP 200 heartbeat, and verify the queue drains
before touching firmware.
