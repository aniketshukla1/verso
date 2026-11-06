"""Verso mark — final. A round label peeled back at one edge, showing its reverse.

Fixes over the draft:
  - the cap is removed as a HALF-PLANE past the fold, not as an arc polygon;
    tracing the circle twice left a 1px ghost ring where the two
    anti-aliased edges failed to coincide
  - a smaller peel (38% of the radius, not 52%) so it reads as an edge lifting,
    not a half-moon
"""
from PIL import Image, ImageDraw, ImageFilter
import math, sys, os

ULTRA = (0x2E, 0x3F, 0x91); PAPER = (0xF3, 0xF4, 0xF0)
VERSO = (0xC6, 0xCC, 0xEA); INK = (0x14, 0x1A, 0x26)

def mark(size, bg=None, scale=1.0, cap=0.38, mono=False):
    SS = 4; S = size * SS; k = S / 1024 * scale
    img = Image.new('RGBA', (S, S), (bg + (255,)) if bg else (0, 0, 0, 0))
    cx = cy = S / 2; r = 300 * k
    u = (1 / math.sqrt(2),) * 2; v = (1 / math.sqrt(2), -1 / math.sqrt(2))
    d = r * (1 - cap)
    alpha = math.acos(d / r)

    # the peeled cap: arc from (45 - a) to (45 + a), closed by the chord
    capPoly = []
    for i in range(0, 181):
        th = math.radians(45) - alpha + 2 * alpha * i / 180
        capPoly.append((cx + r * math.cos(th), cy + r * math.sin(th)))
    def reflect(p):
        t = (p[0] - cx) * u[0] + (p[1] - cy) * u[1] - d
        return (p[0] - 2 * t * u[0], p[1] - 2 * t * u[1])
    flap = [reflect(p) for p in capPoly]

    # face = disc minus the half-plane beyond the fold (no double-traced edge)
    face = Image.new('L', (S, S), 0); fd = ImageDraw.Draw(face)
    fd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    base = (cx + d * u[0], cy + d * u[1]); big = S * 2
    A = (base[0] + big * v[0], base[1] + big * v[1]); B = (base[0] - big * v[0], base[1] - big * v[1])
    fd.polygon([A, B, (B[0] + big * u[0], B[1] + big * u[1]), (A[0] + big * u[0], A[1] + big * u[1])], fill=0)

    if mono:
        # themed (monochrome) Android icons: alpha is all that survives the OS tint
        out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        out.paste((255, 255, 255, 255), (0, 0), face)
        fl = Image.new('L', (S, S), 0); ImageDraw.Draw(fl).polygon(flap, fill=150)
        out.paste((255, 255, 255, 150), (0, 0), fl)
        return out.resize((size, size), Image.LANCZOS)

    img.paste(PAPER + (255,), (0, 0), face)
    sh = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sh).polygon([(x - 14 * k, y - 14 * k) for x, y in flap], fill=95)
    sh = sh.filter(ImageFilter.GaussianBlur(15 * k))
    img.paste(INK + (255,), (0, 0), Image.composite(sh, Image.new('L', (S, S), 0), face))
    ImageDraw.Draw(img).polygon(flap, fill=VERSO + (255,))
    return img.resize((size, size), Image.LANCZOS)

out_dir, sheet_path = sys.argv[1], sys.argv[2]

# --- final assets -----------------------------------------------------------
mark(1024, bg=ULTRA).convert('RGB').save(f'{out_dir}/icon.png')               # iOS: no alpha allowed
mark(1024, scale=0.92).save(f'{out_dir}/adaptive-foreground.png')            # inside the 66dp safe circle
mark(1024, scale=0.92, mono=True).save(f'{out_dir}/adaptive-monochrome.png')
mark(1024).save(f'{out_dir}/splash-mark.png')                                 # plugin scales to imageWidth
for f in sorted(os.listdir(out_dir)):
    im = Image.open(f'{out_dir}/{f}')
    print(f'  {f:28s} {im.size[0]}x{im.size[1]}  {im.mode}  {os.path.getsize(f"{out_dir}/{f}")//1024}KB')

# --- review sheet -----------------------------------------------------------
W = 1500; sheet = Image.new('RGB', (W, 940), (244, 244, 241)); sd = ImageDraw.Draw(sheet)
icon = mark(420, bg=ULTRA)
m = Image.new('L', (420, 420), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, 419, 419], radius=94, fill=255)
sheet.paste(icon, (40, 40), m)                                                 # iOS superellipse-ish mask
x = 500
for sz in (120, 76, 60, 40, 29):                                               # home screen .. settings
    ic = mark(sz, bg=ULTRA); mm = Image.new('L', (sz, sz), 0)
    ImageDraw.Draw(mm).rounded_rectangle([0, 0, sz - 1, sz - 1], radius=int(sz * .225), fill=255)
    sheet.paste(ic, (x, 40 + (120 - sz) // 2), mm); x += sz + 34
fg = mark(300, scale=0.92)                                                     # Android adaptive masks
for i, shape in enumerate(['circle', 'squircle', 'square']):
    tile = Image.new('RGBA', (300, 300), ULTRA + (255,)); tile.alpha_composite(fg)
    mm = Image.new('L', (300, 300), 0); dd = ImageDraw.Draw(mm)
    if shape == 'circle': dd.ellipse([0, 0, 299, 299], fill=255)
    elif shape == 'squircle': dd.rounded_rectangle([0, 0, 299, 299], radius=100, fill=255)
    else: dd.rounded_rectangle([0, 0, 299, 299], radius=36, fill=255)
    sheet.paste(tile, (500 + i * 330, 200), mm)
for i, (bgc, label) in enumerate([(ULTRA, 'light'), ((0x14, 0x1B, 0x3D), 'dark')]):   # splash on a phone
    ph = Image.new('RGB', (230, 498), bgc)
    ph.paste(sp := mark(100), (65, 199), sp)
    pm = Image.new('L', (230, 498), 0); ImageDraw.Draw(pm).rounded_rectangle([0, 0, 229, 497], radius=34, fill=255)
    sheet.paste(ph, (40 + i * 250, 520), pm)
mono = mark(200, scale=0.92, mono=True); t = Image.new('RGBA', (200, 200), (60, 70, 60, 255)); t.alpha_composite(mono)
mm = Image.new('L', (200, 200), 0); ImageDraw.Draw(mm).ellipse([0, 0, 199, 199], fill=255)
sheet.paste(t, (1240, 560), mm)
sheet.save(sheet_path); print('  review sheet ->', sheet_path)
