"""Plan editing on the isolated fixture server only."""
import json
import os
import uuid
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.set_default_timeout(20000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:7466/")
    page.wait_for_load_state("networkidle")
    assert "新建小说" in page.get_by_role("button").all_text_contents()
    page.get_by_role("button", name="新建小说", exact=True).click()
    page.get_by_label("小说名称").fill("计划版本 " + str(uuid.uuid4())[:8])
    page.get_by_label("一句灵感").fill("修钟人收到旧信。")
    page.get_by_label("目标章数").fill("3")
    page.get_by_label("每章字数").fill("500")
    page.get_by_role("button", name="创建小说", exact=True).click()
    page.get_by_role("button", name="生成开书方案", exact=True).click()
    page.get_by_role("button", name="确认设定，准备开篇", exact=True).click()
    page.get_by_role("button", name="计划管理", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("button", name="编辑为新版本", exact=True).click()
    content = page.get_by_role("textbox", name="计划内容")
    payload = json.loads(content.input_value())
    payload["summary"] = "新的方向：探访钟楼并追查来信。"
    content.fill(json.dumps(payload, ensure_ascii=False))
    page.get_by_role("button", name="保存计划候选", exact=True).click()
    page.get_by_role("button", name="确认全书更改并校验", exact=True).click()
    expect(page.get_by_role("button", name="确认全书更改并校验", exact=True)).to_have_count(0)
    expect(dialog.get_by_text("新的方向：探访钟楼并追查来信。", exact=True)).to_be_visible()
    dialog.get_by_role("button", name="关闭", exact=True).click()
    page.get_by_role("button", name="生成本章", exact=True).click()
    expect(page.get_by_text("已完成 1 章", exact=False)).to_be_visible()
    page.get_by_role("button", name="全书与初始设定", exact=True).click()
    expect(page.get_by_text("新的方向：探访钟楼并追查来信。", exact=True)).to_be_visible()
    page.reload()
    page.get_by_role("button", name="计划管理", exact=True).click()
    expect(page.get_by_role("dialog").get_by_role("heading", name="剧情单元", exact=True)).to_be_visible()
    assert not errors, errors
    page.screenshot(path="test-results/plans.png", full_page=True)
    browser.close()
    print("PASS: plan candidate -> validated activation -> chapter -> reload")
