#pragma once

// The doze — what the potato does with the hours nobody is watching.
//
// 23 Aug: the Mac's USB port slept at 03:40, Doreen ran on the cell, hit 5%
// at 06:13 and was dormant by 06:23. Two and a half hours out of a 400 mAh
// cell is about 130 mA, and the panel had already been dark since 03:42.
// What was still burning it: the CPU at 240 MHz spinning a 33 Hz idle loop,
// Wi-Fi associated all night, and the QMI8658 running its accelerometer at
// 1000 Hz and its gyroscope at 224 Hz to watch a desk nobody was going to
// touch until morning.
//
// The doze puts all three down. The watch is handed to the QMI8658's own
// wake-on-motion engine — the sensor decides, in hardware, at tens of
// microamps — the Net stands down, and the ESP32 light-sleeps. Every fifteen
// minutes it brings Wi-Fi up for one heartbeat and goes straight back down,
// so the server never sees the six-hour silence that would file the potato
// as dormant (docs/PROTOCOL.md: `Dormant = no heartbeat for 6 h`).
//
// Light sleep, not deep. Deep sleep would come back through setup() with
// every float in this firmware reset — the session, the noise floor, the
// arousal, the dark's episode clock — and would look to the potato exactly
// like a reboot, which is the one thing a night's sleep is not. Light sleep
// keeps RAM, keeps the peripherals configured, and (ESP-IDF advances
// esp_timer from the RTC on wake) keeps millis() telling the truth across
// the gap, so every millis()-keyed clock in potato.ino stays correct.
//
// It never dozes on VBUS. That gate reads the debounced power state, never
// the raw bit — see tasks/lessons.md, "A threshold that reads an
// instantaneous sensor fires on contact bounce".

#include <stdint.h>
#include <stddef.h>
#include <Arduino.h>
#include "HWCDC.h"
#include "SensorQMI8658.hpp"
#include "esp_sleep.h"
#include "driver/gpio.h"
#include "board_pins.h"

extern HWCDC USBSerial;

// ------------------------------------------------------------- the policy ---

// The owner's spec, 23 Aug: "after 30 min idle or 23:00-06:00 local, panel
// off, Wi-Fi off, light sleep, wake every 15 min to heartbeat and on
// QMI8658 motion interrupt."
static const float    DOZE_IDLE_S       = 1800.0f;   // 30 minutes untouched
// At night the potato has already closed its eyes at five idle minutes
// (the nightAsleep pose in potato.ino). That is the moment it goes quiet
// too; sleeping mid-handling because a clock struck 23:00 would be wrong.
static const float    DOZE_NIGHT_IDLE_S = 300.0f;
static const uint32_t DOZE_BEAT_MS      = 900000UL;  // one heartbeat every 15 min

// Sleep in slices rather than one long stretch. Two reasons: a slice is how
// often VBUS gets looked at (the Hands plugging it in at 3am must be
// noticed), and no slice may outlast the task watchdog — the idle tasks are
// not fed while the chip is in light sleep, and a slice longer than the
// 5 s TWDT window is a reboot waiting to happen (tasks/lessons.md, "A
// blocking captive portal starves the idle task").
//
// With the QMI8658's INT wired to a GPIO the slice is only the VBUS cadence,
// because motion cuts through it as a hardware wake. Without it, the slice is
// how long a latched WoM interrupt waits to be read, so it sets how quickly
// a pick-up is answered: 120 ms is under the threshold at which a human
// notices a delay at all.
static const uint32_t DOZE_SLICE_INT_MS    = 3000;
static const uint32_t DOZE_SLICE_POLLED_MS = 120;

static const uint32_t DOZE_JOIN_MS         = 15000;  // Wi-Fi join budget per beat
static const uint32_t DOZE_BEAT_TIMEOUT_MS = 40000;  // ceiling on one beat, all in
static const uint32_t DOZE_FORCED_MAX_MS   = 300000; // a forced doze ends itself

// A WoM latch that is still set on the first slice of a doze is more likely
// stale than real; clear it and keep sleeping, for this many slices.
static const uint8_t  DOZE_WOM_SETTLE_SLICES = 2;
// Consecutive failed I2C reads of the sensor before the doze gives up and
// hands the potato back to the normal loop. Sleeping blind is worse than
// not sleeping: the failure mode has to be "yesterday's battery life", never
// "a potato that cannot be woken".
static const uint8_t  DOZE_I2C_FAULTS = 5;
// A level-triggered GPIO that keeps waking us with nothing behind it gets
// disarmed for the rest of the doze after this many tries.
static const uint8_t  DOZE_GPIO_SPURIOUS = 3;

// Wake-on-motion threshold, in mg of change. 100 mg is deliberately more
// sensitive than a shove and less sensitive than a passing lorry; a lift
// always rotates the potato, which swings a whole axis by far more. NOT yet
// tuned on hardware — one evening with the 's' dump will settle it.
#ifndef POTATO_WOM_MG
#define POTATO_WOM_MG 100
#endif

// The QMI8658's interrupt cannot reach the ESP32-S3 on this board.
//
// Read off Waveshare's schematic (ESP32-S3-Touch-AMOLED-1.8.pdf) and
// corroborated by their own ESP-IDF board_variant.c, which leaves expander
// bits 3-6 configured as inputs:
//
//   QMI8658 INT1 -> net QMI_INT1 -> TCA9554 P6 (EXIO6)
//   QMI8658 INT2 -> net QMI_INT2, one node only. A dead stub.
//   AXP2101 IRQ  -> TCA9554 P5      PCF85063 INT -> TCA9554 P3
//   TCA9554 pin 13 (its own INT)  -> NOT CONNECTED
//
// So the IMU's interrupt lands on an I2C expander whose interrupt output
// goes nowhere. Reading it means an I2C transaction either way — and reading
// the QMI8658's own STATUS1 latch is the same cost with one hop fewer, so
// that is what the doze does. GPIO21 (touch) is the only true hardware
// interrupt on this board.
//
// This is a wiring fact, not a preference: no firmware can make the IMU wake
// this chip through a GPIO. The seven free GPIOs (17, 18, 38-42) exist only
// as solder test pads, so a bodge wire from QMI_INT1 is the only route to a
// real hardware wake. If one is ever fitted, set this to that GPIO: the doze
// arms it with esp_sleep_enable_gpio_wakeup() and stretches its slices from
// DOZE_SLICE_POLLED_MS to DOZE_SLICE_INT_MS.
#ifndef POTATO_IMU_INT_PIN
#define POTATO_IMU_INT_PIN (-1)
#endif
// Which of the sensor's two INT pins the WoM engine drives. INT2 by default
// precisely because it is the unconnected one: the doze reads the latch over
// I2C, so the pin only has to not disturb anything. INT1 would drive EXIO6,
// which is harmless (the expander has it as an input, and setup() only ever
// claims expander pins 0-2 for the reset pulse) — but a vendor example does
// `expander.pinMode(6, OUTPUT)`, so anything that widens that loop past 2
// would put a push-pull output on the same net. Leave it on INT2.
#ifndef POTATO_IMU_INT_WOM_PIN
#define POTATO_IMU_INT_WOM_PIN 2
#endif
// configWakeOnMotion(defaultPinValue = 0) idles the INT line low and drives
// it high on motion, so a wired pin would be a high-level wake, no pull.

// The CST820's INT (GPIO21) is wired and free: arming it costs nothing and
// makes a tap on the dark glass wake the potato as fast as a lift does. It
// is armed only if it is genuinely idle-high first, and disarmed for the
// rest of the doze if it fires with no touch behind it.
#ifndef POTATO_TOUCH_WAKE
#define POTATO_TOUCH_WAKE 1
#endif

// ------------------------------------------------------------ wake reasons ---

// Declared here, not in potato.ino: the Arduino preprocessor injects every
// .ino function's prototype above the file's own declarations, so a type
// named in a .ino signature must come from a header (docs/hardware.md, "The
// .ino auto-prototype trap").
enum WakeReason {
  WAKE_NONE = 0,
  WAKE_MOTION,     // the QMI8658 said something moved
  WAKE_TOUCH,      // the CST820's interrupt
  WAKE_POWER,      // VBUS appeared
  WAKE_FORCED,     // a forced doze ran out its clock
  WAKE_FAULT,      // the sensor stopped answering; back to the normal loop
};

static inline const char *wakeReasonName(WakeReason w) {
  switch (w) {
    case WAKE_MOTION: return "motion";
    case WAKE_TOUCH:  return "touch";
    case WAKE_POWER:  return "power";
    case WAKE_FORCED: return "forced-timeout";
    case WAKE_FAULT:  return "sensor fault";
    default:          return "never dozed";
  }
}

// ------------------------------------------------------------------ the IMU ---

// The everyday configuration. Lives here so setup() and the wake path cannot
// drift apart — the potato's whole handling detector is calibrated against
// these rates and a wake that restored different ones would quietly change
// what "being picked up" means.
static inline void imuConfigureNormal(SensorQMI8658 &q) {
  q.configAccelerometer(SensorQMI8658::ACC_RANGE_4G,
                        SensorQMI8658::ACC_ODR_1000Hz,
                        SensorQMI8658::LPF_MODE_0);
  q.enableAccelerometer();
  q.configGyroscope(SensorQMI8658::GYR_RANGE_512DPS,
                    SensorQMI8658::GYR_ODR_224_2Hz,
                    SensorQMI8658::LPF_MODE_0);
  q.enableGyroscope();
}

// Hand the watch over. configWakeOnMotion() resets the chip, drops the
// gyroscope entirely and puts the accelerometer in low-power 128 Hz mode,
// then arms the QMI8658's own comparator: from here the sensor raises its
// interrupt when it sees more than `mg` of change, and the ESP32 is not
// asked to look at acceleration at all.
static inline bool imuEnterWom(SensorQMI8658 &q, uint8_t mg) {
  const SensorQMI8658::IntPin pin = (POTATO_IMU_INT_WOM_PIN == 1)
                                        ? SensorQMI8658::INTERRUPT_PIN_1
                                        : SensorQMI8658::INTERRUPT_PIN_2;
  return q.configWakeOnMotion(mg, SensorQMI8658::ACC_ODR_LOWPOWER_128Hz, pin,
                              0 /* INT idles low, goes high on motion */) == 0;
}

// One register read: STATUS1 (0x2F), bit 2 is the WoM latch, and the
// QMI8658 clears STATUS1 when it is read. So this answers "has the sensor
// raised its interrupt since I last asked" — it is the interrupt line being
// read over I2C, not the accelerometer being sampled and judged here.
// Returns -1 if the sensor did not answer at all.
static inline int imuWomFired(SensorQMI8658 &q) {
  const int s = q.getStatusRegister();
  if (s < 0) return -1;
  return (s & 0x04) != 0 ? 1 : 0;
}

// Back to full rate. reset(false) skips the library's blocking wait for the
// reset-done register (up to 500 ms) — the datasheet gives the reset 15 ms,
// and half a second is half a second of a potato not yet on the glass.
static inline void imuLeaveWom(SensorQMI8658 &q) {
  q.reset(false);
  delay(20);
  imuConfigureNormal(q);
}
