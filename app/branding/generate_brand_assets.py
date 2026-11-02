"""Regenerates every Vendira logo/icon asset from the vector logo.

Source: branding/source/vendira-logo-color.svg (the V mark with its three gradients, viewBox
861x620) and branding/source/wordmark-white.png (white wordmark on transparent background).
The SVG is not edited; its three paths are rasterised as masks (PyMuPDF) and filled with the
SVG's own linear gradients here, because the SVG renderer used does not resolve the gradients.

    python branding/generate_brand_assets.py          (needs: pip install pymupdf pillow)

Outputs: src-tauri/icons/* and ui/src/assets/brand/* (app icon 1024 px master on a dark rounded
tile, dark-mode icon, NSIS header/sidebar bitmaps). The wordmark is copied as it is.
"""
import os
import re
import shutil
import pymupdf
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
ICONS = os.path.join(HERE, "..", "src-tauri", "icons")
BRAND = os.path.join(HERE, "..", "ui", "src", "assets", "brand")
SVG = os.path.join(SRC, "vendira-logo-color.svg")

svg_text = open(SVG, encoding="utf-8").read()
VB_W, VB_H = [float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text).groups()]


def gradient_stops(gid):
    block = re.search(r'<linearGradient id="%s"[^>]*>(.*?)</linearGradient>' % gid, svg_text, re.S).group(1)
    attrs = re.search(r'<linearGradient id="%s"([^>]*)>' % gid, svg_text).group(1)
    xy = [float(re.search(r'%s="([-\d.]+)"' % k, attrs).group(1)) for k in ("x1", "y1", "x2", "y2")]
    stops = []
    for m in re.finditer(r'<stop offset="([\d.]+)" stop-color="#([0-9a-fA-F]{6})"(?: stop-opacity="([\d.]+)")?', block):
        c = m.group(2)
        stops.append((float(m.group(1)), (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)), float(m.group(3) or 1)))
    return xy, stops


def paths():
    out = {}
    for m in re.finditer(r'<path class="(cls-\d)" d="([^"]+)"', svg_text):
        out[m.group(1)] = m.group(2)
    return out


def mask_of(d, width, supersample=2):
    k = width / VB_W
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s"><path d="%s" fill="#000"/></svg>' % (VB_W, VB_H, d)
    doc = pymupdf.open(stream=svg.encode(), filetype="svg")
    zoom = k * supersample
    pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
    img = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    a = img.getchannel("A")
    return a.resize((round(VB_W * k), round(VB_H * k)), Image.LANCZOS)


def lerp_stops(stops, t):
    t = max(0.0, min(1.0, t))
    if t <= stops[0][0]:
        return stops[0][1], stops[0][2]
    for (o0, c0, a0), (o1, c1, a1) in zip(stops, stops[1:]):
        if t <= o1:
            f = 0 if o1 == o0 else (t - o0) / (o1 - o0)
            return tuple(c0[i] + (c1[i] - c0[i]) * f for i in range(3)), a0 + (a1 - a0) * f
    return stops[-1][1], stops[-1][2]


def gradient_fill(size, k, gid):
    (x1, y1, x2, y2), stops = gradient_stops(gid)
    dx, dy = x2 - x1, y2 - y1
    den = dx * dx + dy * dy
    img = Image.new("RGBA", size)
    data = []
    for py in range(size[1]):
        for px in range(size[0]):
            ux, uy = (px + 0.5) / k, (py + 0.5) / k
            t = ((ux - x1) * dx + (uy - y1) * dy) / den
            c, a = lerp_stops(stops, t)
            data.append((int(c[0]), int(c[1]), int(c[2]), int(a * 255)))
    img.putdata(data)
    return img


def mark(width):
    """The V mark with its gradients; the dark shade layer uses the SVG's multiply blend at 40 %."""
    k = width / VB_W
    p = paths()
    size = (round(VB_W * k), round(VB_H * k))
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for cls, gid in (("cls-3", "Unbenannter_Verlauf_199"), ("cls-2", "Unbenannter_Verlauf_230")):
        layer = gradient_fill(size, k, gid)
        layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", size, 0), mask_of(p[cls], width)))
        out = Image.alpha_composite(out, layer)
    shade = gradient_fill(size, k, "Unbenannter_Verlauf_275")
    shade_mask = mask_of(p["cls-4"], width).point(lambda v: int(v * 0.4))
    base = out.copy()
    px_base, px_shade = base.load(), shade.load()
    sm = shade_mask.load()
    res = out.load()
    for y in range(size[1]):
        for x in range(size[0]):
            r, g, b, a = px_base[x, y]
            if a == 0:
                continue
            sr, sg, sb, sa = px_shade[x, y]
            w = (sm[x, y] / 255.0) * (sa / 255.0)
            if w <= 0:
                continue
            mr, mg, mb = r * sr / 255.0, g * sg / 255.0, b * sb / 255.0
            res[x, y] = (int(r + (mr - r) * w), int(g + (mg - g) * w), int(b + (mb - b) * w), a)
    return out


def tile(size, top, bottom, radius_ratio=0.225):
    grad = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        f = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)) + (255,))
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), int(size * 4 * radius_ratio), fill=255)
    grad.putalpha(m.resize((size, size), Image.LANCZOS))
    return grad


def icon(size, top, bottom):
    t = tile(size, top, bottom)
    v = mark(round(size * 0.62))
    # Optical centre: the V's visual weight sits slightly above the geometric middle.
    t.alpha_composite(v, ((size - v.width) // 2, (size - v.height) // 2 + round(size * 0.015)))
    return t


# Brand guide dark tile (installer artwork uses the same (11,18,28)).
master = icon(1024, (16, 27, 42), (9, 15, 24))
dark_master = icon(1024, (24, 52, 82), (14, 30, 48))

os.makedirs(ICONS, exist_ok=True)
os.makedirs(BRAND, exist_ok=True)
sizes = {"32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512,
         "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
         "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
         "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
         "StoreLogo.png": 50}
for name, s in sizes.items():
    master.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, name))
master.save(os.path.join(ICONS, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
master.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "icon.icns"))
master.save(os.path.join(SRC, "app-icon.png"))
master.resize((256, 256), Image.LANCZOS).save(os.path.join(BRAND, "app-icon-256.png"))
master.resize((64, 64), Image.LANCZOS).save(os.path.join(BRAND, "app-icon-64.png"))
dark_master.resize((256, 256), Image.LANCZOS).save(os.path.join(BRAND, "dark-mode-icon-256.png"))
shutil.copyfile(os.path.join(SRC, "wordmark-white.png"), os.path.join(BRAND, "wordmark-white.png"))

# NSIS installer artwork: header 150x57, sidebar 164x314 (BMP, 24-bit)
bg = (11, 18, 28)
hdr = Image.new("RGB", (150, 57), bg)
ic = master.resize((41, 41), Image.LANCZOS)
hdr.paste(ic, (104, 8), ic)
hdr.save(os.path.join(BRAND, "installer-header.bmp"))
side = Image.new("RGB", (164, 314), bg)
big = master.resize((96, 96), Image.LANCZOS)
side.paste(big, (34, 90), big)
side.save(os.path.join(BRAND, "installer-sidebar.bmp"))
print("done")
