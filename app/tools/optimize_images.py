"""Convert data/img/*.png to WebP (q80, lossy) next to the PNG; originals are moved to data/img-png-original/ (gitignored).
Run: tools/.venv/bin/python tools/optimize_images.py   Then `bun run import-content` rewrites image_refs to .webp."""
from pathlib import Path
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
IMG = Path(__file__).resolve().parents[1] / "data" / "img"; ORIG = IMG.parent / "img-png-original"
ORIG.mkdir(exist_ok=True)
a = b = 0
for f in sorted(IMG.glob("*.png")):
    im = Image.open(f).convert("RGB")
    out = f.with_suffix(".webp"); im.save(out, "WEBP", quality=80, method=6)
    a += f.stat().st_size; b += out.stat().st_size
    f.rename(ORIG / f.name)
print(f"{a/1e6:.1f}MB png -> {b/1e6:.1f}MB webp")
