import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';

test('已确认开篇 → 编辑候选 → 刷新确认重建 → 保留草稿并提交首章', async () => {
  const { stdout } = await promisify(execFile)('python', ['tests/e2e/opening_rebuild_flow.py'], {
    timeout: 50000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  expect(stdout).toContain('PASS:');
});
test('计划候选 → 全书确认启用 → 新计划生产 → 刷新版本列表', async () => {
  const { stdout } = await promisify(execFile)('python', ['tests/e2e/plans_flow.py'], {
    timeout: 50000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  expect(stdout).toContain('PASS:');
});
