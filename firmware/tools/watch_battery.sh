#!/bin/bash
# Sample one citizen's last heartbeat and battery state without opening its
# USB port. This reads the local Net's SQLite WAL, so it cannot reset an S3 and
# is safe to leave running through a battery experiment.
#
# Usage:
#   firmware/tools/watch_battery.sh [db] [potato_id] [duration_s] [interval_s]
# Example, four hours sampled every minute:
#   firmware/tools/watch_battery.sh server/data/potatoes.db 0001 14400 60 \
#     | tee /tmp/doreen-battery.csv

set -euo pipefail

db="${1:-server/data/potatoes.db}"
potato_id="${2:-0001}"
duration_s="${3:-300}"
interval_s="${4:-15}"

[ -f "$db" ] || { echo "database not found: $db" >&2; exit 2; }
case "$potato_id" in
  *[!A-Za-z0-9_-]*) echo "invalid potato id: $potato_id" >&2; exit 2 ;;
esac
case "$duration_s:$interval_s" in
  *[!0-9:]*) echo "duration and interval must be whole seconds" >&2; exit 2 ;;
esac
[ "$interval_s" -gt 0 ] || { echo "interval must be greater than zero" >&2; exit 2; }

printf '%s\n' 'sample_epoch,sample_local,last_seen_epoch,last_seen_local,heartbeat_age_s,battery_pct,charging,vbus,fw'
deadline=$((SECONDS + duration_s))
while [ "$SECONDS" -le "$deadline" ]; do
  now="$(date +%s)"
  sqlite3 -csv "$db" \
    "SELECT $now, datetime($now, 'unixepoch', 'localtime'), last_seen_t, datetime(last_seen_t, 'unixepoch', 'localtime'), $now-last_seen_t, battery_pct, charging, vbus, fw FROM potatoes WHERE id='$potato_id';"
  [ "$SECONDS" -ge "$deadline" ] && break
  sleep "$interval_s"
done
