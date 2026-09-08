import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
test('风格与章节模板表单 → 用于新小说 → 两章写作与导出', async () => {
  test.setTimeout(120000);
  const { stdout } = await promisify(execFile)('python', ['tests/e2e/writing_knowledge_flow.py'], {
    timeout: 110000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  expect(stdout).toContain('PASS:');
});
