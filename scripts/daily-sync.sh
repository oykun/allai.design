#!/bin/sh
# Publishes the vault to allai.design once a day, so a reference you capture
# with Publish ticked goes live without you running anything.
#
#   scripts/daily-sync.sh --install     run every day at 21:00 (launchd; a Mac asleep at 21:00 runs it on wake)
#   scripts/daily-sync.sh --uninstall   stop it
#   scripts/daily-sync.sh               run once now, exactly as the schedule does
#   scripts/daily-sync.sh --dry         report only (npm run sync -- --dry), any branch
#
# It runs `npm run sync`, which commits src/data/items.json and pushes the
# checked-out branch. Vercel deploys only from main, so a real run happens
# only when main is checked out; on any other branch it skips and says so.
# Each run ends with a macOS notification. Log: ~/Library/Logs/allai-sync.log
# Change the hour with ALLAI_SYNC_HOUR (0-23) when installing.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="design.allai.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/allai-sync.log"
NPM="$(command -v npm || echo /opt/homebrew/bin/npm)"

notify() { osascript -e "display notification \"$2\" with title \"allai sync\" subtitle \"$1\"" >/dev/null 2>&1 || true; }

case "${1:-}" in
  --install)
    HOUR="${ALLAI_SYNC_HOUR:-21}"
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$REPO/scripts/daily-sync.sh</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NPM"):/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "✗ launchctl bootstrap failed"; exit 1; }
    echo "→ allai syncs every day at $HOUR:00 ($PLIST)"
    echo "  log: $LOG"
    exit 0 ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "→ daily sync removed"
    exit 0 ;;
esac

cd "$REPO" || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M') ==="

if [ "${1:-}" = "--dry" ]; then
  "$NPM" run -s sync -- --dry
  exit $?
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "skipped: on branch $BRANCH, and the site deploys from main"
  notify "Skipped" "The repo is on $BRANCH, not main. Nothing was published."
  exit 0
fi

# Pick up anything pushed from elsewhere so our push isn't rejected.
git pull --ff-only -q origin main || echo "! git pull failed; the sync's push may be rejected"

OUT="$("$NPM" run -s sync 2>&1)"; STATUS=$?
echo "$OUT"
LIVE="$(printf '%s\n' "$OUT" | grep -E 'item\(s\) go live' | tail -1 | sed 's/:$//')"
if [ $STATUS -ne 0 ]; then
  notify "Failed" "See ~/Library/Logs/allai-sync.log"
elif printf '%s\n' "$OUT" | grep -q "push failed"; then
  notify "Not pushed" "Committed locally; the push failed. See the log."
elif printf '%s\n' "$OUT" | grep -q "Snapshot unchanged"; then
  notify "Nothing new" "${LIVE:-No changes to publish.}"
else
  notify "Published" "${LIVE:-Site updated.} Live in about a minute."
fi
exit $STATUS
