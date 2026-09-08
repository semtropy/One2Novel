"""Run against tests/e2e/server.ts only; uses its isolated database and model fixture."""
import json
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    expect.set_options(timeout=25000)
    page.goto("http://127.0.0.1:7466")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="新建小说", exact=True).click()
    page.get_by_label("小说名称").fill("解困流程验收")
    page.get_by_label("一句灵感").fill("修钟人循着来信寻找失踪的摆渡人。")
    page.get_by_label("目标章数").fill("3")
    page.get_by_label("每章字数").fill("500")
    page.get_by_role("button", name="创建小说", exact=True).click()
    page.get_by_role("button", name="生成开书方案", exact=True).click()
    page.get_by_role("button", name="编辑方案", exact=True).click()
    page.get_by_text("高级：完整设定与身份引用", exact=True).click()
    textarea = page.locator("textarea.json-editor")
    opening = json.loads(textarea.input_value())
    opening["state"]["worldRules"][str(uuid.uuid4())] = {
        "description": "浏览器测试：需要人工修订", "scopeEntityIds": [],
        "constraint": None, "mutable": False, "active": True,
    }
    textarea.fill(json.dumps(opening, ensure_ascii=False))
    page.get_by_role("button", name="保存新方案", exact=True).click()
    page.get_by_role("button", name="确认设定，准备开篇").click()
    page.get_by_role("button", name="连续创作", exact=True).click()
    page.get_by_label("本批章数").fill("3")
    page.get_by_role("button", name="开始连续创作").click()
    expect(page.locator(".job-panel")).to_contain_text("等待处理")
    expect(page.get_by_role("button", name="恢复任务", exact=True)).to_be_disabled()
    page.reload()
    expect(page.get_by_role("button", name="查看失败候选", exact=True)).to_be_visible()
    page.get_by_role("button", name="查看失败候选", exact=True).click()
    expect(page.locator(".manuscript-title")).to_contain_text("历史候选")
    page.get_by_role("button", name="载入此候选到草稿", exact=True).click()
    editor = page.get_by_role("textbox", name="章节正文")
    editor.fill(editor.inner_text() + "\n\n人工修订完成。")
    expect(page.locator(".editor-footer")).to_contain_text("已保存")
    page.get_by_role("button", name="审核并提交草稿", exact=True).click()
    expect(page.get_by_text("已完成 1 章", exact=False)).to_be_visible()
    project_id = page.url.split("/")[-1]
    data = page.request.get(f"http://127.0.0.1:7466/api/v1/projects/{project_id}").json()["data"]
    parent = next(j for j in data["jobs"] if j["kind"] == "BATCH")
    assert parent["status"] == "CANCELLED"
    assert len(parent["children"]) == 1
    assert data["headChapter"] == 1
    assert data["jobs"][0]["input"]["mode"] == "AUDIT_DRAFT"
    assert "人工修订完成" in data["jobs"][0]["input"]["text"]
    assert not errors, errors
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/recovery-completed.png", full_page=True)
    browser.close()
    print("PASS: waiting -> candidate -> edited draft -> new audited job; old batch retired")
