"""常驻按钮在「宿主还没加载 pins 路由」时的降级表现。

web profile 下第三方插件的 webServer 路由本来就不生效（返回 404），正好复现
用户重启前的状态：client 应当把按钮标成「常驻（待重启）」，点它给一句提示，
而不是看起来没反应。
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
URL = sys.argv[1]
fixture = json.loads((HERE / "fixture-list.json").read_text(encoding="utf-8"))


def handle_list(route):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps(fixture, ensure_ascii=False))


def handle_read(route):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "name": "demo", "path": "/tmp/demo/SKILL.md",
                                   "content": "# demo\n假正文"}, ensure_ascii=False))


def handle_pins_404(route):
    route.fulfill(status=404, content_type="text/plain", body="no route")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1180, "height": 760}, device_scale_factor=2)
    page.route("**/skill-panel/list", handle_list)
    page.route("**/skill-panel/refresh", handle_list)
    page.route("**/skill-panel/pins", handle_pins_404)
    page.route("**/skill-panel/read?**", handle_read)

    page.goto(URL)
    page.wait_for_timeout(4500)
    page.click(".skp-capsule")
    page.wait_for_timeout(900)
    page.locator(".skp-node").first.click()
    page.wait_for_timeout(500)

    print("pin button (404 host):", page.inner_text(".skp-selacts button:nth-child(4)"))
    print("pin button class:", page.eval_on_selector(".skp-selacts button:nth-child(4)", "e => e.className"))
    print("pin button title:", page.eval_on_selector(".skp-selacts button:nth-child(4)", "e => e.title"))

    page.click(".skp-selacts button:nth-child(4)")
    page.wait_for_timeout(600)
    toast = page.locator(".skp-toast")
    print("toast:", toast.inner_text() if toast.count() else "(none)")
    page.screenshot(path=str(HERE / "shot-pins-404.png"))
    browser.close()
