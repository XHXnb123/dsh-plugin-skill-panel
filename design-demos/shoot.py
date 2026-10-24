import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
h = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
full = "--full" in sys.argv

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
    pg.goto(url, wait_until="networkidle")
    try:
        pg.evaluate("() => document.fonts.ready.then(() => true)")
    except Exception:
        pass
    pg.wait_for_timeout(900)
    pg.screenshot(path=out, full_page=full)
    b.close()
print("saved", out)
