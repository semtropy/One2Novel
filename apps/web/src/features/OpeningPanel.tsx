import { useState } from 'react';
import { PenLine, Check } from 'lucide-react';
import type { Opening } from '@one2novel/contracts';
import { api, type Project } from '../api';
import { Modal } from '../components/ui';
export function OpeningPanel({
  project: p,
  busy,
  onAction,
}: {
  project: Project;
  busy: boolean;
  onAction: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const a = p.artifacts.find((a) => a.kind === 'OPENING'),
    opening = a?.payload as Opening | undefined;
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]);
  return (
    <div className="opening">
      <div className="eyebrow">在第一章之前</div>
      <h2>{p.headSnapshotId ? '全书与初始设定' : '先给故事一个方向'}</h2>
      <p className="lead">{p.idea}</p>
      {!opening ? (
        <div className="opening-empty">
          <p>根据你的灵感生成全书方向与初始事实。你确认后，才会开始正文。</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void onAction(() =>
                api(
                  `/projects/${p.id}/opening-plans`,
                  'POST',
                  { expectedRevision: p.revision },
                  true,
                ),
              )
            }
          >
            <PenLine size={16} />
            {busy ? '正在构思…' : '生成开书方案'}
          </button>
          <p className="hint">需要在模型设置中完成配置。</p>
        </div>
      ) : (
        <>
          <h3>{opening.book.title}</h3>
          <p>{opening.book.summary}</p>
          <div className="opening-grid">
            <div>
              <h4>核心问题</h4>
              <p>{opening.book.centralQuestion}</p>
            </div>
            <div>
              <h4>结局方向</h4>
              <p>{opening.book.endingDirection}</p>
            </div>
          </div>
          <h4>分卷方向</h4>
          {opening.book.volumeDirections.map((v) => (
            <div className="direction" key={v.order}>
              <span>{v.chapterRange.join(' — ')} 章</span>
              <p>{v.goal}</p>
            </div>
          ))}
          <h4>开篇前已成立的事实</h4>
          <div className="entity-list">
            {Object.values(opening.state.entities).map((e) => (
              <div key={e.id}>
                <strong>{e.name}</strong>
                <p>{e.description}</p>
              </div>
            ))}
          </div>
          <p className="hint">确认这些设定在故事开篇前已经成立，未来剧情不应写入这里。</p>
          {opening.warnings.map((w) => (
            <label className="check-label" key={w}>
              <input
                type="checkbox"
                checked={warnings.includes(w)}
                onChange={(e) =>
                  setWarnings(e.target.checked ? [...warnings, w] : warnings.filter((x) => x !== w))
                }
              />
              {w}
            </label>
          ))}
          {!p.headSnapshotId && (
            <div className="actions wrap">
              <button
                disabled={busy}
                onClick={() => {
                  setValue(JSON.stringify(opening, null, 2));
                  setEditing(true);
                }}
              >
                编辑方案
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void onAction(() =>
                    api(
                      `/projects/${p.id}/opening-plans`,
                      'POST',
                      { expectedRevision: p.revision },
                      true,
                    ),
                  )
                }
              >
                重新构思
              </button>
              <button
                className="primary"
                disabled={busy || warnings.length < opening.warnings.length}
                onClick={() =>
                  void onAction(() =>
                    api(`/projects/${p.id}/opening-confirmations`, 'POST', {
                      openingId: a!.id,
                      expectedRevision: p.revision,
                      acknowledgedWarnings: warnings,
                    }),
                  )
                }
              >
                <Check size={16} />
                确认设定，准备开篇
              </button>
            </div>
          )}
        </>
      )}
      {editing && (
        <Modal title="编辑开书方案" onClose={() => setEditing(false)}>
          <p className="hint">保留字段与身份引用；修改后会进行结构与事实校验。</p>
          <textarea
            className="json-editor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={18}
          />
          <div className="actions">
            <button onClick={() => setEditing(false)}>取消</button>
            <button
              className="primary"
              onClick={() =>
                void onAction(async () => {
                  await api(`/projects/${p.id}/opening-candidates`, 'POST', {
                    expectedRevision: p.revision,
                    payload: JSON.parse(value),
                  });
                  setEditing(false);
                })
              }
            >
              保存新方案
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
