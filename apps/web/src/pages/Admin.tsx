import { useState } from 'react';
import { api } from '../api';
import { Shell, ErrorBox } from '../components/ui';
export function Admin() {
  const [logged, setLogged] = useState(false),
    [token, setToken] = useState(''),
    [error, setError] = useState<unknown>(),
    [kind, setKind] = useState('policy'),
    [value, setValue] = useState(''),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState('');
  async function load(k: string) {
    try {
      const c = await api<{ payload: unknown; revision: number }>(`/admin/${k}`);
      setRevision(c.revision);
      setValue(JSON.stringify(c.payload, null, 2));
      setKind(k);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Shell>
      <main className="settings-page">
        <div className="eyebrow">本机独立后台</div>
        <h1>能力配置</h1>
        <ErrorBox error={error} />
        {!logged ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/admin/session', 'POST', { token });
                setToken('');
                setLogged(true);
                setError(null);
                await load(kind);
              } catch (e) {
                setError(e);
              }
            }}
          >
            <label>
              管理员口令
              <input
                type="password"
                value={token}
                autoComplete="current-password"
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button className="primary">进入配置</button>
          </form>
        ) : (
          <>
            <p>配置产生不可变新版本，仅影响之后启动的任务。核心审核不可关闭。</p>
            <div className="tabs">
              <button onClick={() => void load('policy')}>审核策略</button>
              <button onClick={() => void load('skills')}>Skill 配置</button>
            </div>
            <textarea
              className="json-editor"
              rows={22}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="actions">
              <button
                onClick={async () => {
                  await api('/admin/session', 'DELETE');
                  setLogged(false);
                }}
              >
                退出
              </button>
              <button
                onClick={async () => {
                  try {
                    const versions = await api<{ payload: unknown }[]>(`/admin/${kind}/versions`);
                    if (versions[1]) setValue(JSON.stringify(versions[1].payload, null, 2));
                    else setMessage('暂无上一个版本。');
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                载入上一版本
              </button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await api(`/admin/${kind}/versions`, 'POST', {
                      payload: JSON.parse(value),
                      expectedRevision: revision,
                    });
                    await load(kind);
                    setMessage('新版本已保存。');
                    setError(null);
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                保存新版本
              </button>
            </div>
            <p role="status">{message}</p>
          </>
        )}
      </main>
    </Shell>
  );
}
