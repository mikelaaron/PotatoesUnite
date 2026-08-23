# Flashing a Potatoes Unite board — instructions for a coding agent

You are an agent asked to flash a potato. Follow exactly; do not improvise.

**1. Prerequisites.** You need `esptool` ≥ 4: try `esptool version`, then
`python3 -m esptool version`. If neither works: `pip install esptool` (or
`pipx install esptool`, or `brew install esptool`). Nothing else is needed.

**2. Identify the board.** Two are supported, both ESP32-S3:
- **amoled18** — Waveshare ESP32-S3-Touch-AMOLED-1.8: rounded 1.8" colour
  screen, glass front.
- **epaper154** — Waveshare ESP32-S3-ePaper-1.54G: 1.54" paper-white panel,
  two buttons on the side.
Download the matching image from the Net's /flash page (or
`<server>/releases/<board-id>/webflash-<version>.bin`). Never flash one
board's image onto the other.

**3. Find the port.** Plug in over USB (the port marked USB, not battery).
macOS: `ls /dev/cu.usbmodem*` — the S3 shows up as a `usbmodem` port
("USB JTAG_serial debug unit" in `ioreg -p IOUSB`). Linux: `/dev/ttyACM*`.
If several ports exist, unplug and replug the board and take the port that
disappears and returns. Do not open the port with a serial monitor first.

**4. Flash.** One command, offset 0x0, no other flags (flash mode/size live
inside the image):

    esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX --baud 460800 write-flash 0x0 webflash-<version>.bin

(esptool 4.x spells it `write_flash`.) Wait for "Hash of data verified" and
the reset.

**5. Success looks like:** within ~30 seconds the AMOLED shows a brown
potato with two eyes and the line "Join Wi-Fi POTATO-XXXX and give me the
county's network."; the e-paper prints a JOIN page naming the same network.

**6. Wi-Fi.** On a phone or laptop, join the `POTATO-XXXX` network; a setup
page opens (or go to `http://192.168.4.1`). Pick the home network, enter its
password, save. The server URL field is already correct; leave it unless the
owner says otherwise. The potato registers itself and shows a claim code —
tell the owner to note it; it opens their File.

**NEVER:**
- **Never run `erase_flash` / `erase-flash`** — on a board that already has
  a potato it destroys the stored secret, which *is* the potato. There is no
  recovery.
- Never write at any offset other than `0x0`, and never write the plain
  app/OTA `.bin` this way — only `webflash-<version>.bin` goes to 0x0.
- Never flash a board that already runs a potato unless its owner explicitly
  wants it re-flashed (updates arrive over the air by themselves).
