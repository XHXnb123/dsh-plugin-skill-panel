"""常驻功能的 UI 验证：mock 掉三条路由，点节点 → 常驻 → 看标记和计数。

web profile 下第三方插件的 webServer 路由不生效，所以这里只验证客户端行为；
宿主侧路由由 test-routes.mjs 覆盖。
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
URL = sys.argv[1]
fixture = json.loads((HERE / "fixture-list.json").read_text(encoding="utf-8"))

pins_state = {"pins": []}


def handle_list(route):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps(fixture, ensure_ascii=False))


def handle_read(route):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "name": "demo", "path": "/tmp/demo/SKILL.md",
                                   "content": "# demo\n这是假的 SKILL.md 正文。"}, ensure_ascii=False))


def handle_pins(route):
    request = route.request
    if request.method == "POST":
        payload = request.post_data_json or {}
        pins_state["pins"] = list(payload.get("pins") or [])
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"ok": True, "pins": pins_state["pins"]}, ensure_ascii=False))
        return
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "pins": pins_state["pins"]}, ensure_ascii=False))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1180, "height": 760}, device_scale_factor=2)
    errors = []
    page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror:" + str(e)))

    page.route("**/skill-panel/list", handle_list)
    page.route("**/skill-panel/refresh", handle_list)
    page.route("**/skill-panel/pins", handle_pins)
    page.route("**/skill-panel/read?**", handle_read)

    page.goto(URL)
    page.wait_for_timeout(4500)

    page.click(".skp-capsule")
    page.wait_for_timeout(900)
    print("panel open:", page.is_visible(".skp-panel"))
    print("nodes:", page.locator(".skp-node").count())

    # 选第一个节点
    page.locator(".skp-node").first.click()
    page.wait_for_timeout(500)
    name = page.inner_text(".skp-selname")
    print("picked:", name)
    print("pin button before:", page.inner_text(".skp-selacts button:nth-child(4)"))

    # 常驻
    page.click(".skp-selacts button:nth-child(4)")
    page.wait_for_timeout(700)
    print("pin button after:", page.inner_text(".skp-selacts button:nth-child(4)"))
    print("pin rings on map:", page.locator(".skp-pinring").count())
    print("title:", page.inner_text(".skp-title"))
    print("server pins:", pins_state["pins"])
    # 取消选中，让节点上的常驻虚线环露出来
    page.locator(".skp-node").first.click()
    page.wait_for_timeout(500)
    page.screenshot(path=str(HERE / "shot-pins-on.png"))
    page.locator(".skp-node").first.click()
    page.wait_for_timeout(400)

    # 取消常驻
    page.click(".skp-selacts button:nth-child(4)")
    page.wait_for_timeout(700)
    print("pin button cleared:", page.inner_text(".skp-selacts button:nth-child(4)"))
    print("pin rings after clear:", page.locator(".skp-pinring").count())
    print("server pins after clear:", pins_state["pins"])

    if errors:
        print("ERRORS:", errors[:5])
    else:
        print("no console errors")
    browser.close()
