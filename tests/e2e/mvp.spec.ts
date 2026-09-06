import { test, expect } from '@playwright/test';
test('书架 → 开书确认 → 两章生产 → 事实 → 导出与刷新', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '小说书架' })).toBeVisible();
  await page.getByRole('button', { name: '新建小说', exact: true }).click();
  await page.getByLabel('小说名称').fill('渡口的第十三封信');
  await page.getByLabel('一句灵感').fill('修钟人在渡口收到一封来自过去的信。');
  await page.getByLabel('目标章数').fill('3');
  await page.getByLabel('每章字数').fill('500');
  await page.getByRole('button', { name: '创建小说', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先给故事一个方向' })).toBeVisible();
  await page.getByRole('button', { name: '生成开书方案', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认设定，准备开篇' })).toBeEnabled();
  await page.getByRole('button', { name: '确认设定，准备开篇' }).click();
  await page.getByRole('button', { name: '生成本章', exact: true }).click();
  await expect(page.getByText('已完成 1 章', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '写下一章' }).click();
  await expect(page.getByText('已完成 2 章', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '事实', exact: true }).click();
  await expect(page.getByText('截至第 2 章的已提交事实')).toBeVisible();
  await page.screenshot({ path: 'test-results/mvp-workspace.png', fullPage: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain('.md');
  await page.reload();
  await expect(page.getByText('已完成 2 章', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mvp-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '01 第1章 渡口来信' }).click();
  await page.getByRole('button', { name: '重写', exact: true }).click();
  await page.getByRole('button', { name: '确认回退并重写' }).click();
  await expect(page.getByText('已完成 0 章', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '版本', exact: true }).click();
  await expect(page.getByRole('button', { name: /GENERATED/ })).toBeVisible();
  const editor = page.getByRole('textbox', { name: '章节正文' });
  await editor.fill('这是重写后的本地工作草稿。');
  await expect(page.locator('.editor-footer')).toContainText('已保存');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '章节正文' })).toContainText(
    '这是重写后的本地工作草稿。',
  );
  const secondTab = await page.context().newPage();
  await secondTab.goto(page.url());
  await secondTab.getByRole('textbox', { name: '章节正文' }).fill('另一个标签页保存的新版本。');
  await expect(secondTab.locator('.editor-footer')).toContainText('已保存');
  await page.getByRole('textbox', { name: '章节正文' }).fill('保留本地输入，不能覆盖别的页面。');
  await expect(page.getByRole('alert')).toContainText('草稿已被其他页面修改');
  await expect(page.getByRole('textbox', { name: '章节正文' })).toContainText('保留本地输入');
  await secondTab.close();
});
test('未登录不能访问独立后台配置；模型页不出现密钥输入', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '模型设置' })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByLabel('管理员口令')).toBeVisible();
  const response = await page.request.get('/api/v1/admin/policy');
  expect(response.status()).toBe(401);
});
