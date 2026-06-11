"""Generate all app icon sizes from source image.

The source is a rounded card with its own border. We extract only the
content (church drawing + text), then lay it on a flat background that
fills the whole canvas — so the platform mask is the only frame.
"""
from PIL import Image
import os
import struct
import io
from collections import Counter

SRC = r"C:\csh\project\chflow\image\KakaoTalk_20260611_104229871.png"
APP_PUBLIC = r"C:\csh\project\chflow\chflow-app\public"
EXPO_ASSETS = r"C:\csh\project\chflow\chflow-expo\assets"

src = Image.open(SRC).convert("RGBA")
w, h = src.size
px = src.load()

# 1) Card interior background color = most common opaque color
counter = Counter()
for y in range(0, h, 4):
    for x in range(0, w, 4):
        r, g, b, a = px[x, y]
        if a > 240:
            counter[(r, g, b)] += 1
BG = counter.most_common(1)[0][0]
print(f"Card interior color: {BG}")

def colordist(c1, c2):
    return abs(c1[0]-c2[0]) + abs(c1[1]-c2[1]) + abs(c1[2]-c2[2])

# 2) Content bbox = orange artwork only (r >> b), so the gray card
#    border/shadow ring is excluded. Scan inside a 5% inset to be safe.
inset_x, inset_y = int(w * 0.05), int(h * 0.05)
minx, miny, maxx, maxy = w, h, 0, 0
for y in range(inset_y, h - inset_y, 2):
    for x in range(inset_x, w - inset_x, 2):
        r, g, b, a = px[x, y]
        if a > 240 and (r - b) > 45 and colordist((r, g, b), BG) > 90:
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
print(f"Content bbox: ({minx},{miny})-({maxx},{maxy})  size {maxx-minx}x{maxy-miny}")

# Small breathing margin around content, but stay inside the card interior
PAD = 14
content = src.crop((max(minx-PAD, 0), max(miny-PAD, 0), min(maxx+PAD, w), min(maxy+PAD, h)))

# 3) Clean: keep only orange strokes (alpha from r-b), drop gray shadows
content = content.copy()
cpx = content.load()
cw, ch = content.size
for y in range(ch):
    for x in range(cw):
        r, g, b, a = cpx[x, y]
        rb = r - b
        # bg cream has r-b ~= 12; strokes ~= 100+. Soft ramp keeps antialiasing.
        alpha = max(0, min(255, int((rb - 18) * 4.2)))
        cpx[x, y] = (r, g, b, min(a, alpha))

def make_icon(path, canvas_size, content_frac):
    """Flat bg canvas, content centered at content_frac of canvas size."""
    target = int(canvas_size * content_frac)
    scale = min(target / cw, target / ch)
    nw, nh = int(cw * scale), int(ch * scale)
    resized = content.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), BG + (255,))
    canvas.paste(resized, ((canvas_size - nw) // 2, (canvas_size - nh) // 2), resized)
    canvas.save(path, optimize=True)
    print(f"  {os.path.basename(path):28s} {canvas_size}px  content {content_frac:.0%} -> {nw}x{nh}")

def make_ico(path, sizes, content_frac):
    images_data = []
    for size in sizes:
        target = int(size * content_frac)
        scale = min(target / cw, target / ch)
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
        resized = content.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), BG + (255,))
        canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        images_data.append((size, buf.getvalue()))
    header = struct.pack("<HHH", 0, 1, len(images_data))
    offset = 6 + 16 * len(images_data)
    directory = b""
    for size, data in images_data:
        directory += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0, size if size < 256 else 0,
            0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + directory)
        for _, data in images_data:
            f.write(data)
    print(f"  {os.path.basename(path):28s} multi {[s for s, _ in images_data]}")

print("\n=== chflow-app/public ===")
make_icon(os.path.join(APP_PUBLIC, "icon-512.png"),       512, 0.74)
make_icon(os.path.join(APP_PUBLIC, "icon-192.png"),       192, 0.74)
make_icon(os.path.join(APP_PUBLIC, "icon-96.png"),         96, 0.74)
make_icon(os.path.join(APP_PUBLIC, "apple-icon.png"),     180, 0.74)
make_icon(os.path.join(APP_PUBLIC, "brand-mark-512.png"), 512, 0.74)
make_icon(os.path.join(APP_PUBLIC, "brand-mark-192.png"), 192, 0.74)
make_ico(os.path.join(APP_PUBLIC, "favicon.ico"), [16, 32, 48], 0.84)

print("\n=== chflow-expo/assets ===")
# Play Store listing icon: full-bleed bg + roomy content
make_icon(os.path.join(EXPO_ASSETS, "icon.png"),          1024, 0.72)
# Android adaptive foreground: bbox corners must stay inside the safe
# circle (r=338 at 1024px) -> content height <= ~50% of canvas
make_icon(os.path.join(EXPO_ASSETS, "adaptive-icon.png"), 1024, 0.50)
make_icon(os.path.join(EXPO_ASSETS, "favicon.png"),         48, 0.80)

print("\nDone.")
