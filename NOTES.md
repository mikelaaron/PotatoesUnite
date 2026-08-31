# Status: Doreen is a verified public citizen and the three-day midday layer is live

_Updated 2026-08-30 22:02 EDT on mikelaarons-MacBook-Pro; branch `main`._

## Completed
- Production runs the truthful 12-line midday schedule Tuesday, Thursday, and Saturday at 12:30 device-local time for ten minutes; the full server suite passed 96/96 and the deployed 0.3.1 image matched Doreen's tested binary byte-for-byte.
- Doreen now uses `https://potatoesunite.com` as public citizen `#0004`, named Doreen with variety Purple Majesty. Firmware 0.3.2 completed a certificate-verified TLS heartbeat with HTTP 200 and the temporary Railway SSH key used for the guarded rename was removed.
- Firmware 0.3.2 migrates only the exact legacy LAN default in a public build and uses a 192 px DMA tile so mbedTLS retains enough internal RAM. The migration and protocol host tests passed, and the behavior was verified on Doreen.
- The apparent repeat of “Should Tuesday continue?” was checked against the public editions: it is q08's first production appearance. Its familiarity comes from its use in voice docs, setup copy, bulletin examples, and ballot artwork.
- The weekly editorial heartbeat remains draft-only: Mondays at 09:00 local, producing three device lines, two Tuber topics, and one Question seed for review.

## In progress
- `main` is clean but nine commits ahead of `origin/main`; none of this session's firmware, scheduler, editorial, or handoff work has been pushed.
- Doreen is running hardware-verified firmware 0.3.2, but the public AMOLED OTA manifest still offers 0.3.1. No 0.3.2 OTA or webflash image has been cut or published.
- Battery-drain diagnosis still needs measured awake-battery, awake-USB, and forced-doze current at the rail; estimates alone are not proof.
- Thirty-two queued RAM-only events were lost when Doreen was flashed during the public-Net migration. Identity, Wi-Fi, cached scene, and NVS survived.

## Decisions made
- Doreen is a public citizen; do not restore a dependency on `potatoes.local` or the Mac's LAN Net.
- Midday lines have no choices, File entry, Bulletin entry, or Standing effect. Conditional copy speaks only from recorded facts; silence or a generic line is the fallback.
- Before any future reset, flash, or server migration, inspect serial `e` and either drain the event queue successfully or reconfigure through the live captive portal without resetting.
- OTA and webflash artifacts must be credential-free and use the public Net fallback. Preserve HTTP 429 behavior because firmware interprets 401/403/404 as a forgotten identity.

## Next session priorities
1. Review and push the nine local commits to `origin/main`, keeping the current clean history intact.
2. Decide whether 0.3.2 should become the public AMOLED OTA/webflash release; if yes, build credential-free artifacts, verify them on hardware, update the manifest, deploy, and compare the live SHA-256.
3. Measure awake-battery, awake-USB, and forced-doze current before making another power change.
4. Replace or clearly mark live-pool Questions used as example artwork/copy so future first appearances do not feel like repeats.
