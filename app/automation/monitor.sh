#!/bin/zsh
# Quick health check before starting more agents: Claude usage block, free RAM, heavy processes.
echo "== Claude usage (current 5h block; limit ~306M tokens)"
bunx --bun ccusage blocks --recent --token-limit 306346034 2>/dev/null | grep -E "ACTIVE" | sed -E 's/│/|/g' | awk -F'|' '{print "  "$2" "$5" "$6}'
echo "== Memory"
memory_pressure 2>/dev/null | tail -1 | sed 's/^/  /'
echo "== Heavy processes (>250MB)"
ps -axo rss,comm | awk '$1>256000 {printf "  %5.0f MB  %s\n",$1/1024,$2}' | sort -rn | head -8
echo "== Dev servers / browsers started by agents"
ps aux | grep -E "[v]ite|[b]un server/index|[c]hrome-headless|[H]eadless" | awk '{print "  pid "$2": "$11" "$12}' | head
