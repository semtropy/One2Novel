import { afterEach, describe, expect, it, vi } from 'vitest';
import { planningValidationSchema } from '@one2novel/contracts';
import { ChatAnywhere } from '../../apps/server/src/platform/llm.js';
import type { Settings } from '@one2novel/contracts';
import { testSettings } from '../fixtures/fake-model.js';
afterEach(() => vi.unstubAllGlobals());
const request = () => ({
  prompt: 'connection.test' as const,
  input: { message: 'test' },
  settings: testSettings as Settings,
  signal: new AbortController().signal,
  reserve: vi.fn(async () => {}),
});
const completion = (text: string, finish = 'stop') =>
  new Response(
    JSON.stringify({
      id: 'test',
      object: 'chat.completion',
      created: 0,
      model: 'fixture-only',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finish }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
describe('ChatAnyWhere协议边界（拦截HTTP，无真实费用）', () => {
  it('只发ChatAnyWhere且不发送未支持temperature', async () => {
    const fetcher = vi.fn(async () => completion('OK'));
    vi.stubGlobal('fetch', fetcher);
    const r = request();
    const answer = await new ChatAnywhere('test-not-a-real-key').call<string>(r);
    expect(answer).toBe('OK');
    expect(r.reserve).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.chatanywhere.tech/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });
  it('401不重试，不泄露服务响应和密钥', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'test-not-a-real-key', type: 'invalid_request_error' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(new ChatAnywhere('test-not-a-real-key').call(request())).rejects.toMatchObject({
      code: 'MODEL_AUTH_ERROR',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('截断结果不能成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => completion('half text', 'length')),
    );
    await expect(new ChatAnywhere('test-not-a-real-key').call(request())).rejects.toMatchObject({
      code: 'MODEL_INCOMPLETE',
    });
  });
  it('结构错误只进行一次格式修复', async () => {
    const fetcher = vi.fn(async () => completion('{"wrong":true}'));
    vi.stubGlobal('fetch', fetcher);
    const r = request();
    await expect(
      new ChatAnywhere('test-not-a-real-key').call({ ...r, schema: planningValidationSchema }),
    ).rejects.toMatchObject({ code: 'MODEL_SCHEMA_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.reserve).toHaveBeenCalledTimes(2);
  });
  it('单Gateway全局请求串行，包含独立连通测试', async () => {
    let current = 0,
      peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        current++;
        peak = Math.max(peak, current);
        await new Promise((resolve) => setTimeout(resolve, 15));
        current--;
        return completion('OK');
      }),
    );
    const gateway = new ChatAnywhere('test-not-a-real-key');
    await Promise.all([gateway.call(request()), gateway.call(request())]);
    expect(peak).toBe(1);
  });
});
