#pragma once

#include <Arduino.h>
#include <SPI.h>
#include "HWCDC.h"
#include "board_pins.h"

// The 1.54" G panel (200x200, black/white/yellow/red), ported from Waveshare's
// EPD_1in54g.cpp (Example/Arduino_3.2.0/08_E_paper_test) onto hardware SPI.
// Same register sequence, same frame format: two bits per pixel, four per
// byte MSB first, 0 black 1 white 2 yellow 3 red, 50 bytes per row.
//
// A refresh is: hardware reset (the panel sleeps between refreshes), init,
// 0x10 + 10 000 bytes, 0x12 (refresh), wait for BUSY, power off, deep sleep.
// The wait is the 15-20 s; there is no partial refresh on this panel.
//
// BUSY is LOW while busy. The vendor comment says "LOW: idle, HIGH: busy" but
// the vendor code waits while the pin is LOW; the code is right.

// EPD_HW_SPI 1: the FSPI peripheral at 8 MHz. 0: bit-banged like the vendor's
// Arduino example (~1 µs a bit; a frame is ~100 ms, nothing next to the
// 15 s refresh).
#ifndef EPD_HW_SPI
#define EPD_HW_SPI 1
#endif

extern HWCDC USBSerial;

class Epd154g {
 public:
  static const int W = 200, H = 200, BYTES = 200 * 200 / 4;

  bool hwSpi = false;

  void begin() {
    pinMode(EPD_BUSY_PIN, INPUT);
    pinMode(EPD_RST_PIN, OUTPUT);
    pinMode(EPD_DC_PIN, OUTPUT);
    pinMode(EPD_CS_PIN, OUTPUT);
    digitalWrite(EPD_CS_PIN, HIGH);
    digitalWrite(EPD_RST_PIN, HIGH);
#if EPD_HW_SPI
    spi_ = new SPIClass(FSPI);
    hwSpi = spi_->begin(EPD_SCK_PIN, -1, EPD_MOSI_PIN, -1);
    if (!hwSpi) USBSerial.println("epd: FSPI begin failed — bit-banging instead");
#endif
    if (!hwSpi) {
      pinMode(EPD_SCK_PIN, OUTPUT);
      pinMode(EPD_MOSI_PIN, OUTPUT);
      digitalWrite(EPD_SCK_PIN, LOW);
    }
  }

  bool busy() const { return digitalRead(EPD_BUSY_PIN) == LOW; }

  // Wake, load, refresh, sleep. Blocks. Returns the ms the refresh took, or
  // a negative number if BUSY never released (the panel is then reset and
  // left asleep).
  long show(const uint8_t *frame) {
    const uint32_t t0 = millis();
    init();
    cmd(0x10);
    dataN(frame, BYTES);
    cmd(0x12);
    data(0x00);
    // The panel takes a moment to pull BUSY low after the refresh command;
    // polling too early sees it still idle and "finishes" in 200 ms (seen on
    // first bring-up). Wait for it to go busy, then for it to release.
    const bool wentBusy = waitBusy(3000);
    const bool ok = waitIdle(45000);
    sleep();
    lastWentBusy = wentBusy;
    return ok ? (long)(millis() - t0) : -(long)(millis() - t0);
  }

  bool lastWentBusy = false;   // false means the panel never acknowledged the refresh

  // White the panel. Same cost as a refresh.
  long clear() {
    static uint8_t row[50];
    memset(row, 0x55, sizeof(row));
    const uint32_t t0 = millis();
    init();
    cmd(0x10);
    for (int y = 0; y < H; ++y) dataN(row, sizeof(row));
    cmd(0x12);
    data(0x00);
    const bool ok = waitIdle(45000);
    sleep();
    return ok ? (long)(millis() - t0) : -(long)(millis() - t0);
  }

 private:
  SPIClass *spi_ = nullptr;

  // The vendor's Arduino timing. With 50/20/50 (the vendor's ESP-IDF
  // driver) the controller ignored every command that followed: BUSY idled
  // after its own reset and no refresh ever started. 200 ms after release
  // before the first register write is what makes it listen.
  void reset() {
    digitalWrite(EPD_RST_PIN, HIGH); delay(200);
    digitalWrite(EPD_RST_PIN, LOW);  delay(2);
    digitalWrite(EPD_RST_PIN, HIGH); delay(200);
  }
  void xfer(const uint8_t *p, size_t n) {
    if (hwSpi) {
      spi_->beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
      digitalWrite(EPD_CS_PIN, LOW);
      spi_->writeBytes(p, n);
      digitalWrite(EPD_CS_PIN, HIGH);
      spi_->endTransaction();
      return;
    }
    // Vendor style: CS around every byte, clock idle low, data on the rise.
    for (size_t i = 0; i < n; ++i) {
      uint8_t b = p[i];
      digitalWrite(EPD_CS_PIN, LOW);
      for (int k = 0; k < 8; ++k) {
        digitalWrite(EPD_MOSI_PIN, (b & 0x80) ? HIGH : LOW);
        b <<= 1;
        digitalWrite(EPD_SCK_PIN, HIGH);
        digitalWrite(EPD_SCK_PIN, LOW);
      }
      digitalWrite(EPD_CS_PIN, HIGH);
    }
  }
  void cmd(uint8_t c) { digitalWrite(EPD_DC_PIN, LOW); xfer(&c, 1); }
  void data(uint8_t d) { digitalWrite(EPD_DC_PIN, HIGH); xfer(&d, 1); }
  void dataN(const uint8_t *p, size_t n) { digitalWrite(EPD_DC_PIN, HIGH); xfer(p, n); }

  bool waitIdle(uint32_t timeoutMs) {
    const uint32_t t0 = millis();
    delay(100);                          // as the vendor's ReadBusyH
    while (busy()) {
      if (millis() - t0 > timeoutMs) return false;
      delay(10);
    }
    return true;
  }

  bool waitBusy(uint32_t timeoutMs) {
    const uint32_t t0 = millis();
    while (!busy()) {
      if (millis() - t0 > timeoutMs) return false;
      delay(2);
    }
    return true;
  }

  void init() {
    reset();
    cmd(0x4D); data(0x78);
    cmd(0x00); data(0x0F); data(0x29);                       // PSR
    cmd(0x06); data(0x0D); data(0x12); data(0x30); data(0x20); data(0x19); data(0x2A); data(0x22);  // BTST_P
    cmd(0x50); data(0x37);                                   // CDI
    cmd(0x61); data(W / 256); data(W % 256); data(H / 256); data(H % 256);   // TRES
    cmd(0xE9); data(0x01);
    cmd(0x30); data(0x08);
    cmd(0x04);                                               // power on
    waitBusy(500);
    if (!waitIdle(5000)) USBSerial.println("epd: power-on never released BUSY");
  }

  void sleep() {
    cmd(0x02); data(0x00);                                   // power off
    waitIdle(5000);
    cmd(0x07); data(0xA5);                                   // deep sleep; reset wakes it
  }
};

// The page is drawn upright; the panel may be mounted the other way.
static void rotate180(const uint8_t *in, uint8_t *out) {
  for (int y = 0; y < 200; ++y) {
    for (int x = 0; x < 200; ++x) {
      const uint8_t c = (in[y * 50 + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
      const int ox = 199 - x, oy = 199 - y;
      uint8_t &b = out[oy * 50 + (ox >> 2)];
      const int sh = 6 - 2 * (ox & 3);
      b = (uint8_t)((b & ~(3 << sh)) | (c << sh));
    }
  }
}
