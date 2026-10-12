"""Tiles review stills into one contact sheet: python3 scripts/sheet.py out.jpg frame frame ..."""
import sys
from PIL import Image
out, frames = sys.argv[1], sys.argv[2:]
ims = [Image.open(f"out/stills/{int(f):04d}.jpg") for f in frames]
w, h = ims[0].size
rows = (len(ims) + 1) // 2
sheet = Image.new("RGB", (w * 2 + 10, (h + 10) * rows), "white")
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 2) * (w + 10), (i // 2) * (h + 10)))
sheet.save(out, quality=85)
