import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Project } from '../api';
import { Modal, ErrorBox } from '../components/ui';

type Payload = {
  id: string;
  level: string;
  parentVersionId: string | null;
  chapterRange: [number, number];
  title: string;
  summary: string;
  knowledgeVersionIds: string[];
  [key: string]: unknown;
};
type Version = {
  id: string;
  level: string;
  status: string;
  payload: Payload;
  supersedesVersionId: string | null;
};
const levels = { BOOK: '全书', VOLUME: '卷', ARC: '剧情单元', CHAPTER: '章' };
const statuses: Record<string, string> = {
  ACTIVE: '已启用',
  CANDIDATE: '待确认',
  STALE: '需重新规划',
  NEEDS_REVIEW: '需复核',
  SUPERSEDED: '历史版本',
};
export function PlanManager({
  project: p,
  busy,
  onAction,
  onClose,
}: {
  project: Project;
  busy: boolean;
  onAction: (f: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['plans', p.id],
    queryFn: () =>
      api<{ versions: Version[]; expectedRevision: number }>(`/projects/${p.id}/plans`),
    refetchInterval: 2000,
  });
  const [editing, setEditing] = useState<{
    value: string;
    revision: number;
    siblings: boolean;
  } | null>(null);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<unknown>();
  const edit = (payload: Payload | Payload[], siblings = false) =>
    setEditing({ value: JSON.stringify(payload, null, 2), revision: p.revision, siblings });
  const perform = (f: () => Promise<unknown>) =>
    onAction(async () => {
      setError(undefined);
      try {
        await f();
        await q.refetch();
      } catch (e) {
        setError(e);
        throw e;
      }
    });
  const addChild = (parent: Version) => {
    const level =
      parent.level === 'BOOK' ? 'VOLUME' : parent.level === 'VOLUME' ? 'ARC' : 'CHAPTER';
    const start = Math.max(p.headChapter + 1, parent.payload.chapterRange[0]);
    const end = Math.min(
      parent.payload.chapterRange[1],
      start + (level === 'VOLUME' ? 29 : level === 'ARC' ? 9 : 0),
    );
    edit({
      id: crypto.randomUUID(),
      level,
      parentVersionId: parent.id,
      chapterRange: [start, end],
      title: '新计划',
      summary: '',
      basedOnSnapshotId: p.headSnapshotId,
      knowledgeVersionIds: parent.payload.knowledgeVersionIds,
      constraints: [],
      goals: [],
      assumptions: [],
      ...(level === 'VOLUME'
        ? {
            entrySituation: '',
            exitGoal: '',
            arcDirections: Array.from({ length: Math.ceil((end - start + 1) / 10) }, (_, i) => ({
              order: i + 1,
              chapterRange: [start + i * 10, Math.min(end, start + i * 10 + 9)],
              goal: '',
            })),
          }
        : level === 'ARC'
          ? { trigger: '', opposition: '', turn: '', resolutionTarget: '' }
          : {
              castIds: [],
              locationIds: [],
              beats: [{ order: 1, function: '推进', description: '', goalIds: [] }],
              expectedEvents: [''],
              hook: { required: false, kind: null, question: null },
              promiseActions: [],
              targetLength: p.targetLength,
              allowedQuotes: [],
            }),
    });
  };
  return (
    <Modal title="计划管理" onClose={onClose}>
      <p className="hint">
        计划描述未来剧情。保存产生候选；启用会调用模型校验，并让依赖旧版本的后续计划重新规划。已提交的章节保留原计划。
      </p>
      <ErrorBox error={error || q.error} />
      {editing ? (
        <>
          <h3>{editing.siblings ? '调整同层完整范围' : '编辑计划候选'}</h3>
          <textarea
            aria-label="计划内容"
            className="json-editor"
            rows={18}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          />
          <div className="actions">
            <button onClick={() => setEditing(null)}>返回计划列表</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api(
                    `/projects/${p.id}/${editing.siblings ? 'plan-siblings' : 'plan-versions'}`,
                    editing.siblings ? 'PUT' : 'POST',
                    {
                      expectedRevision: editing.revision,
                      ...(editing.siblings
                        ? { payloads: JSON.parse(editing.value) }
                        : { payload: JSON.parse(editing.value) }),
                    },
                  );
                  setEditing(null);
                })
              }
            >
              保存计划候选
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            显示历史版本
          </label>
          {Object.entries(levels).map(([level, label]) => (
            <section key={level}>
              <h3>{label}</h3>
              {q.data?.versions
                .filter((v) => v.level === level && (history || v.status !== 'SUPERSEDED'))
                .map((v) => (
                  <div className="direction" key={v.id}>
                    <div>
                      <strong>{v.payload.title}</strong>
                      <p>
                        {v.payload.chapterRange.join(' — ')} 章 · {statuses[v.status] || v.status}
                      </p>
                      <p>{v.payload.summary}</p>
                      <small className="hint">
                        版本 {v.id.slice(0, 8)}
                        {v.supersedesVersionId
                          ? ` · 来源 ${v.supersedesVersionId.slice(0, 8)}`
                          : ''}
                      </small>
                      <div className="actions wrap">
                        <button
                          disabled={busy || v.payload.chapterRange[1] <= p.headChapter}
                          onClick={() => edit(v.payload)}
                        >
                          编辑为新版本
                        </button>
                        {v.status === 'CANDIDATE' && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              void perform(() =>
                                api(
                                  `/projects/${p.id}/plans/${v.id}/activate`,
                                  'POST',
                                  { expectedRevision: p.revision },
                                  true,
                                ),
                              )
                            }
                          >
                            {level === 'BOOK' ? '确认全书更改并校验' : '校验并启用'}
                          </button>
                        )}
                        {v.status === 'ACTIVE' &&
                          level !== 'CHAPTER' &&
                          v.payload.chapterRange[1] > p.headChapter && (
                            <button disabled={busy} onClick={() => addChild(v)}>
                              新增下级计划
                            </button>
                          )}
                        {v.status === 'ACTIVE' && v.payload.parentVersionId && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              edit(
                                q
                                  .data!.versions.filter(
                                    (s) =>
                                      s.status === 'ACTIVE' &&
                                      s.level === v.level &&
                                      s.payload.parentVersionId === v.payload.parentVersionId,
                                  )
                                  .sort(
                                    (a, b) => a.payload.chapterRange[0] - b.payload.chapterRange[0],
                                  )
                                  .map((s) => s.payload),
                                true,
                              )
                            }
                          >
                            调整同层范围
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </section>
          ))}
          {!q.data?.versions.length && <p>确认开书方案后建立全书计划，其余层级随创作逐步展开。</p>}
        </>
      )}
    </Modal>
  );
}
