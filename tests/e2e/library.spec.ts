import { test, expect } from '@playwright/test';

test('参考导入 → 分析发布 → 框架与素材改编 → 绑定小说 → 两章与导出', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/library');
  await page.getByRole('button', { name: '导入作品', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: '钟楼来信.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '第一章 旧地图\n陆砚来到钟楼，打开旧地图。\n\n第二章 来信\n陆砚读到来信，决定寻找摆渡人。',
    ),
  });
  await page.getByLabel('作品名称').fill('钟楼参考验收');
  await page.getByRole('button', { name: '导入并预览' }).click();
  await expect(page.getByRole('heading', { name: '钟楼参考验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认并发布切分' }).click();
  await page.getByRole('button', { name: '开始完整分析' }).click();
  await expect(page.locator('.coverage')).toContainText('分析完整');
  await page.getByRole('button', { name: '发布分析版本' }).click();
  await page.getByRole('button', { name: '提取叙事框架' }).click();
  await page.getByRole('button', { name: '发布知识版本' }).click();
  await expect(page.getByRole('button', { name: '发布知识版本' })).toBeDisabled();
  await page
    .locator('.library-list')
    .getByRole('button', { name: /钟楼参考验收 TXT/ })
    .click();
  await page.getByRole('button', { name: '提取原始素材' }).click();
  await page.getByRole('button', { name: '发布知识版本' }).click();
  await page.getByRole('button', { name: '清洗素材', exact: true }).click();
  await expect(page.getByLabel('知识内容')).toHaveValue(/"stage": "CLEAN"/);
  await page.getByRole('button', { name: '发布知识版本' }).click();
  await page.getByLabel('改编要求').fill('改为星港背景，重新设计所有人物身份和目标。');
  await page.getByRole('button', { name: '生成改编素材' }).click();
  await expect(page.getByLabel('知识内容')).toHaveValue(/"stage": "ADAPTED"/);
  await page.getByRole('button', { name: '发布知识版本' }).click();
  await expect(page.getByRole('button', { name: '发布知识版本' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/library-adapted.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: '新建小说', exact: true }).click();
  await page.getByLabel('小说名称').fill('知识闭环验收');
  await page.getByLabel('一句灵感').fill('星港来信引出失踪的信使');
  await page.getByLabel('目标章数').fill('2');
  await page.getByLabel('每章字数').fill('500');
  await page.getByRole('button', { name: '创建小说', exact: true }).click();
  await page.getByRole('button', { name: '创作知识', exact: true }).click();
  await page.getByRole('checkbox', { name: /钟楼参考验收 · 叙事框架/ }).check();
  await page.getByRole('checkbox', { name: /钟楼参考验收 · 素材包/ }).check();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('button', { name: '保存知识绑定' }).click();
  await page.getByRole('button', { name: '生成开书方案', exact: true }).click();
  await page.getByRole('button', { name: '确认设定，准备开篇' }).click();
  await page.getByRole('button', { name: '生成本章', exact: true }).click();
  await expect(page.getByText('已完成 1 章', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '写下一章' }).click();
  await expect(page.getByText('已完成 2 章', { exact: false })).toBeVisible();
  const projectId = page.url().split('/').at(-1);
  const { data: bindings } = await (
    await page.request.get(`/api/v1/projects/${projectId}/knowledge-bindings`)
  ).json();
  const { data: project } = await (await page.request.get(`/api/v1/projects/${projectId}`)).json();
  expect(bindings.items).toHaveLength(2);
  for (const j of project.jobs.filter((j: any) => ['OPENING', 'CHAPTER'].includes(j.kind)))
    expect(j.input.knowledge.hash).toBe(bindings.hash);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toContain('.md');
  await page.reload();
  await expect(page.getByText('已完成 2 章', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
