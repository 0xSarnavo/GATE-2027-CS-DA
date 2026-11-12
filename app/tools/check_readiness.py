"""Validate readiness checks against the rules the server enforces (server/modules/learn/readiness.ts).

Usage (from app/): python3 tools/check_readiness.py [chapter ...]   (no args = every file in data/readiness)
Exit code 1 if any file is invalid; the server rejects a whole file for one bad question.
"""
import json, math, os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'data')
prereqs = json.load(open(os.path.join(ROOT, 'prereqs.json')))
files = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, 'readiness')) if f.endswith('.json'))
bad = 0
for ch in files:
    errs = []
    try:
        d = json.load(open(os.path.join(ROOT, 'readiness', ch + '.json')))
    except Exception as e:
        print(f'{ch}: cannot read ({e})'); bad += 1; continue
    p = prereqs.get(ch)
    ok_ids = set((p or {}).get('foundations', []) + (p or {}).get('chapters', []))
    qs = d.get('questions') or []
    if not p: errs.append('chapter not in prereqs.json')
    if d.get('chapter_id') != ch: errs.append(f'chapter_id {d.get("chapter_id")!r} != file name')
    if not 4 <= len(qs) <= 6: errs.append(f'{len(qs)} questions (want 4-6)')
    ids = [q.get('id') for q in qs]
    if len(set(ids)) != len(ids): errs.append('duplicate question ids')
    for q in qs:
        tag = q.get('id') or '?'
        if not q.get('id') or not q.get('stem') or not q.get('explain'): errs.append(f'{tag}: id, stem and explain are required')
        if q.get('tests') not in ok_ids: errs.append(f'{tag}: tests {q.get("tests")!r} not in {sorted(ok_ids)}')
        if q.get('type') == 'MCQ':
            opts = q.get('options') or []
            keys = [chr(65 + i) if isinstance(o, str) else o.get('key') for i, o in enumerate(opts)]
            if len(opts) != 4: errs.append(f'{tag}: MCQ needs 4 options')
            if q.get('answer') not in keys: errs.append(f'{tag}: answer {q.get("answer")!r} not an option key')
        elif q.get('type') == 'NAT':
            try:
                if not math.isfinite(float(q.get('answer'))): raise ValueError
            except (TypeError, ValueError):
                errs.append(f'{tag}: NAT answer must be a finite number')
        else:
            errs.append(f'{tag}: type must be MCQ or NAT')
        if '\\*' in json.dumps(q): errs.append(f'{tag}: contains \\* (renders a literal backslash)')
        if '$' in (q.get('explain') or ''): errs.append(f'{tag}: explain is plain text; no $ maths')
    if errs:
        bad += 1
        print(f'{ch}: INVALID'); [print('  ' + e) for e in errs]
print(f'{len(files)} files checked, {bad} invalid')
sys.exit(1 if bad else 0)
