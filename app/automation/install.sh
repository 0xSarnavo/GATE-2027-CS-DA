#!/bin/zsh
# Install the GATE 27 daily/weekly/monthly report jobs (macOS launchd, current user).
D=$(cd "$(dirname "$0")" && pwd)
for k in daily weekly monthly; do
  cp "$D/com.gate27.$k.plist" ~/Library/LaunchAgents/
  launchctl bootout gui/$(id -u)/com.gate27.$k 2>/dev/null
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gate27.$k.plist && echo "installed com.gate27.$k"
done
