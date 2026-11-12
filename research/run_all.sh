#!/bin/zsh
cd /Users/sarnavo/Development/GATE-2027-CS-DA/research
echo "== cutoffs $(date)" >> opencode.log
opencode run --dir /Users/sarnavo/Development/GATE-2027-CS-DA/research "$(cat CUTOFFS_PROMPT.md)" >> opencode.log 2>&1
./run_videos.sh
