"""验证 skill 介绍显示成中文：点一个原本描述为英文的 skill，看卡片文案。"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
URL = sys.argv[1]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1180, "height": 900}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_timeout(5000)
    page.click(".skp-capsule")
    page.wait_for_timeout(1000)

    print("title:", page.inner_text(".skp-title"))

    # 逐个点节点，记录名字 + 显示出来的介绍
    count = page.locator(".skp-node").count()
    print("nodes:", count)
    rows = []
    for i in range(min(count, 26)):
        page.locator(".skp-node").nth(i).click()
        page.wait_for_timeout(120)
        name = page.eval_on_selector(".skp-selname", "e => e.textContent")
        desc = page.eval_on_selector(".skp-seldesc", "e => e.textContent")
        rows.append((name, desc))
        page.locator(".skp-node").nth(i).click()
        page.wait_for_timeout(80)

    ascii_only = [name for name, desc in rows if desc and all(ord(ch) < 128 for ch in desc)]
    print("总节点:", len(rows))
    print("介绍里没有中文的:", ascii_only if ascii_only else "（无，全部已中文化）")
    print("\n抽样：")
    for name, desc in rows[:6]:
        print(f"  {name}: {desc[:48]}")

    # 截图：选一个原本是英文介绍的
    page.locator(".skp-node").nth(0).click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(HERE / "shot-zh.png"))
    browser.close()
