#!/bin/sh
# Install the weekly launchd backup job (macOS). Substitutes this directory's
# absolute path into the plist template, then loads it.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.user.chatgpt-backup"
TEMPLATE="$DIR/com.user.chatgpt-backup.plist.template"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$DIR/logs" "$HOME/Library/LaunchAgents"
sed "s#__DIR__#$DIR#g" "$TEMPLATE" > "$TARGET"

launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "Installed and loaded $LABEL"
echo "  plist:  $TARGET"
echo "  runs:   HEADLESS=false node backup.mjs  (Sunday 03:00, Mac must be awake)"
echo "  logs:   $DIR/logs/backup.{out,err}.log"
echo "Remove with: ./uninstall-schedule.sh"
