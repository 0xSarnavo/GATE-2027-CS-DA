"""Targeted re-crops for question images whose automatic crop was a whole-page strip.
Run: tools/.venv/bin/python tools/recrop_fixes.py   (rewrites app/data/img/<id>.png; run tools/optimize_images.py afterwards)"""
import pymupdf, numpy as np
from PIL import Image
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; PAPERS = ROOT.parent / "papers"; IMG = ROOT / "data" / "img"
# (image id, pdf, 1-based page, view dpi used to pick the box, (x0,y0,x1,y1) in view pixels)
FIXES = [
    ("2017-CS1-q65", "CS/2017-CS.pdf", 27, 70, (0, 62, 580, 410)),
    ("2017-CS2-q65", "CS/2017-CS.pdf", 54, 70, (0, 62, 580, 400)),
    ("2019-CS-q10", "CS/2019-CS.pdf", 3, 80, (70, 55, 620, 615)),
    ("2019-CS-q31", "CS/2019-CS.pdf", 8, 80, (80, 158, 620, 190)),
    ("2022-CS-q65", "CS/2022-CS.pdf", 41, 80, (100, 105, 580, 470)),
]
def trim(im, pad=8):
    a = np.asarray(im.convert("L")); m = a < 235
    r = np.where(m.sum(1) > 0)[0]; c = np.where(m.sum(0) > 0)[0]
    return im.crop((max(c[0]-pad, 0), max(r[0]-pad, 0), min(c[-1]+pad, a.shape[1]), min(r[-1]+pad, a.shape[0])))
for name, pdf, pno, vdpi, box in FIXES:
    doc = pymupdf.open(PAPERS / pdf)
    s = 72 / vdpi
    pm = doc[pno-1].get_pixmap(dpi=130, clip=pymupdf.Rect(*[v * s for v in box]), colorspace=pymupdf.csRGB)
    im = trim(Image.frombytes("RGB", (pm.w, pm.h), pm.samples)); im.save(IMG / f"{name}.png", optimize=True)
    print(name, im.size)
