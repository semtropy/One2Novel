"""User-facing style/template forms through two chapter commits; isolated fixture only."""
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"), headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    page.set_default_timeout(20000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    suffix = str(uuid.uuid4())[:8]
    style_name, template_name = "冷静叙述 " + suffix, "线索推进 " + suffix
    page.goto("http://127.0.0.1:7466/library")
    page.wait_for_load_state("networkidle")
    assert "新建风格" in page.get_by_role("button").all_text_contents()
    page.get_by_role("button", name="新建风格", exact=True).click()
    page.get_by_label("风格名称", exact=True).fill(style_name)
    page.get_by_label("叙述视角", exact=True).select_option("FIRST")
    page.get_by_label("文字气质", exact=True).fill("冷静\n有悬念")
    page.get_by_label("对白比例最低（%）", exact=True).fill("10")
    page.get_by_label("对白比例最高（%）", exact=True).fill("50")
    page.get_by_label("避免使用的表达", exact=True).fill("命运的齿轮开始转动")
    page.get_by_label("其他写作偏好", exact=True).fill("用动作表现不安。\n避免重复解释动机。")
    page.get_by_role("button", name="保存文字风格", exact=True).click()
    expect(page.get_by_label("叙述视角", exact=True)).to_have_value("FIRST")
    expect(page.get_by_label("知识内容", exact=True)).to_have_count(0)
    # Existing entries remain editable without JSON, including line breaks and percent round trips.
    page.get_by_label("其他写作偏好", exact=True).fill("用动作表现不安。\n少用旁白解释。")
    page.get_by_role("button", name="保存修改", exact=True).click()
    page.get_by_role("button", name="发布知识版本", exact=True).click()
    expect(page.get_by_role("link", name="用它开始新小说", exact=True)).to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1100})
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/style-form.png", full_page=True)
    page.get_by_role("button", name="新建模板", exact=True).click()
    page.get_by_label("模板名称", exact=True).fill(template_name)
    page.get_by_label("章节目的与节奏", exact=True).fill("每章推进一条线索。")
    page.get_by_label("具体写作要求", exact=True).fill("让行动产生后果。\n结尾留下自然的疑问。")
    page.get_by_role("button", name="保存写作模板", exact=True).click()
    expect(page.get_by_label("知识内容", exact=True)).to_have_count(0)
    expect(page.get_by_label("具体写作要求", exact=True)).to_have_value("让行动产生后果。\n结尾留下自然的疑问。")
    page.get_by_role("button", name="发布知识版本", exact=True).click()
    page.get_by_role("link", name="用它开始新小说", exact=True).click()
    expect(page.get_by_text("将应用：" + template_name, exact=False)).to_be_visible()
    page.get_by_label("小说名称", exact=True).fill("表单闭环 " + suffix)
    page.get_by_label("一句灵感", exact=True).fill("修钟人追查一封旧信。")
    page.get_by_label("目标章数", exact=True).fill("2")
    page.get_by_label("每章字数", exact=True).fill("500")
    page.get_by_role("button", name="创建小说", exact=True).click()
    page.get_by_role("button", name="创作知识", exact=True).click()
    page.get_by_role("checkbox", name=style_name, exact=False).last.check()
    page.get_by_role("button", name="保存知识绑定", exact=True).click()
    page.get_by_role("button", name="生成开书方案", exact=True).click()
    page.get_by_role("button", name="确认设定，准备开篇", exact=True).click()
    page.get_by_role("button", name="生成本章", exact=True).click()
    expect(page.get_by_text("已完成 1 章", exact=False)).to_be_visible()
    page.get_by_role("button", name="写下一章", exact=True).click()
    expect(page.get_by_text("已完成 2 章", exact=False)).to_be_visible()
    endpoint = "http://127.0.0.1:7466/api/v1/projects/" + page.url.split("/")[-1]
    project = page.request.get(endpoint).json()["data"]
    for job in [j for j in project["jobs"] if j["kind"] in ["OPENING", "CHAPTER"]]:
        items = job["input"]["knowledge"]["items"]
        style = next(i["payload"] for i in items if i["kind"] == "STYLE")
        template = next(i["payload"] for i in items if i["kind"] == "TEMPLATE")
        assert style["pov"] == "FIRST" and style["dialogueRatio"] == [0.1, 0.5]
        assert style["instructions"] == ["用动作表现不安。", "少用旁白解释。"]
        assert template["defaults"]["summary"] == "每章推进一条线索。"
        assert template["guidance"] == ["让行动产生后果。", "结尾留下自然的疑问。"]
    with page.expect_download() as download:
        page.get_by_role("link", name="导出", exact=True).click()
    assert download.value.suggested_filename.endswith(".md")
    assert not errors, errors
    browser.close()
    print("PASS: style and template forms -> publish -> new novel with template -> bind style -> two chapters -> export")
