#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <time.h>
#include "board_pins.h"

// The senses this board has: an SHTC3 (temperature, humidity) and a PCF85063
// RTC on the I2C bus, and the battery through a 200K/200K divider on GP4.
// Written against the datasheets rather than a library so the two Waveshare
// boards do not pin different SensorLib versions. The charger (ETA6098) has
// no digital interface: its STAT pin lights an LED and nothing else.

static const uint8_t SHTC3_ADDR = 0x70;
static const uint8_t PCF85063_ADDR = 0x51;

// The vendor example subtracts 4 °C for self-heating on this board (its
// SHTC3_PETP_NUM). Reported raw in the banner; the heartbeat carries the
// compensated value.
static const float SHTC3_BOARD_HEAT_C = 4.0f;

static uint8_t shtCrc8(const uint8_t *d, int n) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < n; ++i) {
    crc ^= d[i];
    for (int b = 0; b < 8; ++b) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
  }
  return crc;
}

static bool shtc3Cmd(uint16_t c) {
  Wire.beginTransmission(SHTC3_ADDR);
  Wire.write((uint8_t)(c >> 8));
  Wire.write((uint8_t)(c & 0xFF));
  return Wire.endTransmission() == 0;
}

// ID register: bits 11 and 5..0 are 0x0807 on an SHTC3.
static bool shtc3Probe(uint16_t *id) {
  if (!shtc3Cmd(0x3517)) return false;   // wake
  delay(1);
  if (!shtc3Cmd(0xEFC8)) return false;   // read ID
  delay(1);
  if (Wire.requestFrom(SHTC3_ADDR, (uint8_t)3) != 3) return false;
  uint8_t b[3];
  for (int i = 0; i < 3; ++i) b[i] = (uint8_t)Wire.read();
  if (shtCrc8(b, 2) != b[2]) return false;
  *id = (uint16_t)((b[0] << 8) | b[1]);
  shtc3Cmd(0xB098);                      // sleep
  return (*id & 0x083F) == 0x0807;
}

// Normal mode, temperature first, clock stretching off (0x7866), then poll.
static bool shtc3Read(float *tempC, float *rh) {
  if (!shtc3Cmd(0x3517)) return false;
  delay(1);
  if (!shtc3Cmd(0x7866)) return false;
  delay(15);
  uint8_t b[6];
  int got = 0;
  for (int tries = 0; tries < 5 && got != 6; ++tries) {
    got = Wire.requestFrom(SHTC3_ADDR, (uint8_t)6);
    if (got != 6) { while (Wire.available()) Wire.read(); delay(5); }
  }
  if (got != 6) { shtc3Cmd(0xB098); return false; }
  for (int i = 0; i < 6; ++i) b[i] = (uint8_t)Wire.read();
  shtc3Cmd(0xB098);
  if (shtCrc8(b, 2) != b[2] || shtCrc8(b + 3, 2) != b[5]) return false;
  const uint16_t rt = (uint16_t)((b[0] << 8) | b[1]);
  const uint16_t rr = (uint16_t)((b[3] << 8) | b[4]);
  *tempC = 175.0f * rt / 65536.0f - 45.0f;
  *rh = 100.0f * rr / 65536.0f;
  return true;
}

// ---------------------------------------------------------------- PCF85063 ---

static inline uint8_t bcd2bin(uint8_t v) { return (uint8_t)((v >> 4) * 10 + (v & 0x0F)); }
static inline uint8_t bin2bcd(uint8_t v) { return (uint8_t)(((v / 10) << 4) | (v % 10)); }

// UTC. False if the chip is absent or its oscillator-stopped flag is set
// (first power-up, or the clock was lost), or the year is before 2024.
static bool rtcRead(struct tm *out) {
  Wire.beginTransmission(PCF85063_ADDR);
  Wire.write(0x04);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(PCF85063_ADDR, (uint8_t)7) != 7) return false;
  uint8_t r[7];
  for (int i = 0; i < 7; ++i) r[i] = (uint8_t)Wire.read();
  if (r[0] & 0x80) return false;           // OS: oscillator stopped
  memset(out, 0, sizeof(*out));
  out->tm_sec = bcd2bin(r[0] & 0x7F);
  out->tm_min = bcd2bin(r[1] & 0x7F);
  out->tm_hour = bcd2bin(r[2] & 0x3F);
  out->tm_mday = bcd2bin(r[3] & 0x3F);
  out->tm_wday = r[4] & 0x07;
  out->tm_mon = bcd2bin(r[5] & 0x1F) - 1;
  out->tm_year = 100 + bcd2bin(r[6]);
  return out->tm_year >= 124 && out->tm_mon >= 0 && out->tm_mon < 12 && out->tm_mday >= 1;
}

static bool rtcWrite(const struct tm &t) {
  Wire.beginTransmission(PCF85063_ADDR);
  Wire.write(0x04);
  Wire.write(bin2bcd((uint8_t)t.tm_sec) & 0x7F);   // clears OS
  Wire.write(bin2bcd((uint8_t)t.tm_min));
  Wire.write(bin2bcd((uint8_t)t.tm_hour));
  Wire.write(bin2bcd((uint8_t)t.tm_mday));
  Wire.write((uint8_t)t.tm_wday);
  Wire.write(bin2bcd((uint8_t)(t.tm_mon + 1)));
  Wire.write(bin2bcd((uint8_t)(t.tm_year - 100)));
  return Wire.endTransmission() == 0;
}

static bool rtcPresent() {
  Wire.beginTransmission(PCF85063_ADDR);
  return Wire.endTransmission() == 0;
}

// ----------------------------------------------------------------- battery ---

static float batteryVolts() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; ++i) mv += analogReadMilliVolts(BAT_ADC_PIN);
  return (mv / 16) * 2 / 1000.0f;
}

// Open-circuit voltage of a single LiPo cell, roughly. It is a guess between
// the points; the potato reports it without comment.
static int batteryPct(float v) {
  static const float V[] = {3.30f, 3.40f, 3.50f, 3.60f, 3.70f, 3.80f, 3.90f, 4.00f, 4.10f, 4.20f};
  static const int P[] = {0, 2, 5, 10, 25, 45, 62, 78, 90, 100};
  if (v <= V[0]) return 0;
  if (v >= V[9]) return 100;
  for (int i = 1; i < 10; ++i) {
    if (v < V[i]) return P[i - 1] + (int)((v - V[i - 1]) / (V[i] - V[i - 1]) * (P[i] - P[i - 1]) + 0.5f);
  }
  return 100;
}
