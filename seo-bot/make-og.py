#!/usr/bin/env python3
"""Open Graph / Twitter card images (1200 x 630 JPEG) cropped from the site's own renders and construction photos.
Run locally when a source image changes: python3 site/seo-bot/make-og.py  (needs Pillow). Also writes seo-bot/images.json
(intrinsic sizes of the page images, so the static pages can set width/height and avoid layout shift)."""
import json, os, sys
from PIL import Image
SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OG = {  # key -> source image (renders / photo of the site itself)
    'home': 'assets/gallery/aerial-southeast.jpg', 'apartments': 'assets/gallery/night-corner-view.jpg',
    'b1': 'assets/gallery/street-east-buildings-2-1.jpg', 'b2': 'assets/gallery/commercial-podium-corner.jpg',
    'b3': 'assets/gallery/tower-and-spa.jpg', 'b4': 'assets/gallery/street-south-buildings-4-2.jpg',
    'location': 'assets/gallery/day-corner-view.jpg', 'parking': 'assets/gallery/aerial-south.jpg',
    'progress': 'assets/progress/2026-09-b1-1.jpg',
}
def crop(src, dst, W=1200, H=630):
    im = Image.open(os.path.join(SITE, src)).convert('RGB'); w, h = im.size
    s = max(W / w, H / h); im = im.resize((round(w * s), round(h * s)), Image.LANCZOS); w, h = im.size
    x, y = (w - W) // 2, (h - H) // 2
    im.crop((x, y, x + W, y + H)).save(os.path.join(SITE, dst), 'JPEG', quality=82, optimize=True, progressive=True)
sizes = {}
for k, src in OG.items():
    crop(src, f'assets/og/{k}.jpg')
for d in ('assets/gallery', 'assets/gallery/sm', 'assets/web'):
    for f in sorted(os.listdir(os.path.join(SITE, d))):
        if f.lower().endswith(('.jpg', '.webp', '.png')):
            try: sizes[f'{d}/{f}'] = Image.open(os.path.join(SITE, d, f)).size
            except Exception: pass
json.dump({'og': {k: f'assets/og/{k}.jpg' for k in OG}, 'sizes': sizes}, open(os.path.join(SITE, 'seo-bot', 'images.json'), 'w'), indent=0)
print('og images:', len(OG), 'sizes:', len(sizes))
