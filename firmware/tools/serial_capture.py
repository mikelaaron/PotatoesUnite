#!/usr/bin/env python3
"""Capture serial from the S3 for N seconds without asserting DTR or RTS.

    python3 firmware/tools/serial_capture.py [port] [seconds] [logfile] [keys]

`keys` is an optional script like "3:q,2:t,2:k" — wait 3s then send 'q',
wait 2s then send 't', ... — for the firmware's serial dev commands.

Needs pyserial (`pip install pyserial`). The S3's USB CDC is the chip itself:
DTR/RTS feed its reset sequence (reset = RTS asserted while DTR is not). On
macOS the TTY open raises both lines, and pyserial then applies its presets
DTR first — so "dtr=False, rts=False set before open" still produced the
exact reset sequence and every capture began with `rst:0x15
(USB_UART_CHIP_RESET)`. The order here never passes through RTS-high/DTR-low:
dsrdtr=True keeps pyserial's hands off DTR at open (it stays high), rts=False
is applied at open (RTS low while DTR is still high: not a reset), and DTR is
dropped afterwards. Listening never resets the board. Reopens while the port
re-enumerates after an upload, so a boot banner can still be caught.
`arduino-cli monitor` cannot be used for this: it needs a TTY and prints
nothing through a pipe.
"""
import sys, time
import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbmodem2101"
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 20
log = sys.argv[3] if len(sys.argv) > 3 else "/tmp/potato-serial.log"
script = []
if len(sys.argv) > 4 and sys.argv[4]:
    t = 0.0
    for step in sys.argv[4].split(","):
        delay, key = step.split(":", 1)
        t += float(delay)
        script.append((t, key))
start = time.time()
end = start + secs
out = open(log, "wb")
while time.time() < end:
    s = serial.Serial()          # no port yet: nothing is opened
    s.baudrate, s.timeout = 115200, 0.2
    s.dsrdtr = True              # leave DTR alone at open (macOS raises it)
    s.rts = False                # applied at open: RTS low while DTR is high
    s.dtr = False                # recorded; applied below, after RTS is low
    s.port = port
    try:
        s.open()
        s.dtr = False            # now both low; no reset at any step
    except serial.SerialException:
        time.sleep(0.1)
        continue
    try:
        while time.time() < end:
            if script and time.time() - start >= script[0][0]:
                _, key = script.pop(0)
                s.write(key.encode()); s.flush()
                out.write(("\n>>> sent '%s'\n" % key).encode())
            data = s.read(4096)
            if data:
                out.write(data); out.flush()
                sys.stdout.write(data.decode(errors="replace")); sys.stdout.flush()
    except serial.SerialException:
        pass
    finally:
        s.close()
out.close()
