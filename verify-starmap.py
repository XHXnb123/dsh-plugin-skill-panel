"""验证星图面板：mock /skill-panel/* 走真实 fixture，检查节点数、选中卡片、执行插入、搜索。"""
import json
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
URL = sys.argv[1]
FIXTURE = json.loads((HERE / "fixture-list.json").read_text(encoding="utf-8"))
README = "# demo\n\n这是 mock 的 SKILL.md 正文，用来验证「看」视图。"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    errors = []
    page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror:" + str(e)))

    page.route("**/skill-panel/list", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(FIXTURE)))
    page.route("**/skill-panel/read?**", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"ok": True, "name": "huashu-design", "path": "C:/x/SKILL.md", "content": README})))
    page.route("**/skill-panel/refresh", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(FIXTURE)))

    page.goto(URL)
    page.wait_for_timeout(4500)

    # 打开面板
    page.click(".skp-capsule")
    page.wait_for_timeout(900)
    print("panel open:", page.is_visible(".skp-panel"))
    print("title:", page.inner_text(".skp-title"))
    print("nodes:", page.locator(".skp-node").count())
    print("arcs:", page.locator(".skp-arc").count())
    print("category labels:", page.eval_on_selector_all(".skp-cnst", "els => els.map(e => e.textContent)"))
    print("category en:", page.eval_on_selector_all(".skp-cnsten", "els => els.map(e => e.textContent)"))
    print("legend chips:", page.eval_on_selector_all(".skp-chip", "els => els.map(e => e.textContent)"))
    print("core:", page.eval_on_selector(".skp-corenum", "e => e.textContent"))
    print("hint:", page.inner_text(".skp-selection").strip()[:40])
    page.screenshot(path=str(HERE / "shot-star.png"))

    # 点第一个节点
    page.locator(".skp-node").first.click()
    page.wait_for_timeout(500)
    print("--- after pick ---")
    print("selname:", page.inner_text(".skp-selname"))
    print("selsrc:", page.inner_text(".skp-selsrc"))
    print("labels shown:", page.locator(".skp-nlabel.show").count())
    page.screenshot(path=str(HERE / "shot-star-picked.png"))

    # 插入到输入框
    page.click(".skp-selacts .skp-btn:not(.skp-primary)")  # 插入
    page.wait_for_timeout(500)
    val = page.evaluate("""() => {
      const n = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'))
        .filter(x => !x.closest('.skp-root'))[0];
      return n ? (n.value !== undefined ? n.value : n.innerText) : '(not found)';
    }""")
    print("composer after 插入:", json.dumps(val[:60], ensure_ascii=False))

    # 搜索
    page.click(".skp-capsule")
    page.wait_for_timeout(400)
    page.fill(".skp-search", "huashu")
    page.wait_for_timeout(500)
    print("--- after search huashu ---")
    print("title:", page.inner_text(".skp-title"))
    print("labels shown:", page.eval_on_selector_all(".skp-nlabel.show", "els => els.map(e => e.textContent)"))
    page.screenshot(path=str(HERE / "shot-star-search.png"))

    # 点「办公」chip 只看一类（先把搜索清掉，让六个分类都回来）
    page.fill(".skp-search", "")
    page.wait_for_timeout(600)
    page.click(".skp-chip:nth-child(3)")
    page.wait_for_timeout(600)
    print("--- after chip 办公 ---")
    print("nodes:", page.locator(".skp-node").count())
    print("arcs:", page.locator(".skp-arc").count())
    print("title:", page.inner_text(".skp-title"))
    page.screenshot(path=str(HERE / "shot-star-chip.png"))
    page.click(".skp-chip:nth-child(3)")
    page.wait_for_timeout(400)
    print("nodes after unclick:", page.locator(".skp-node").count())

    if errors:
        print("ERRORS:", errors[:6])
    else:
        print("no console errors")
    browser.close()
