#pragma once

// Waveshare ESP32-S3-ePaper-1.54G (ESP32-S3-PICO-1-N8R8, 8 MB flash, 8 MB
// OPI PSRAM). Verified against the vendor repo
// github.com/waveshareteam/ESP32-S3-ePaper-1.54G: Example/Arduino_3.2.0/
// examples/*/user_config.h, 08_E_paper_test/DEV_Config.h, 07_Audio_out, and
// Hardware/schematics/ESP32-S3-Touch-ePaper-1.54-Schematic.pdf (same PCB as
// the touch variant; GP7/GP21 are the unpopulated touch reset/int here).

// Power. GP17 (BAT_Control) drives an 8050 that pulls the gate of the AO3401
// between VBAT and VSYS: HIGH keeps the board alive on battery, and the PWR
// key (BAT_KEY) only holds that gate while pressed. Drive it HIGH before
// anything else in setup() or the board turns itself off when the key is
// released. USB feeds VSYS directly through D4, so on USB the latch is moot.
#define VBAT_PWR_PIN    17
#define PWR_BUTTON_PIN  18   // BAT_KEY, active low
#define BOOT_BUTTON_PIN 0    // active low, 10K pull-up on the board

#define LED_PIN         3    // green, through 24K to 3V3: LOW = on. The
                             // charger's STAT drives the other LED directly;
                             // no GPIO sees the charge state.
#define BAT_ADC_PIN     4    // ADC1_CH3, VBAT through 200K/200K: V = mV * 2

// e-Paper, SPI (FSPI host, hardware SPI in this firmware; the vendor bit-bangs).
#define EPD_PWR_PIN     6    // EPD3V3_EN through an AO3401: LOW = panel powered
#define EPD_BUSY_PIN    8    // LOW while the panel is busy (vendor waits for HIGH)
#define EPD_RST_PIN     9
#define EPD_DC_PIN      10
#define EPD_CS_PIN      11
#define EPD_SCK_PIN     12
#define EPD_MOSI_PIN    13

// I2C: SHTC3 at 0x70, PCF85063 at 0x51, ES8311 at 0x18 (CE low).
#define I2C_SDA_PIN     47
#define I2C_SCL_PIN     48
#define RTC_INT_PIN     5

// Audio, ES8311 over I2S. Not wired in this firmware (sound is "quiet").
#define I2S_MCLK_PIN    14
#define I2S_BCK_PIN     15
#define I2S_LRCK_PIN    38
#define I2S_DOUT_PIN    45
#define I2S_DIN_PIN     16
#define PA_EN_PIN       42   // LOW = amplifier rail on
#define PA_CTRL_PIN     46

// microSD, SDMMC 1-bit. Unused.
#define SD_CLK_PIN      39
#define SD_CMD_PIN      41
#define SD_D0_PIN       40

// Which way up the panel is mounted relative to the USB port. 1 rotates the
// page 180° when it is sent; the canvas is always drawn upright.
#ifndef EPD_ROTATE_180
#define EPD_ROTATE_180  0
#endif
