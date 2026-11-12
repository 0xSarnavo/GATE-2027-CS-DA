#!/bin/zsh
# Runs opencode video curation subject by subject, one at a time.
cd /Users/sarnavo/Development/GATE-2027-CS-DA/research
LADDERS=/Users/sarnavo/Development/GATE-2027-CS-DA/research/inputs
for subj in ga prob la calc ds algo db dm dl coa os net toc cd ml ai; do
  todo=$(ls $LADDERS | sed 's/.json//' | grep "^$subj\." | while read t; do [ -f videos/$t.json ] || echo $t; done | tr '\n' ' ')
  [ -z "$todo" ] && continue
  echo "== $subj: $todo  $(date)" >> videos.log
  opencode run --dir /Users/sarnavo/Development/GATE-2027-CS-DA/research "$(cat VIDEO_PROMPT.md)

Chapters for this run: $todo" >> videos.log 2>&1
done
echo "ALL DONE $(date)" >> videos.log
