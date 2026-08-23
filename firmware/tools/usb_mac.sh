#!/bin/bash
# Print the MAC (USB serial number) of the Espressif ESP32-S3 behind a
# /dev/cu.usbmodemXXXX port, from the USB descriptors — without opening the
# port. Opening an S3's native USB CDC on macOS resets it (the host raises
# DTR/RTS on open before anything can clear them), so this is the only safe
# way to tell two potatoes apart. Usage: usb_mac.sh /dev/cu.usbmodem201301
# macOS names the port from the locationID: 0x20130000 -> usbmodem2013 + 01.
port="$1"
suffix="${port#/dev/cu.usbmodem}"
[ "$suffix" != "$port" ] || { echo "not a usbmodem port: $port" >&2; exit 1; }
want="${suffix%01}"
ioreg -p IOUSB -l -w0 | awk -v want="$want" '
  /^[ |]*\+-o .*@[0-9a-f]+/ {            # a device node: "+-o Name@02100000  <class ...>"
    flush(); node=$0; sub(/ *<.*/, "", node); sub(/.*@/, "", node); loc=node
  }
  /"USB Vendor Name" = "Espressif"/ { esp=1 }
  /"USB Serial Number" =/ { gsub(/"/, "", $NF); ser=$NF }
  function flush() {
    if (esp && loc != "") { hex=loc; sub(/0+$/, "", hex); sub(/^0+/, "", hex); if (hex == want) { print ser; found=1 } }
    esp=0; loc=""; ser=""
  }
  END { flush(); exit found ? 0 : 2 }'
