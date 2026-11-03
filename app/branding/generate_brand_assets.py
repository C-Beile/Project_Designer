"""Regenerates every Dito Designer logo/icon asset.

The mark is a friendly, round shape-shifting blob (a copy-cat that can become anything, like this
Designer imitates the original). It is drawn from a handful of control points joined by a smooth
spline, with a gradient body, a darker rim, a glossy highlight, big shiny eyes, blush, a small
open mouth and a soft ground shadow. The same shapes are written as a real vector file
(source/dito-logo.svg). Every icon size is drawn natively from the shapes with heavy
anti-aliasing (not shrunk from one big picture), and sizes up to 64 px use a simpler, larger
drawing without the small ornaments, so the mark stays round and clean in the taskbar.

    python branding/generate_brand_assets.py          (needs: pip install pillow)

Outputs: src-tauri/icons/* and ui/src/assets/brand/* (app icon master on a dark rounded tile,
dark-mode icon, NSIS header/sidebar bitmaps, white wordmark).
"""
import math
import os
import shutil
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
ICONS = os.path.join(HERE, "..", "src-tauri", "icons")
BRAND = os.path.join(HERE, "..", "ui", "src", "assets", "brand")

TOP, BOTTOM = (160, 214, 255), (112, 104, 238)
RIM = (74, 72, 196)
INK = (24, 28, 70)
BLUSH = (255, 140, 186)
TONGUE = (255, 120, 150)

# Closed outline of the body in a 1000 x 1000 box (clockwise from the top): a round, slightly
# squashed drop with a flat belly, no bumps.
BODY_POINTS = [(500, 186), (690, 228), (822, 358), (868, 540), (812, 718), (664, 824), (500, 850),
               (336, 824), (188, 718), (132, 540), (178, 358), (310, 228)]
EYES = [((366, 508), 54, 66), ((634, 508), 54, 66)]  # centre, rx, ry
BLUSHES = [((256, 636), 56, 32), ((744, 636), 56, 32)]
HIGHLIGHT = ((352, 322), 96, 42, -30)  # centre, rx, ry, angle in degrees
MOUTH_CENTRE, MOUTH_R = (500, 622), 46
SHADOW = ((500, 896), 270, 30)


def spline(points, steps=18):
    """Closed Catmull-Rom spline through the points as a dense list of vertices."""
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = points[(i - 1) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)))
    return out


def bezier_path(points):
    """The same closed spline as cubic Bezier segments, for the SVG."""
    n = len(points)
    d = "M%.1f,%.1f" % points[0]
    for i in range(n):
        p0, p1, p2, p3 = points[(i - 1) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += " C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (*c1, *c2, *p2)
    return d + " Z"


OUTLINE = spline(BODY_POINTS)


def ellipse_points(cx, cy, rx, ry, angle=0.0, n=96):
    a = math.radians(angle)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    return pts


def supersample(size):
    """More anti-aliasing for small icons, where every edge pixel counts."""
    return max(4, min(16, math.ceil(2400 / size)))


def mark(size, detail=True):
    k = size / 1000.0
    ss = supersample(size)
    big = size * ss

    def sc(pts):
        return [(x * k * ss, y * k * ss) for x, y in pts]

    def canvas():
        return Image.new("RGBA", (big, big), (0, 0, 0, 0))

    # Soft ground shadow
    out = canvas()
    if detail:
        (sx, sy), srx, sry = SHADOW
        ImageDraw.Draw(out).polygon(sc(ellipse_points(sx, sy, srx, sry)), fill=(0, 0, 0, 105))

    # Body: vertical gradient clipped to the outline, then the rim
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(sc(OUTLINE), fill=255)
    ys = [y for _, y in OUTLINE]
    y0, y1 = min(ys) * k * ss, max(ys) * k * ss
    body = canvas()
    bd = ImageDraw.Draw(body)
    for y in range(big):
        f = min(1.0, max(0.0, (y - y0) / (y1 - y0)))
        bd.line([(0, y), (big, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * f) for i in range(3)) + (255,))
    body.putalpha(mask)
    out = Image.alpha_composite(out, body)

    # Glossy highlight, kept inside the body
    inner = canvas()
    idr = ImageDraw.Draw(inner)
    (hx, hy), hrx, hry, ha = HIGHLIGHT
    idr.polygon(sc(ellipse_points(hx, hy, hrx, hry, ha)), fill=(255, 255, 255, 150 if detail else 120))
    if detail:
        idr.polygon(sc(ellipse_points(hx + 128, hy + 52, 14, 14)), fill=(255, 255, 255, 150))
    inner.putalpha(Image.composite(inner.getchannel("A"), Image.new("L", (big, big), 0), mask))
    out = Image.alpha_composite(out, inner)
    rim = canvas()
    ImageDraw.Draw(rim).line(sc(OUTLINE + OUTLINE[:1]), fill=RIM + (255,), width=max(2, round((15 if detail else 22) * k * ss)), joint="curve")
    rim_inner = Image.composite(rim.getchannel("A"), Image.new("L", (big, big), 0), mask)
    rim.putalpha(rim_inner.point(lambda v: int(v * 0.55)))
    out = Image.alpha_composite(out, rim)

    # Face (small sizes: bigger eyes and blush, no mouth detail)
    face = canvas()
    fd = ImageDraw.Draw(face)
    grow = 1.0 if detail else 1.22
    for (cx, cy), rx, ry in BLUSHES:
        fd.polygon(sc(ellipse_points(cx, cy, rx * grow, ry * grow)), fill=BLUSH + (150,))
    for (cx, cy), rx, ry in EYES:
        fd.polygon(sc(ellipse_points(cx, cy, rx * grow, ry * grow)), fill=INK + (255,))
        fd.polygon(sc(ellipse_points(cx - rx * 0.28 * grow, cy - ry * 0.34 * grow, rx * 0.4 * grow, rx * 0.4 * grow)), fill=(255, 255, 255, 255))
        if detail:
            fd.polygon(sc(ellipse_points(cx + rx * 0.34, cy + ry * 0.36, rx * 0.17, rx * 0.17)), fill=(255, 255, 255, 235))
    mx, my = MOUTH_CENTRE
    mr = MOUTH_R * (1.0 if detail else 1.2)
    mouth = [(mx + mr * math.cos(math.pi * i / 36), my + mr * 0.95 * math.sin(math.pi * i / 36)) for i in range(37)]
    fd.polygon(sc(mouth), fill=INK + (255,))
    out = Image.alpha_composite(out, face)
    if detail:
        tongue = Image.new("L", (big, big), 0)
        ImageDraw.Draw(tongue).polygon(sc(ellipse_points(mx, my + mr * 0.92, mr * 0.55, mr * 0.42)), fill=255)
        mouth_mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mouth_mask).polygon(sc(mouth), fill=255)
        tongue_layer = canvas()
        ImageDraw.Draw(tongue_layer).rectangle([0, 0, big, big], fill=TONGUE + (255,))
        tongue_layer.putalpha(Image.composite(tongue, Image.new("L", (big, big), 0), mouth_mask))
        out = Image.alpha_composite(out, tongue_layer)
    return out.resize((size, size), Image.LANCZOS)


def tile(size, top, bottom, radius_ratio=0.225):
    ss = supersample(size)
    big = size * ss
    grad = Image.new("RGBA", (big, big))
    d = ImageDraw.Draw(grad)
    for y in range(big):
        f = y / (big - 1)
        d.line([(0, y), (big, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)) + (255,))
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big - 1, big - 1), int(big * radius_ratio), fill=255)
    grad.putalpha(m)
    return grad.resize((size, size), Image.LANCZOS)


def sparkle(draw, cx, cy, r, ss, fill):
    pts = []
    for i in range(8):
        a = math.pi * i / 4
        rr = r if i % 2 == 0 else r * 0.28
        pts.append(((cx + rr * math.sin(a)) * ss, (cy - rr * math.cos(a)) * ss))
    draw.polygon(pts, fill=fill)


def icon(size, top, bottom):
    small = size <= 64
    t = tile(size, top, bottom)
    m = mark(round(size * (0.9 if small else 0.8)), detail=not small)
    t.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2 - (0 if small else round(size * 0.01))))
    if not small:
        ss = supersample(size)
        sp = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sp)
        sparkle(sd, size * 0.80, size * 0.2, size * 0.055, ss, (200, 228, 255, 235))
        sparkle(sd, size * 0.88, size * 0.31, size * 0.03, ss, (200, 228, 255, 200))
        sparkle(sd, size * 0.15, size * 0.78, size * 0.026, ss, (200, 228, 255, 170))
        t.alpha_composite(sp.resize((size, size), Image.LANCZOS))
    return t


def write_svg(path):
    ys = [y for _, y in BODY_POINTS]
    (hx, hy), hrx, hry, ha = HIGHLIGHT
    eyes = "".join(
        '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="#%02x%02x%02x"/><circle cx="%.1f" cy="%.1f" r="%.1f" fill="#fff"/><circle cx="%.1f" cy="%.1f" r="%.1f" fill="#fff" opacity=".92"/>'
        % (cx, cy, rx, ry, *INK, cx - rx * 0.28, cy - ry * 0.34, rx * 0.4, cx + rx * 0.34, cy + ry * 0.36, rx * 0.17)
        for (cx, cy), rx, ry in EYES
    )
    blush = "".join('<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="#%02x%02x%02x" opacity=".59"/>' % (cx, cy, rx, ry, *BLUSH) for (cx, cy), rx, ry in BLUSHES)
    mx, my = MOUTH_CENTRE
    mouth = "M%.1f,%.1f A%.1f,%.1f 0 0 0 %.1f,%.1f Z" % (mx - MOUTH_R, my, MOUTH_R, MOUTH_R * 0.95, mx + MOUTH_R, my)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
        '<defs><linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="%d" x2="0" y2="%d"><stop offset="0" stop-color="#%02x%02x%02x"/><stop offset="1" stop-color="#%02x%02x%02x"/></linearGradient>'
        '<clipPath id="clip"><path d="%s"/></clipPath><clipPath id="mouth"><path d="%s"/></clipPath></defs>'
        '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="#000" opacity=".41"/>'
        '<path d="%s" fill="url(#body)"/>'
        '<g clip-path="url(#clip)">'
        '<ellipse cx="%d" cy="%d" rx="%d" ry="%d" transform="rotate(%d %d %d)" fill="#fff" opacity=".59"/><circle cx="%d" cy="%d" r="14" fill="#fff" opacity=".59"/>'
        '<path d="%s" fill="none" stroke="#%02x%02x%02x" stroke-width="30" opacity=".55"/></g>'
        '%s%s<path d="%s" fill="#%02x%02x%02x"/>'
        '<g clip-path="url(#mouth)"><ellipse cx="%d" cy="%.1f" rx="%.1f" ry="%.1f" fill="#%02x%02x%02x"/></g></svg>\n'
        % (min(ys), max(ys), *TOP, *BOTTOM, bezier_path(BODY_POINTS), mouth, SHADOW[0][0], SHADOW[0][1], SHADOW[1], SHADOW[2],
           bezier_path(BODY_POINTS), hx, hy, hrx, hry, ha, hx, hy, hx + 128, hy + 52,
           bezier_path(BODY_POINTS), *RIM, blush, eyes, mouth, *INK,
           mx, my + MOUTH_R * 0.92, MOUTH_R * 0.55, MOUTH_R * 0.42, *TONGUE)
    )
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(svg)


def wordmark(path):
    """White 'Dito' on a transparent background (About dialog)."""
    font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 200)
    probe = Image.new("RGBA", (10, 10))
    box = ImageDraw.Draw(probe).textbbox((0, 0), "Dito", font=font)
    img = Image.new("RGBA", (box[2] - box[0] + 40, box[3] - box[1] + 40), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((20 - box[0], 20 - box[1]), "Dito", font=font, fill=(255, 255, 255, 255))
    img.save(path)


DARK_TILE = ((16, 27, 42), (9, 15, 24))
os.makedirs(ICONS, exist_ok=True)
os.makedirs(BRAND, exist_ok=True)
os.makedirs(SRC, exist_ok=True)
write_svg(os.path.join(SRC, "dito-logo.svg"))

cache = {}


def native(size):
    if size not in cache:
        cache[size] = icon(size, *DARK_TILE)
    return cache[size]


sizes = {"32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512,
         "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
         "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
         "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
         "StoreLogo.png": 50}
for name, s in sizes.items():
    native(s).save(os.path.join(ICONS, name))

# Windows icon: every size drawn natively, so the taskbar and window icons are crisp
ico_sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
ico_images = [native(s) for s in ico_sizes]
ico_images[-1].save(os.path.join(ICONS, "icon.ico"), format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico_images[:-1])
master = icon(1024, *DARK_TILE)
master.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "icon.icns"))
master.save(os.path.join(SRC, "app-icon.png"))
native(256).save(os.path.join(BRAND, "app-icon-256.png"))
native(64).save(os.path.join(BRAND, "app-icon-64.png"))
icon(256, (24, 52, 82), (14, 30, 48)).save(os.path.join(BRAND, "dark-mode-icon-256.png"))
wordmark(os.path.join(SRC, "wordmark-white.png"))
shutil.copyfile(os.path.join(SRC, "wordmark-white.png"), os.path.join(BRAND, "wordmark-white.png"))

# NSIS installer artwork: header 150x57, sidebar 164x314 (BMP, 24-bit), Night Owl palette
import random
from PIL import ImageFilter

NO_BG, NO_BG2, NO_FG, NO_BLUE, NO_PURPLE, NO_GREEN = (1, 22, 39), (11, 41, 66), (214, 222, 235), (130, 170, 255), (126, 87, 194), (173, 219, 103)


def night_sky(w, h, seed, stars):
    """Vertical Night Owl gradient with a few soft stars, drawn at 4x and shrunk."""
    k = 4
    img = Image.new("RGB", (w * k, h * k))
    px = ImageDraw.Draw(img)
    for y in range(h * k):
        t = y / (h * k - 1)
        px.line([(0, y), (w * k, y)], fill=tuple(int(NO_BG[i] + (NO_BG2[i] - NO_BG[i]) * t) for i in range(3)))
    rnd = random.Random(seed)
    for _ in range(stars):
        x, y, r = rnd.randrange(w * k), rnd.randrange(h * k), rnd.choice([1, 1, 2, 3])
        c = rnd.choice([NO_FG, NO_BLUE, NO_FG])
        px.ellipse([x - r, y - r, x + r, y + r], fill=c)
    return img, k


def glow(img, k, cx, cy, radius, color):
    layer = Image.new("RGB", img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse([(cx - radius) * k, (cy - radius) * k, (cx + radius) * k, (cy + radius) * k], fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(radius * k * 0.55))
    from PIL import ImageChops
    return ImageChops.add(img, layer)


def finish(img, k, w, h):
    return img.resize((w, h), Image.LANCZOS)


# The bitmaps are drawn at 3x: Windows stretches them to the dialog (more on high-DPI screens) and a
# bigger source stays smooth instead of showing pixels. NSIS scales them down to the control.
S = 3

# header: sky with the mark on the right
img, k = night_sky(150 * S, 57 * S, 7, 26 * S * S // 2)
img = glow(img, k, 124 * S, 28 * S, 24 * S, (44, 30, 82))
img = finish(img, k, 150 * S, 57 * S)
ic = mark(46 * S, False)
img.paste(ic, (100 * S, 5 * S), ic)
img.save(os.path.join(BRAND, "installer-header.bmp"))

# sidebar: sky, glow, the mark, name and tagline
img, k = night_sky(164 * S, 314 * S, 21, 90 * S * S)
img = glow(img, k, 82 * S, 120 * S, 62 * S, (58, 40, 110))
img = glow(img, k, 82 * S, 300 * S, 90 * S, (8, 52, 84))
img = finish(img, k, 164 * S, 314 * S)
big = mark(128 * S, True)
img.paste(big, (18 * S, 50 * S), big)
# text on a transparent layer drawn at 2x and shrunk, so the letters are anti-aliased
layer = Image.new("RGBA", (164 * S * 2, 314 * S * 2), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
bold = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 28 * S * 2)
light = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 13 * S * 2)
for text, font, y, fill in (("Dito", bold, 192, NO_FG), ("Designer", bold, 220, NO_BLUE)):
    w = d.textlength(text, font=font)
    d.text(((164 * S * 2 - w) / 2, y * S * 2), text, font=font, fill=fill + (255,))
tag = "für ADITO-Projekte"
w = d.textlength(tag, font=light)
d.text(((164 * S * 2 - w) / 2, 268 * S * 2), tag, font=light, fill=NO_GREEN + (255,))
layer = layer.resize((164 * S, 314 * S), Image.LANCZOS)
img = img.convert("RGBA")
img.alpha_composite(layer)
img.convert("RGB").save(os.path.join(BRAND, "installer-sidebar.bmp"))
print("done")
