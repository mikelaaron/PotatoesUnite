# PartitionScheme=custom: the core copies <sketch>/partitions.csv into the
# build (platform.txt prebuild hook 3). potato/partitions.csv is frozen.
# Slot size is 3 MB (0x300000); the "Sketch uses" line reports against the
# custom scheme's 16 MB, so check headroom against 3145728 yourself.
FQBN   ?= esp32:esp32:esp32s3:PSRAM=opi,CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=custom
SKETCH ?= potato
# Match usbmodem/usbserial only. A bare /dev/cu.* match picks up
# cu.Bluetooth-Incoming-Port and fails the upload with a confusing error.
# Auto-detect only when exactly one candidate is plugged in. With two boards
# on USB (the potato and the e-paper press) the first match is whichever
# enumerated first, which is how you flash the wrong device. Then pass PORT=.
# Map a board to its port with: ioreg -p IOUSB -l -w0 (USB Serial Number ->
# locationID; 0x20130000 -> /dev/cu.usbmodem201301).
CANDIDATES := $(shell arduino-cli board list 2>/dev/null | awk '/^\/dev\/cu\.(usbmodem|usbserial|wchusbserial|SLAB)/ {print $$1}')
PORT   ?= $(if $(filter 1,$(words $(CANDIDATES))),$(CANDIDATES),)

.PHONY: build upload monitor ports libs marble-sim come-here-sim clean release

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
	@test -n "$(PORT)" || { echo "No single serial port to pick ($(words $(CANDIDATES)) candidates: $(CANDIDATES)). Pass PORT=/dev/cu.usbmodemXXXX explicitly."; exit 1; }
	arduino-cli upload -p $(PORT) --fqbn $(FQBN) $(SKETCH)

# The ESP32-S3 has no USB-serial chip — the USB CDC is the chip itself. DTR and
# RTS are wired to the reset/boot sequence, so a monitor that asserts them can
# park the chip instead of talking to it: the port still enumerates, and you get
# silence. Leave both off.
MONITOR_CFG ?= baudrate=115200,dtr=off,rts=off

monitor:
	@test -n "$(PORT)" || { echo "No single serial port to pick ($(words $(CANDIDATES)) candidates: $(CANDIDATES)). Pass PORT= explicitly."; exit 1; }
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

# ------------------------------------------------------------- paper ---
# The e-paper press (firmware/paper): Waveshare ESP32-S3-ePaper-1.54G,
# ESP32-S3-PICO-1-N8R8 — 8 MB flash, OPI PSRAM, USB CDC (the vendor's IDE
# settings). Two boards share this Mac, so paper-upload/monitor refuse to
# guess a port: pass PORT=/dev/cu.usbmodemXXXX on the command line, and the
# upload first reads the chip's MAC and refuses the AMOLED potato's.
# paper/partitions.csv (frozen): two 2.5 MB OTA slots (0x280000 each).
PAPER_FQBN ?= esp32:esp32:esp32s3:PSRAM=opi,CDCOnBoot=cdc,FlashSize=8M,PartitionScheme=custom
PAPER_ROTATE ?= 0
PAPER_HW_SPI ?= 1
DOREEN_MAC ?= 28:84:85:90:b4:58

.PHONY: paper-build paper-upload paper-monitor paper-mac paper-preview paper-portrait

paper-build:
	arduino-cli compile --fqbn $(PAPER_FQBN) --build-property "compiler.cpp.extra_flags=-DEPD_ROTATE_180=$(PAPER_ROTATE) -DEPD_HW_SPI=$(PAPER_HW_SPI)" paper

# Explicit PORT only: `make paper-upload PORT=/dev/cu.usbmodem2101`. The MAC
# comes from the USB descriptors (tools/usb_mac.sh), never by opening the
# port: opening an S3's USB CDC on macOS resets it, and Doreen must not be
# reset. Port names change across re-plugs; MACs do not.
paper-port-check:
	@[ "$(origin PORT)" = "command line" ] || { echo "paper-upload/monitor need an explicit PORT=/dev/cu.usbmodemXXXX on the command line (never the AMOLED's)"; exit 1; }
	@MAC=$$(tools/usb_mac.sh $(PORT) | tr 'A-F' 'a-f'); \
	[ -n "$$MAC" ] || { echo "no Espressif USB device behind $(PORT)"; exit 1; }; \
	echo "port $(PORT) is MAC $$MAC"; \
	[ "$$MAC" != "$(DOREEN_MAC)" ] || { echo "REFUSING: $(PORT) is Doreen (the AMOLED potato)"; exit 1; }

# The MAC behind PORT, from USB descriptors (does not touch the port).
paper-mac:
	@tools/usb_mac.sh $(PORT)

paper-upload: paper-build paper-port-check
	arduino-cli upload -p $(PORT) --fqbn $(PAPER_FQBN) paper

paper-monitor: paper-port-check
	arduino-cli monitor -p $(PORT) -c $(MONITOR_CFG)

# Render the page on the host (no hardware): writes /tmp/paper-*.ppm/.png.
paper-preview:
	$(CXX) -std=c++11 -Wall -Wextra -I paper tools/paper_preview.cpp -o /tmp/paper_preview
	/tmp/paper_preview /tmp/paper
	for s in morning evening incident question nonet; do python3 tools/ppm2png.py /tmp/paper-$$s.ppm; done

paper-portrait:
	python3 tools/make_portrait.py > paper/portrait.h

# ----------------------------------------------------------- release ---
# make release BOARD=potato|paper — builds the board's app .bin and copies it
# to server/data/releases/<board-id>/<version>.bin (board ids: amoled18,
# epaper154; version from <board>/version.h), printing size and sha256.
# Then the server agent's `npm run release -- <id> <bin> <version> "notes"`
# writes the manifest /v0/firmware serves. Never flash a release by USB to
# test OTA; that is what OTA is for.
RELEASE_DIR ?= $(CURDIR)/../server/data/releases

release:
	@test -n "$(BOARD)" || { echo "usage: make release BOARD=potato|paper"; exit 1; }
	@set -e; \
	case "$(BOARD)" in \
	  potato) ID=amoled18; FQ="$(FQBN)"; FLAGS="$(EXTRA_FLAGS)"; SLOT=3145728;; \
	  paper)  ID=epaper154; FQ="$(PAPER_FQBN)"; FLAGS="-DEPD_ROTATE_180=$(PAPER_ROTATE) -DEPD_HW_SPI=$(PAPER_HW_SPI)"; SLOT=2621440;; \
	  *) echo "BOARD must be potato or paper"; exit 1;; \
	esac; \
	VER=$$(sed -n 's/.*#define FW_VERSION "\(.*\)".*/\1/p' $(BOARD)/version.h); \
	[ -n "$$VER" ] || { echo "no FW_VERSION in $(BOARD)/version.h"; exit 1; }; \
	BP=$(CURDIR)/build/$(BOARD); mkdir -p $$BP; \
	arduino-cli compile --fqbn $$FQ --build-property "compiler.cpp.extra_flags=$$FLAGS" --build-path $$BP $(BOARD) > $$BP/compile.log 2>&1 || { tail -30 $$BP/compile.log; exit 1; }; \
	grep "Sketch uses" $$BP/compile.log; \
	OUT=$(RELEASE_DIR)/$$ID; mkdir -p $$OUT; cp $$BP/$(BOARD).ino.bin $$OUT/$$VER.bin; \
	SIZE=$$(stat -f%z $$OUT/$$VER.bin); SHA=$$(shasum -a 256 $$OUT/$$VER.bin | cut -d' ' -f1); \
	[ $$SIZE -le $$SLOT ] || { echo "TOO BIG: $$SIZE > slot $$SLOT"; exit 1; }; \
	echo "release: $$OUT/$$VER.bin"; \
	echo "board:   $$ID  version: $$VER"; \
	echo "size:    $$SIZE bytes ($$((SIZE * 100 / SLOT))% of the $$SLOT-byte slot)"; \
	echo "sha256:  $$SHA"; \
	echo "next:    cd ../server && npm run release -- $$ID data/releases/$$ID/$$VER.bin $$VER \"notes\""
