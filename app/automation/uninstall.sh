#!/bin/zsh
for k in daily weekly monthly timestamps; do
  launchctl bootout gui/$(id -u)/com.gate27.$k 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.gate27.$k.plist && echo "removed com.gate27.$k"
done
