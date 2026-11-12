#!/usr/bin/env python3
"""Download official PDFs listed in downloads.tsv, then copy pack to Development."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
import shutil
import time

stage = Path("/private/tmp/GATE-2027-CS-DA")
target = Path("/Users/sarnavo/Development/GATE-2027-CS-DA")
items = []
for line in (stage / "downloads.tsv").read_text().splitlines():
    if line.strip():
        relative, url = line.split("\t", 1)
        items.append((relative, url))

def fetch(item):
    relative, url = item
    destination = stage / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.read_bytes()[:4] == b"%PDF":
        return relative, "downloaded", "already present"
    for attempt in range(2):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; GATE-study-pack/1.0)"})
            with urlopen(request, timeout=30) as response:
                data = response.read()
            if not data.startswith(b"%PDF"):
                raise ValueError("response was not a PDF")
            destination.write_bytes(data)
            return relative, "downloaded", f"{len(data)} bytes"
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            if attempt == 0:
                time.sleep(1)
    return relative, "missing", error

with ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(fetch, items))

lines = ["# Official PDF download status", "", "Downloaded on 6 October 2026. Source URLs are in downloads.tsv.", "",
         "| File | Status | Detail |", "|---|---|---|"]
for relative, status, detail in results:
    lines.append(f"| {relative} | {status} | {detail.replace('|', '/')} |")
(stage / "DOWNLOAD-STATUS.md").write_text("\n".join(lines) + "\n")

if target.exists():
    raise SystemExit(f"Target already exists; refusing to overwrite: {target}")
shutil.copytree(stage, target)
print(f"Created {target}")
print(f"PDFs: {sum(s == 'downloaded' for _, s, _ in results)}/{len(results)}")
for relative, status, detail in results:
    if status != "downloaded":
        print(f"Missing: {relative}: {detail}")
