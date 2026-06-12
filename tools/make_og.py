#!/usr/bin/env python3
"""Generate assets/og.png, the 1200x630 social-preview card.

Run with any python that has Pillow:  python tools/make_og.py
Colors mirror css/style.css.
"""

import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (15, 17, 23)
CARD = (28, 32, 44)
BORDER = (42, 47, 62)
HOLE = (15, 17, 23)
TEXT = (232, 234, 240)
MUTED = (154, 161, 178)
BLUE = (108, 140, 255)
YELLOW = (251, 191, 36)


def font(size, bold=True):
    names = ["segoeuib.ttf" if bold else "segoeui.ttf",
             "arialbd.ttf" if bold else "arial.ttf",
             "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    folders = [r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu"]
    for folder in folders:
        for name in names:
            path = os.path.join(folder, name)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Right side: a Connect 4 board card with a game in progress.
cell, gap = 52, 10
cols, rows = 7, 6
bw = cols * cell + (cols + 1) * gap
bh = rows * cell + (rows + 1) * gap
bx, by = W - bw - 70, (H - bh) // 2
d.rounded_rectangle([bx, by, bx + bw, by + bh], 20, fill=CARD, outline=BORDER, width=2)
discs = {
    (3, 5): BLUE, (4, 5): YELLOW, (2, 5): BLUE, (5, 5): YELLOW, (1, 5): BLUE,
    (3, 4): YELLOW, (4, 4): BLUE, (2, 4): YELLOW,
    (3, 3): BLUE, (4, 3): YELLOW,
    (3, 2): BLUE,
}
for r in range(rows):
    for c in range(cols):
        x = bx + gap + c * (cell + gap)
        y = by + gap + r * (cell + gap)
        color = discs.get((c, r), HOLE)
        d.ellipse([x, y, x + cell, y + cell], fill=color,
                  outline=BORDER if color == HOLE else color, width=2)

# Left side: title + tagline.
tx = 70
d.text((tx, 175), "Turing", font=font(92), fill=TEXT)
d.text((tx, 280), "Tables", font=font(92), fill=BLUE)
d.text((tx, 410), "Play board games\nwith your AI agent", font=font(36, bold=False),
       fill=MUTED, spacing=10)
d.text((tx, 535), "tic-tac-toe  |  connect 4  |  gomoku", font=font(26, bold=False),
       fill=MUTED)

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "assets", "og.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out, optimize=True)
print(f"wrote {out} ({os.path.getsize(out)} bytes)")
