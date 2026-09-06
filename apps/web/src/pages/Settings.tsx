import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import type { Settings } from '@one2novel/contracts';
import { api } from '../api';
import { Shell, ErrorBox, Loading } from '../components/ui';
export function SettingsPage() {
  const q = useQuery({
    queryKey: ['models'],
    queryFn: () =>
      api<{ payload: Settings; revision: number; credentialConfigured: boolean }>(
        '/settings/models',
      ),
  });
  const [value, setValue] = useState<Settings | null>(null),
    [error, setError] = useState<unknown>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data && !value) setValue(q.data.payload);
  }, [q.data]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await q.refetch();
      setMessage(message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const profile = value?.profiles[0];
  return (
    <Shell>
      <main className="settings-page">
        <Link to="/" className="text-link">
          <ArrowLeft size={16} />
          返回书架
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">创作工具</div>
            <h1>模型设置</h1>
            <p>所有写作与审核请求统一通过 ChatAnyWhere。</p>
          </div>
        </div>
        <ErrorBox error={error || q.error} />
        {!value ? (
          <Loading />
        ) : (
          <>
            <div className="settings-notice">
              <span className={`dot ${q.data?.credentialConfigured ? '' : 'gray'}`} />
              {q.data?.credentialConfigured ? '服务端密钥已配置' : '尚未配置服务端密钥'}
              <p>在项目根目录 .env 填写 CHATANYWHERE_API_KEY 后重启服务。页面不读取或保存密钥。</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  () =>
                    api('/settings/models', 'PUT', {
                      payload: value,
                      expectedRevision: q.data!.revision,
                    }),
                  '设置已保存；仅影响新任务。',
                );
              }}
            >
              <label>
                服务地址
                <select
                  value={value.baseUrl}
                  onChange={(e) =>
                    setValue({ ...value, baseUrl: e.target.value as Settings['baseUrl'] })
                  }
                >
                  <option>https://api.chatanywhere.tech/v1</option>
                  <option>https://api.chatanywhere.org/v1</option>
                </select>
              </label>
              {!profile ? (
                <button
                  type="button"
                  onClick={() =>
                    setValue({
                      ...value,
                      profiles: [
                        {
                          id: 'default',
                          name: '主模型',
                          model: '',
                          contextWindow: 32768,
                          maxOutput: 8192,
                          outputTokenParam: 'max_tokens',
                          supportsTemperature: false,
                          structuredMode: 'TEXT_JSON',
                          streaming: true,
                        },
                      ],
                      roleMappings: {
                        planner: 'default',
                        writer: 'default',
                        reviewer: 'default',
                        extractor: 'default',
                        repairer: 'default',
                      },
                    })
                  }
                >
                  添加模型配置
                </button>
              ) : (
                <>
                  <label>
                    模型名称
                    <input
                      value={profile.model}
                      required
                      placeholder="填写 ChatAnyWhere 实际提供的模型 ID"
                      onChange={(e) =>
                        setValue({
                          ...value,
                          profiles: [
                            { ...profile, model: e.target.value },
                            ...value.profiles.slice(1),
                          ],
                        })
                      }
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      上下文容量
                      <input
                        type="number"
                        min={8192}
                        required
                        value={profile.contextWindow}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            profiles: [
                              { ...profile, contextWindow: Number(e.target.value) },
                              ...value.profiles.slice(1),
                            ],
                          })
                        }
                      />
                    </label>
                    <label>
                      最大输出
                      <input
                        type="number"
                        min={1024}
                        required
                        value={profile.maxOutput}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            profiles: [
                              { ...profile, maxOutput: Number(e.target.value) },
                              ...value.profiles.slice(1),
                            ],
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      输出长度参数
                      <select
                        value={profile.outputTokenParam}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            profiles: [
                              {
                                ...profile,
                                outputTokenParam: e.target.value as typeof profile.outputTokenParam,
                              },
                              ...value.profiles.slice(1),
                            ],
                          })
                        }
                      >
                        <option>max_tokens</option>
                        <option>max_completion_tokens</option>
                      </select>
                    </label>
                    <label>
                      结构化输出
                      <select
                        value={profile.structuredMode}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            profiles: [
                              {
                                ...profile,
                                structuredMode: e.target.value as typeof profile.structuredMode,
                              },
                              ...value.profiles.slice(1),
                            ],
                          })
                        }
                      >
                        <option>TEXT_JSON</option>
                        <option>JSON_OBJECT</option>
                        <option>JSON_SCHEMA</option>
                      </select>
                    </label>
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={profile.streaming}
                      onChange={(e) =>
                        setValue({
                          ...value,
                          profiles: [
                            { ...profile, streaming: e.target.checked },
                            ...value.profiles.slice(1),
                          ],
                        })
                      }
                    />
                    流式生成正文
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={profile.supportsTemperature}
                      onChange={(e) =>
                        setValue({
                          ...value,
                          profiles: [
                            { ...profile, supportsTemperature: e.target.checked },
                            ...value.profiles.slice(1),
                          ],
                        })
                      }
                    />
                    模型支持 temperature 参数
                  </label>
                  <details>
                    <summary>多模型与角色映射</summary>
                    <p className="hint">
                      可以配置不同的规划、写作、审核、抽取及修复模型。此处修改完整配置。
                    </p>
                    <textarea
                      className="json-editor"
                      key={JSON.stringify(value.roleMappings)}
                      defaultValue={JSON.stringify(value, null, 2)}
                      rows={12}
                      onBlur={(e) => {
                        try {
                          setValue(JSON.parse(e.target.value));
                          setError(null);
                        } catch {
                          setError(new Error('配置不是有效JSON'));
                        }
                      }}
                    />
                  </details>
                </>
              )}
              <p className="hint">能力数值请按实际模型填写。保存配置不会自动发送模型请求。</p>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy || !q.data?.credentialConfigured}
                  onClick={() =>
                    void action(() => api('/settings/models/test', 'POST', {}), '连通测试成功。')
                  }
                >
                  测试已保存配置（会调用模型）
                </button>
                <button className="primary" disabled={busy || !profile}>
                  保存设置
                </button>
              </div>
              {message && (
                <p className="success" role="status">
                  <Check size={15} />
                  {message}
                </p>
              )}
            </form>
          </>
        )}
      </main>
    </Shell>
  );
}
