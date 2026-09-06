"""Read-only browser smoke check of a running production build."""
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:7456")
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="小说书架").is_visible()
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/production-shelf.png", full_page=True)
    page.get_by_role("link", name="参考与知识", exact=True).click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="参考与知识", exact=True).is_visible()
    assert page.get_by_role("button", name="导入作品", exact=True).is_enabled()
    assert page.request.get("http://127.0.0.1:7456/api/v1/references").ok
    assert page.request.get("http://127.0.0.1:7456/api/v1/knowledge").ok
    page.get_by_role("link", name="模型设置").click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="模型设置").is_visible()
    assert page.locator("input[type=password]").count() == 0
    assert errors == [], errors
    print("Production build: shelf, reference/knowledge library, model settings, no browser errors.")
    browser.close()
