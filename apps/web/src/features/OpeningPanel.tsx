import { useEffect, useState } from 'react';
import { PenLine, Check } from 'lucide-react';
import { openingSchema, type Opening } from '@one2novel/contracts';
import { api, type Project } from '../api';
import { Modal } from '../components/ui';
import { OpeningForm } from './OpeningForm';
export function OpeningPanel({
  project: p,
  busy,
  onAction,
}: {
  project: Project;
  busy: boolean;
  onAction: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const pending = p.artifacts.find(
      (a) =>
        a.kind === 'OPENING' &&
        a.baseSnapshotId === p.headSnapshotId &&
        (a.payload as Opening).book.basedOnSnapshotId === null,
    ),
    a =
      p.headChapter === 0 && pending
        ? pending
        : (p.artifacts.find((a) => a.id === p.openingId) ??
          p.artifacts.find((a) => a.kind === 'OPENING')),
    sourceOpening = a?.payload as Opening | undefined,
    opening =
      sourceOpening && !pending && p.activeBook
        ? { ...sourceOpening, book: p.activeBook }
        : sourceOpening;
  const [editing, setEditing] = useState(false),
    [editingRevision, setEditingRevision] = useState(p.revision),
    [value, setValue] = useState(''),
    [formOpening, setFormOpening] = useState<Opening>(),
    [advancedInvalid, setAdvancedInvalid] = useState(false),
    [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => setWarnings([]), [a?.id]);
  let valid = false;
  try {
    valid = openingSchema.safeParse(JSON.parse(value)).success;
  } catch {
    /* Advanced edits may be incomplete. */
  }
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
          {p.headSnapshotId && pending && p.headChapter === 0 && (
            <p className="hint">
              当前展示待确认的新方案。确认后才会替换初始设定，旧版本与草稿会保留。
            </p>
          )}
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
          {p.headChapter === 0 && (
            <div className="actions wrap">
              <button
                disabled={busy}
                onClick={() => {
                  setValue(JSON.stringify(opening, null, 2));
                  setFormOpening(opening);
                  setAdvancedInvalid(false);
                  setEditingRevision(p.revision);
                  setEditing(true);
                }}
              >
                {p.headSnapshotId ? '修改初始设定' : '编辑方案'}
              </button>
              {!p.headSnapshotId && (
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
              )}
              {(!p.headSnapshotId || pending) && (
                <button
                  className="primary"
                  disabled={busy || !opening.warnings.every((w) => warnings.includes(w))}
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
                  {p.headSnapshotId ? '确认新设定，重建开篇' : '确认设定，准备开篇'}
                </button>
              )}
            </div>
          )}
          {p.headChapter > 0 && (
            <p className="hint">修改初始设定须先从第一章重写。请在章节中预览并确认重写范围。</p>
          )}
        </>
      )}
      {editing && (
        <Modal title="编辑开书方案" onClose={() => setEditing(false)}>
          <p className="hint">修改故事方向和开篇介绍，保存后还需确认才生效。</p>
          {formOpening && (
            <OpeningForm
              value={formOpening}
              disabled={busy || advancedInvalid}
              onChange={(next) => {
                setFormOpening(next);
                setValue(JSON.stringify(next, null, 2));
              }}
            />
          )}
          {!valid && <p role="alert">请补全故事名称、角色名称，或检查高级设定后再保存。</p>}
          <details>
            <summary>高级：完整设定与身份引用</summary>
            <p className="hint">包含人物关系、认知和其他完整设定。请保留身份引用。</p>
            <textarea
              className="json-editor"
              aria-label="完整开书设定"
              disabled={busy}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                try {
                  setFormOpening(openingSchema.parse(JSON.parse(e.target.value)));
                  setAdvancedInvalid(false);
                } catch {
                  setAdvancedInvalid(true);
                }
              }}
              rows={18}
            />
          </details>
          <div className="actions">
            <button onClick={() => setEditing(false)}>取消</button>
            <button
              className="primary"
              disabled={busy || !valid}
              onClick={() =>
                void onAction(async () => {
                  await api(`/projects/${p.id}/opening-candidates`, 'POST', {
                    expectedRevision: editingRevision,
                    payload: JSON.parse(value),
                  });
                  setEditing(false);
                  setWarnings([]);
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
