"""Renders the demo's still images from the built demo, in a real browser.

- static.webp: the opening state (day 0), shown while the demo loads and without JavaScript.
- thumb.webp and og.jpg: the default run (Munz et al. from Prague) with a ring of cordon drawn
  around Prague before detection, on CARD_DAY, for the project card and link previews.

It serves demo/dist/ locally, drives it with Playwright, and writes the images to demo/public/,
fitted onto the dark page colour and kept under the bundle contract's size limits. Build first:

    cd demo && npm run build && cd ..
    uv run --with playwright --with pillow python scripts/stills.py            # Microsoft Edge
    uv run --with playwright --with pillow python scripts/stills.py chrome     # or another channel

Then rebuild, so dist/ picks up the new images.
"""

import functools
import io
import math
import re
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "demo" / "dist"
OUT = ROOT / "demo" / "public"
BACKGROUND = (10, 14, 20)  # --color-bg, dark: the site's default theme
CARD_DAY = 30
# The card's cordon: a ring around Prague, in cells (km), drawn before detection. It holds.
PRAGUE = (174, 139)
RING = 55
GRID = (511, 319)
PADDING = 12  # the map's padding inside the stage, as in demo/src/render/map.js
# A narrow page gets a 16:9 stage and no inset chart; this scale makes it about 1200 px wide.
VIEWPORT = {"width": 540, "height": 1400}
SCALE = 2.4
READY = "/Day \\d+/.test(document.querySelector('.dk-status')?.textContent)"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def fit(png, width, height):
    image = Image.open(io.BytesIO(png)).convert("RGB")
    scale = min(width / image.width, height / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def save(image, name, fmt, limit, **options):
    for quality in range(90, 40, -5):
        buffer = io.BytesIO()
        image.save(buffer, fmt, quality=quality, **options)
        if limit is None or buffer.tell() < limit:
            break
    else:
        raise SystemExit(f"{name}: could not get under {limit / 1000:.0f} KB")
    (OUT / name).write_bytes(buffer.getvalue())
    print(f"{name}: {image.width}×{image.height}, quality {quality}, {buffer.tell() / 1000:.1f} KB")


def draw_ring(page):
    """Draws the card's cordon with the mouse: a closed ring of RING km around Prague."""
    page.get_by_label("Draw cordon").check()
    stage = page.locator(".dk-stage-content")
    stage.scroll_into_view_if_needed()
    box = stage.bounding_box()
    scale = min((box["width"] - 2 * PADDING) / GRID[0], (box["height"] - 2 * PADDING) / GRID[1])
    x0 = box["x"] + (box["width"] - GRID[0] * scale) / 2
    y0 = box["y"] + (box["height"] - GRID[1] * scale) / 2
    points = [
        (x0 + (PRAGUE[0] + 0.5 + RING * math.cos(a)) * scale, y0 + (PRAGUE[1] + 0.5 + RING * math.sin(a)) * scale)
        for a in (2 * math.pi * k / 72 for k in range(73))
    ]
    page.mouse.move(*points[0])
    page.mouse.down()
    for point in points[1:]:
        page.mouse.move(*point, steps=2)
    page.mouse.up()
    page.get_by_label("Draw cordon").uncheck()
    page.mouse.move(0, 0)


def main():
    channel = sys.argv[1] if len(sys.argv) > 1 else "msedge"
    if not (DIST / "index.html").exists():
        raise SystemExit("No demo/dist/: run `npm run build` in demo/ first")
    server = serve()
    url = f"http://127.0.0.1:{server.server_port}/"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=channel)

        # The opening state: with reduced motion, the demo starts paused on day 0.
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=SCALE, reduced_motion="reduce")
        page.goto(url)
        page.wait_for_function(READY, timeout=30000)
        opening = page.locator(".dk-stage").screenshot()
        page.close()

        # The card: the default run with a ring around Prague, on CARD_DAY, paused there.
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=SCALE)
        page.goto(url)
        page.wait_for_function(READY, timeout=30000)
        page.get_by_role("button", name="Pause").click()
        draw_ring(page)
        page.get_by_role("button", name="Play").click()
        page.get_by_label("Speed").select_option(label="4×")
        page.wait_for_function(
            f"+(/Day (\\d+)/.exec(document.querySelector('.dk-status').textContent) || [0, 0])[1] >= {CARD_DAY}",
            timeout=120000,
        )
        page.get_by_role("button", name="Pause").click()
        page.wait_for_timeout(300)
        status = page.locator(".dk-status").text_content()
        card = page.locator(".dk-stage").screenshot()
        browser.close()
    server.shutdown()

    print(f"card: {re.sub(r'\\s+', ' ', status)}")
    save(fit(opening, 1200, 675), "static.webp", "WEBP", None, method=6)
    save(fit(card, 1200, 675), "thumb.webp", "WEBP", 80_000, method=6)
    save(fit(card, 1200, 630), "og.jpg", "JPEG", 150_000, optimize=True, progressive=True)


if __name__ == "__main__":
    main()
