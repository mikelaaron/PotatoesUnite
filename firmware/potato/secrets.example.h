// Copy to secrets.h (gitignored) for development. All three are optional.
// Without WIFI_SSID/WIFI_PASS the potato opens its captive portal
// (AP "POTATO-XXXX", http://192.168.4.1). SERVER_URL overrides the stored
// server URL; the Mac's LAN IP is `ipconfig getifaddr en0`.
#define WIFI_SSID  "your-network"
#define WIFI_PASS  "your-password"
#define SERVER_URL "http://192.168.1.10:8080"   // your Mac's LAN IP; the server prints it on startup
