# Lessons

Patterns worth not repeating. Added after corrections.

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
