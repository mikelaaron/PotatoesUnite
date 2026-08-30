# NVS — frozen schema

Both boards keep everything that makes a potato *that* potato in the ESP32's
NVS partition (`nvs`, offset `0x9000`, 20 KB, the same place Arduino's
default tables put it). **Partition offset and key names never change.** A
firmware update — USB or OTA — must never erase, move, or rename any of this.
A reflash over the old `huge_app`/`default_8MB` layouts leaves the partition
untouched because `partitions.csv` keeps `nvs`, `otadata` and `ota_0` at the
same offsets.

Namespace **`potato`** (both boards; opened read/write by the loop and by the
net task):

| Key | Type | Written | Meaning |
|---|---|---|---|
| `secret` | bytes[16] | first boot, once | The device secret. Never shown, never sent except in request bodies. **Losing it is losing the potato.** |
| `pid` | string | `/v0/register` | Potato number, e.g. `0001`. Its presence means "registered"; removed to force re-registration (heartbeat 401/403/404, serial `R`). |
| `name` | string | register | Assigned name. |
| `variety` | string | register | Assigned variety id. |
| `claim` | string | register | Claim code for the File. |
| `seed` | uint32 | first boot (random), then register (server's) | Pool/voice seed. The server's value wins once registered. |
| `scene` | string ≤ ~2 KB | every heartbeat/choice | Last Scene JSON, shown when offline. |
| `server` | string | captive-portal save or public-build legacy migration | Server URL (default `http://potatoes.local:8080`). A public build replaces that exact legacy default with its HTTPS build default; custom URLs stay authoritative. A `secrets.h` `SERVER_URL` overrides it at compile time. |
| `tz` | string | captive-portal save | POSIX TZ string. |
| `last_epoch` | ulong | every heartbeat when time is known | For `dormant_resume` duration after a power-on reset. |

Not ours, same partition: the Wi-Fi stack's own namespaces (`nvs.net80211`
etc.) hold the saved network credentials; WiFiManager's `resetSettings()`
(serial `W`) clears only those. Erasing the whole NVS partition (`esptool
erase_region 0x9000 0x5000`, or `erase_flash`) wipes the secret — never do
that to a registered potato.

Adding a key is allowed (new keys have defaults); renaming or retyping one is
not. If a future version needs a migration, it reads the old key, writes the
new one, and leaves the old one in place.
