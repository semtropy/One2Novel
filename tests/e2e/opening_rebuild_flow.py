"""Run only against the isolated tests/e2e/server.ts fixture (port 7466)."""
import json
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.set_default_timeout(20000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:7466/")
    page.wait_for_load_state("networkidle")
    assert "新建小说" in page.get_by_role("button").all_text_contents()
    page.get_by_role("button", name="新建小说", exact=True).click()
    page.get_by_label("小说名称").fill("重建开篇 " + str(uuid.uuid4())[:8])
    page.get_by_label("一句灵感").fill("修钟人收到一封旧信。")
    page.get_by_label("目标章数").fill("3")
    page.get_by_label("每章字数").fill("500")
    page.get_by_role("button", name="创建小说", exact=True).click()
    page.get_by_role("button", name="生成开书方案", exact=True).click()
    page.get_by_role("button", name="确认设定，准备开篇", exact=True).click()
    editor = page.get_by_role("textbox", name="章节正文")
    editor.fill("重建后仍应保留的草稿。")
    expect(page.locator(".editor-footer")).to_contain_text("已保存")
    project_id = page.url.split("/")[-1]
    endpoint = f"http://127.0.0.1:7466/api/v1/projects/{project_id}"
    before = page.request.get(endpoint).json()["data"]
    page.get_by_role("button", name="全书与初始设定", exact=True).click()
    page.get_by_role("button", name="修改初始设定", exact=True).click()
    expect(page.locator("textarea.json-editor")).not_to_be_visible()
    page.get_by_label("全书概要", exact=True).fill("修改后的全书方向：信件引出钟楼秘密。")
    page.get_by_label("开篇介绍", exact=False).first.fill("开篇前已在钟楼工作三年。")
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/opening-form.png", full_page=True)
    page.get_by_role("button", name="保存新方案", exact=True).click()
    expect(page.get_by_text("当前展示待确认的新方案。", exact=False)).to_be_visible()
    pending = page.request.get(endpoint).json()["data"]
    assert pending["headSnapshotId"] == before["headSnapshotId"]
    candidate = next(a["payload"] for a in pending["artifacts"] if a["kind"] == "OPENING")
    assert candidate["book"]["summary"] == "修改后的全书方向：信件引出钟楼秘密。"
    assert any(e["description"] == "开篇前已在钟楼工作三年。" for e in candidate["state"]["entities"].values())
    page.reload()
    page.get_by_role("button", name="全书与初始设定", exact=True).click()
    page.get_by_role("button", name="确认新设定，重建开篇", exact=True).click()
    expect(page.get_by_role("button", name="确认新设定，重建开篇", exact=True)).to_have_count(0)
    after = page.request.get(endpoint).json()["data"]
    assert after["headSnapshotId"] != before["headSnapshotId"]
    assert after["chainEpoch"] == before["chainEpoch"] + 1
    page.get_by_role("button", name="01 第一章", exact=True).click()
    expect(editor).to_contain_text("重建后仍应保留的草稿。")
    page.get_by_role("button", name="生成本章", exact=True).click()
    expect(page.get_by_text("已完成 1 章", exact=False)).to_be_visible()
    page.get_by_role("button", name="全书与初始设定", exact=True).click()
    expect(page.get_by_text("修改初始设定须先从第一章重写。", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="修改初始设定", exact=True)).to_have_count(0)
    assert not errors, errors
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/opening-rebuilt.png", full_page=True)
    browser.close()
    print("PASS: confirmed canon -> pending edit -> reload -> rebuild -> retained draft -> chapter commit")
