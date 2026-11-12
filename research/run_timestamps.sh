#!/bin/zsh
# Nightly: fill video concept timestamps (stops on YouTube rate limit), then sync into the app and redeploy if anything changed.
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
R=/Users/sarnavo/Development/GATE-2027-CS-DA/research; A=/Users/sarnavo/Development/GATE-2027-CS-DA/app
cd $R
pending=$(python3 -c "import json,glob;print(sum(1 for f in glob.glob('videos/*.json') for v in json.load(open(f))['videos'] if not v.get('concepts') and v.get('note')!='no transcript'))")
echo "== $(date) pending=$pending" >> timestamps.log
[ "$pending" = "0" ] && exit 0
opencode run --dir $R "$(cat TIMESTAMP_PROMPT.md)" >> timestamps.log 2>&1
cp $R/videos/*.json $A/data/videos/
cd $A
if ! git diff --quiet -- data/videos; then
  git add data/videos && git commit -q --no-gpg-sign -m "Add video concept timestamps (nightly)" && railway up --ci >> $R/timestamps.log 2>&1
fi
