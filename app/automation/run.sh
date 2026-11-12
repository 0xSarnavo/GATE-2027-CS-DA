#!/bin/zsh
# Scheduled GATE 27 report run: ./run.sh daily|weekly|monthly
set -u
KIND=${1:?usage: run.sh daily|weekly|monthly}
ROOT=/Users/sarnavo/Development/GATE-2027-CS-DA
APP=$ROOT/app
REPORTS=$ROOT/reports
LOG=$REPORTS/logs/$KIND-$(date +%Y%m%d-%H%M).log
LOCK=/tmp/gate27-$KIND.lock
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# One run per kind at a time; skip if the same period already has a report.
if ! mkdir "$LOCK" 2>/dev/null; then echo "already running" >> "$LOG"; exit 0; fi
trap 'rmdir "$LOCK"' EXIT
case $KIND in
  daily)   OUT=$REPORTS/daily/$(date +%Y-%m-%d).md ;;
  weekly)  OUT=$REPORTS/weekly/$(date +%G-W%V).md ;;
  monthly) OUT=$REPORTS/monthly/$(date +%Y-%m).md ;;
  *) echo "unknown kind $KIND"; exit 1 ;;
esac
[ -s "$OUT" ] && { echo "report exists: $OUT" >> "$LOG"; exit 0; }

export REPORT_OUT=$OUT
export TODAY=$(date +%Y-%m-%d)

cd $REPORTS
PROMPT=$(sed -e "s|\$TODAY|$TODAY|g" -e "s|\$REPORT_OUT|$OUT|g" $APP/automation/prompts/$KIND.md)
claude -p "$PROMPT" \
  --model sonnet \
  --max-turns 30 \
  --allowedTools "Bash(/Users/sarnavo/Development/GATE-2027-CS-DA/app/automation/gate-api:*)" "Read" "Write" \
  >> "$LOG" 2>&1
echo "exit $? at $(date)" >> "$LOG"
