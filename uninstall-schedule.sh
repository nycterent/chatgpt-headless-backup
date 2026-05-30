#!/bin/sh
# Unload and remove the weekly launchd backup job (macOS).
set -e

LABEL="com.user.chatgpt-backup"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$TARGET" 2>/dev/null || true
rm -f "$TARGET"
echo "Removed $LABEL"
