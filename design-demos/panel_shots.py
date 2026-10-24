"""只截 430×620 的面板本体，用于公平比较各版骨架。用法：python panel_shots.py g1-obsidian.html g2-starmap.html"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
DEFAULT = [
    ("dir-1.html", 0), ("dir-2.html", 0), ("dir-3.html", 340),
    ("g1-obsidian.html", 0), ("g2-starmap.html", 0), ("g3-radial.html", 0),
]

if len(sys.argv) > 1:
    targets = [(name, 0) for name in sys.argv[1:]]
else:
    targets = DEFAULT

with sync_playwright() as p:
    browser = p.chromium.launch()
    for src, scroll in targets:
        out = Path(src).stem + "-panel.png"
        page = browser.new_page(viewport={"width": 1180, "height": 760}, device_scale_factor=2)
        page.goto((HERE / src).as_uri())
        page.wait_for_timeout(900)
        page.evaluate("document.fonts.ready")
        if scroll:
            page.evaluate("s => { const b = document.querySelector('.p-body'); if (b) b.scrollTop = s; }", scroll)
            page.wait_for_timeout(250)
        el = page.query_selector(".panel")
        if el is None:
            print(f"{src}: .panel not found")
        else:
            el.screenshot(path=str(HERE / out))
            box = el.bounding_box()
            print(f"saved {out}  {box['width']:.0f}x{box['height']:.0f}")
        page.close()
    browser.close()
