"""
Builds every icon and the logo mark from design/mascot-source.png, a black
doodle on white. The doodle becomes a sticker — white inside its outline, a
white cut line around it, black ink on top — so it reads on the indigo brand
colour at any size.

Usage (needs Pillow):  python3 design/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
INDIGO = (66, 49, 224, 255)  # --indigo / theme-color #4231E0

src = Image.open(ROOT / 'design/mascot-source.png').convert('L')
ink = src.point(lambda v: 255 if v < 128 else 0)  # 255 = ink
ink = ink.crop(ink.getbbox())

# Everything the outside cannot reach is inside a shape: flood the
# background from a padded border, and the rest is the silhouette.
PAD = 4
w, h = ink.size
canvas = Image.new('L', (w + 2 * PAD, h + 2 * PAD), 0)
canvas.paste(ink, (PAD, PAD))
outside = canvas.copy()
ImageDraw.floodfill(outside, (0, 0), 128)
silhouette = outside.point(lambda v: 0 if v == 128 else 255)
ink_full = canvas


SOURCE_STROKE = 14  # px, the doodle's line width in the source


def sticker(width: int, cut: float, stroke: float = 0) -> Image.Image:
    """
    The mascot as a transparent sticker `width` px wide, plus its cut line.
    `stroke` is the least line width wanted at that size: shrunk as drawn, a
    favicon's lines would be a faint single pixel.
    """
    scale = width / silhouette.width
    pad = round(cut * width) + 2
    size = (width, round(silhouette.height * scale))
    sil = silhouette.resize(size, Image.LANCZOS)
    grow = max(0, round((stroke / scale - SOURCE_STROKE) / 2))
    bold = ink_full.filter(ImageFilter.MaxFilter(2 * grow + 1)) if grow else ink_full
    inkm = bold.resize(size, Image.LANCZOS)
    full = (size[0] + 2 * pad, size[1] + 2 * pad)
    sil_p = Image.new('L', full, 0); sil_p.paste(sil, (pad, pad))
    ink_p = Image.new('L', full, 0); ink_p.paste(inkm, (pad, pad))
    r = max(1, round(cut * width))
    halo = sil_p.filter(ImageFilter.MaxFilter(2 * r + 1)) if r < 50 else sil_p
    halo = halo.filter(ImageFilter.GaussianBlur(0.6)).point(lambda v: 255 if v > 100 else round(v * 2.5))
    out = Image.new('RGBA', full, (0, 0, 0, 0))
    out.paste((255, 255, 255, 255), mask=halo)
    out.paste((20, 18, 40, 255), mask=ink_p)
    return out


def icon(size: int, fill: float, cut: float = 0.035, radius: float = 0.0, stroke: float = 0) -> Image.Image:
    """A square icon: indigo ground, the sticker centred `fill` of the width."""
    bg = Image.new('RGBA', (size, size), INDIGO)
    if radius:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), round(radius * size), fill=255)
        bg.putalpha(mask)
    # Draw large and shrink: small icons stay crisp.
    big = sticker(round(size * fill) * 4, cut, stroke * 4)
    s = big.resize((big.width // 4, big.height // 4), Image.LANCZOS)
    bg.alpha_composite(s, ((size - s.width) // 2, (size - s.height) // 2))
    return bg


icons = ROOT / 'public/icons'
icons.mkdir(parents=True, exist_ok=True)
icon(512, 0.84, stroke=16).convert('RGB').save(icons / 'icon-512.png', optimize=True)
icon(192, 0.84, stroke=7).convert('RGB').save(icons / 'icon-192.png', optimize=True)
icon(180, 0.80, stroke=7).convert('RGB').save(icons / 'apple-touch-icon.png', optimize=True)
# Maskable: Android may crop to a circle, so keep inside the middle 80%.
icon(512, 0.66, stroke=14).convert('RGB').save(icons / 'icon-maskable-512.png', optimize=True)
# Favicons: rounded tile, the doodle as wide as it can go; thicker cut line.
icon(32, 0.94, 0.05, 0.22, 2).save(icons / 'icon-32.png', optimize=True)
fav = [icon(n, 0.94, 0.05, 0.22, max(1.6, n / 16)) for n in (16, 32, 48)]
fav[2].save(ROOT / 'public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=fav[:2])
# Logo mark beside the wordmark, at 2x the size it is shown.
sticker(280, 0.03, 9).save(ROOT / 'src/assets/mascot.png', optimize=True)
print('icons written')
