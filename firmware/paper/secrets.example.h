// Copy to secrets.h (gitignored) for development. All three are optional.
// Without WIFI_SSID/WIFI_PASS the press opens its captive portal
// (AP "POTATO-XXXX", http://192.168.4.1). SERVER_URL overrides the stored
// server URL; the Mac's LAN IP is `ipconfig getifaddr en0`.
#define WIFI_SSID  "your-network"
#define WIFI_PASS  "your-password"
#define SERVER_URL "http://10.0.0.245:8080"
