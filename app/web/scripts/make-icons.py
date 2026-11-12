"""Generate PNG icons from the same design as public/icons/icon.svg (needs Pillow)."""
from PIL import Image, ImageDraw, ImageFont
import os
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
BG, TRACK, ACC, FG = (15, 20, 32), (42, 51, 80), (110, 168, 254), (232, 236, 246)
def font(sz):
    for p in ['/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz, index=1) if p.endswith('.ttc') else ImageFont.truetype(p, sz)
    return ImageFont.load_default()
def draw(size, scale=1.0, rounded=True):
    S = size * 4
    im = Image.new('RGBA', (S, S), BG + (255,))
    d = ImageDraw.Draw(im)
    c, r, w = S / 2, S * 0.332 * scale, S * 0.055 * scale
    box = [c - r, c - r, c + r, c + r]
    d.arc(box, 0, 360, fill=TRACK, width=int(w))
    d.arc(box, -90, 235, fill=ACC, width=int(w))
    f = font(int(S * 0.29 * scale))
    d.text((c, c + S * 0.01), '27', font=f, fill=FG, anchor='mm')
    im = im.resize((size, size), Image.LANCZOS)
    if rounded:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
        im.putalpha(m)
    return im
draw(192).save(f'{out}/icon-192.png')
draw(512).save(f'{out}/icon-512.png')
draw(512, 0.78, rounded=False).save(f'{out}/maskable-512.png')   # full-bleed, content in safe zone
draw(180, rounded=False).save(f'{out}/apple-touch-icon.png')      # iOS rounds it itself
