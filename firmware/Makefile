FQBN   ?= esp32:esp32:esp32s3:PSRAM=opi,CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=huge_app
SKETCH ?= potato
# Match usbmodem/usbserial only. A bare /dev/cu.* match picks up
# cu.Bluetooth-Incoming-Port and fails the upload with a confusing error.
PORT   ?= $(shell arduino-cli board list 2>/dev/null | awk '/^\/dev\/cu\.(usbmodem|usbserial|wchusbserial|SLAB)/ {print $$1; exit}')

.PHONY: build upload monitor ports libs marble-sim come-here-sim clean

# Arduino_GFX chunks QSPI transfers into ESP32QSPI_MAX_PIXELS_AT_ONCE-pixel
# pieces, defaulting to 1024 — a 2KB staging memcpy plus a transaction setup per
# chunk. Measured on hardware, that put the blit at 8.3MB/s against a 20MB/s
# ceiling. Raising it to 4096 cuts the transaction count fourfold.
#
# This must be a build property, not a #define in the .ino: Arduino compiles
# library sources separately from the sketch, so a sketch-level define never
# reaches Arduino_ESP32QSPI.cpp.
EXTRA_FLAGS ?= -DESP32QSPI_MAX_PIXELS_AT_ONCE=4096

build:
	arduino-cli compile --fqbn $(FQBN) --build-property "compiler.cpp.extra_flags=$(EXTRA_FLAGS)" $(SKETCH)

upload: build
	@test -n "$(PORT)" || { echo "No serial port found. Plug the board in, or pass PORT=/dev/cu.usbmodemXXXX"; exit 1; }
	arduino-cli upload -p $(PORT) --fqbn $(FQBN) $(SKETCH)

# The ESP32-S3 has no USB-serial chip — the USB CDC is the chip itself. DTR and
# RTS are wired to the reset/boot sequence, so a monitor that asserts them can
# park the chip instead of talking to it: the port still enumerates, and you get
# silence. Leave both off.
MONITOR_CFG ?= baudrate=115200,dtr=off,rts=off

monitor:
	@test -n "$(PORT)" || { echo "No serial port found."; exit 1; }
	arduino-cli monitor -p $(PORT) -c $(MONITOR_CFG)

# Old behaviour, in case a future board actually needs the lines asserted.
monitor-dtr:
	@test -n "$(PORT)" || { echo "No serial port found."; exit 1; }
	arduino-cli monitor -p $(PORT) -c baudrate=115200

ports:
	arduino-cli board list

marble-sim:
	$(CXX) -std=c++11 -Wall -Wextra -pedantic prototypes/marble_physics.cpp -o /tmp/creature-marble-sim
	/tmp/creature-marble-sim

come-here-sim:
	$(CXX) -std=c++11 -Wall -Wextra -pedantic prototypes/come_here.cpp -o /tmp/creature-come-here-sim
	/tmp/creature-come-here-sim

# Vendor libraries live in the gitignored reference clone. Re-run after a fresh
# clone, or on a new machine. Arduino_CO5300 exists only in Waveshare's fork of
# GFX_Library_for_Arduino, so never install that one from the Library Manager.
# XPowersLib is pinned in the original-revision Arduino library tree; the V2
# examples reuse it rather than carrying another copy.
libs:
	@set -e; \
	SKB=$$(arduino-cli config get directories.user); \
	mkdir -p "$$SKB/libraries"; \
	for L in GFX_Library_for_Arduino SensorLib Adafruit_XCA9554 Adafruit_BusIO; do \
	  cp -R $(HOME)/Developer/ESP32-S3/reference/waveshare/examples/arduino-v2/libraries/$$L "$$SKB/libraries/" && echo "installed $$L"; \
	done; \
	cp -R $(HOME)/Developer/ESP32-S3/reference/waveshare/examples/arduino/libraries/XPowersLib "$$SKB/libraries/" && echo "installed XPowersLib"

clean:
	rm -rf build/
