import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Job } from '../api';
import { Shell, Modal, ErrorBox } from '../components/ui';
import { JobPanel } from '../features/Inspector';
import { defaultStyle } from '@one2novel/contracts';

type Source = {
  id: string;
  title: string;
  format: string;
  revision: number;
  activeSplitId: string | null;
  activeModelId: string | null;
};
type Version = { id: string; number: number; payload: any; publishedAt: string | null };
type Item = {
  id: string;
  kind: string;
  title: string;
  revision: number;
  activeVersionId: string | null;
  versions: Version[];
  jobs?: Job[];
};
const names: Record<string, string> = {
  FRAMEWORK: '叙事框架',
  ASSET_PACK: '素材包',
  STYLE: '文字风格',
  TEMPLATE: '规划模板',
  RAW: '原始素材',
  CLEAN: '已清洗',
  ADAPTED: '已改编',
};
export function Library() {
  const [selection, setSelection] = useState<{
      kind: 'reference' | 'knowledge';
      id: string;
    } | null>(null),
    [importing, setImporting] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient(),
    refs = useQuery({ queryKey: ['references'], queryFn: () => api<Source[]>('/references') }),
    knowledge = useQuery({ queryKey: ['knowledge'], queryFn: () => api<Item[]>('/knowledge') });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['references'] });
      await qc.invalidateQueries({ queryKey: ['knowledge'] });
      await qc.invalidateQueries({ queryKey: ['library-detail'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <main className="library-page">
        <div className="library-heading">
          <div>
            <span className="eyebrow">创作资料</span>
            <h1>参考与知识</h1>
            <p className="muted">从作品中理解结构，把素材改编成自己的故事。</p>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                void run(async () => {
                  const v = await api<Item>('/knowledge', 'POST', {
                    kind: 'STYLE',
                    title: '我的文字风格',
                    payload: defaultStyle,
                  });
                  setSelection({ kind: 'knowledge', id: v.id });
                })
              }
            >
              新建风格
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  const v = await api<Item>('/knowledge', 'POST', {
                    kind: 'TEMPLATE',
                    title: '我的章节模板',
                    payload: { target: 'CHAPTER', schemaId: 'CHAPTER', defaults: {}, guidance: [] },
                  });
                  setSelection({ kind: 'knowledge', id: v.id });
                })
              }
            >
              新建模板
            </button>
            <button className="primary" onClick={() => setImporting(true)}>
              导入作品
            </button>
          </div>
        </div>
        <ErrorBox error={error || refs.error || knowledge.error} />
        <div className="library-layout">
          <aside className="library-list">
            <h3>参考作品</h3>
            {refs.data?.map((s) => (
              <button
                key={s.id}
                className={selection?.id === s.id ? 'selected' : ''}
                onClick={() => setSelection({ kind: 'reference', id: s.id })}
              >
                <strong>{s.title}</strong>
                <small>
                  {s.format} · {s.activeModelId ? '已发布分析' : '待整理'}
                </small>
              </button>
            ))}
            {!refs.data?.length && <p className="muted">导入TXT或EPUB，先预览切分。</p>}
            <h3>知识版本</h3>
            {knowledge.data?.map((i) => (
              <button
                key={i.id}
                className={selection?.id === i.id ? 'selected' : ''}
                onClick={() => setSelection({ kind: 'knowledge', id: i.id })}
              >
                <strong>{i.title}</strong>
                <small>
                  {names[i.kind]} · {i.activeVersionId ? '已发布' : '未发布'}
                </small>
              </button>
            ))}
          </aside>
          <section className="library-detail">
            <ErrorBox error={error} />
            {selection ? (
              selection.kind === 'reference' ? (
                <ReferenceDetail
                  key={selection.id}
                  id={selection.id}
                  run={run}
                  busy={busy}
                  onKnowledge={(id) => setSelection({ kind: 'knowledge', id })}
                />
              ) : (
                <KnowledgeDetail key={selection.id} id={selection.id} run={run} busy={busy} />
              )
            ) : (
              <div className="library-empty">
                <h2>让参考成为创作材料</h2>
                <p>导入并发布切分 → 完整分析 → 发布框架或素材 → 在小说中绑定。</p>
                <p className="muted">
                  参考作品的事件与人物始终独立保存。只有你确认的新小说设定，才会进入它的故事事实。
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
      {importing && (
        <ImportDialog
          busy={busy}
          error={error}
          onClose={() => setImporting(false)}
          onImport={(file, encoding, title) =>
            run(async () => {
              const form = new FormData();
              form.append('file', file);
              form.append('encoding', encoding);
              if (title) form.append('title', title);
              const response = await fetch('/api/v1/references', { method: 'POST', body: form }),
                result = await response.json();
              if (!response.ok) throw Error(result.error?.message || '导入失败');
              setSelection({ kind: 'reference', id: result.data.id });
              setImporting(false);
            })
          }
        />
      )}
    </Shell>
  );
}
function ImportDialog({
  busy,
  error,
  onClose,
  onImport,
}: {
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onImport: (file: File, encoding: string, title: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File>(),
    [encoding, setEncoding] = useState('UTF8'),
    [title, setTitle] = useState('');
  return (
    <Modal title="导入参考作品" onClose={onClose}>
      <label>
        作品文件
        <input
          aria-label="作品文件"
          type="file"
          accept=".txt,.epub"
          onChange={(e) => setFile(e.target.files?.[0])}
        />
      </label>
      <label>
        作品名称
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="默认使用文件名"
        />
      </label>
      <label>
        TXT编码
        <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
          <option value="UTF8">UTF-8</option>
          <option value="GB18030">GB18030</option>
        </select>
      </label>
      <p className="hint">最多20MiB。导入与预览不调用模型；确认切分后再开始分析。</p>
      <ErrorBox error={error} />
      <div className="actions">
        <button
          disabled={busy || !file}
          className="primary"
          onClick={() => file && void onImport(file, encoding, title)}
        >
          导入并预览
        </button>
      </div>
    </Modal>
  );
}
function ReferenceDetail({
  id,
  run,
  busy,
  onKnowledge,
}: {
  id: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onKnowledge: (id: string) => void;
}) {
  const q = useQuery({
    queryKey: ['library-detail', 'reference', id],
    queryFn: () =>
      api<
        Source & {
          splits: { id: string; payload: any[]; publishedAt: string | null }[];
          analyses: {
            id: string;
            status: string;
            completedChars: number;
            totalChars: number;
            summary: string | null;
            publishedAt: string | null;
            units: any[];
            jobId: string;
          }[];
          jobs: Job[];
        }
      >(`/references/${id}`),
    refetchInterval: 2000,
  });
  const preview = useQuery({
    queryKey: ['reference-text', id],
    queryFn: () => api<{ text: string; total: number }>(`/references/${id}/text`),
  });
  const [splitDraft, setSplitDraft] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const s = q.data;
  if (!s) return <ErrorBox error={q.error} />;
  const split = s.splits[0],
    a = s.analyses[0],
    job = s.jobs.find((j) => j.id === a?.jobId),
    running = s.jobs.some((j) => ['QUEUED', 'RUNNING'].includes(j.status));
  return (
    <>
      <h2>{s.title}</h2>
      <p className="hint">
        完整原文 {preview.data?.total.toLocaleString()} 字符 · {split?.payload.length} 个章节
      </p>
      <details>
        <summary>原文预览（前8000字符）</summary>
        <pre className="source-preview">{preview.data?.text}</pre>
      </details>
      <h3>章节切分</h3>
      <div className="source-chapters">
        {split?.payload.map((c) => (
          <div key={c.id}>
            <span>
              {c.order}. {c.title}
            </span>
            <small>{c.end - c.start} 字符</small>
          </div>
        ))}
      </div>
      <details>
        <summary>调整章节边界</summary>
        <p className="hint">start/end是完整原文的字符位置，章节必须连续且覆盖全文。</p>
        <textarea
          aria-label="章节切分"
          rows={8}
          value={
            splitDraft ??
            JSON.stringify(
              split.payload.map(({ title, start, end }: any) => ({ title, start, end })),
              null,
              2,
            )
          }
          onChange={(e) => setSplitDraft(e.target.value)}
        />
        <button
          disabled={busy || running || splitDraft === null}
          onClick={() =>
            void run(async () => {
              await api(`/references/${id}/split`, 'PUT', {
                expectedRevision: s.revision,
                chapters: JSON.parse(splitDraft!),
              });
              setSplitDraft(null);
            })
          }
        >
          保存切分候选
        </button>
      </details>
      <div className="actions wrap">
        <button
          disabled={busy || running || s.activeSplitId === split?.id}
          onClick={() =>
            void run(() =>
              api(`/references/${id}/split/${split.id}/publish`, 'POST', {
                expectedRevision: s.revision,
              }),
            )
          }
        >
          确认并发布切分
        </button>
        <button
          className="primary"
          disabled={busy || running || s.activeSplitId !== split?.id}
          onClick={() =>
            void run(() =>
              api(
                `/references/${id}/analyze`,
                'POST',
                { splitVersionId: split.id, expectedRevision: s.revision },
                true,
              ),
            )
          }
        >
          开始完整分析
        </button>
      </div>
      {a && (
        <>
          <h3>分析覆盖</h3>
          <p className="coverage">
            {a.completedChars.toLocaleString()} / {a.totalChars.toLocaleString()} 字符 ·{' '}
            {a.status === 'COMPLETE'
              ? '分析完整'
              : a.status === 'PARTIAL'
                ? '部分完成'
                : '等待分析'}
          </p>
          <progress value={a.completedChars} max={a.totalChars} />
          {a.units.some((u) => u.payload?.unresolvedIdentities.length > 0) && (
            <div className="identity-review">
              <h3>确认同名身份</h3>
              <p className="hint">
                选择同一实体或保留独立身份。确认会创建新的分析版本，并重映射后续引用；旧分析保留。
              </p>
              {[
                ...new Map<string, any>(
                  a.units.flatMap((u) =>
                    (u.payload?.unresolvedIdentities || []).map(
                      (x: any) => [x.candidateId, x] as [string, any],
                    ),
                  ),
                ).values(),
              ].map((conflict) => (
                <label key={conflict.candidateId}>
                  {conflict.reason}
                  <select
                    aria-label={`身份确认 ${conflict.candidateId}`}
                    value={decisions[conflict.candidateId] || ''}
                    onChange={(e) =>
                      setDecisions({ ...decisions, [conflict.candidateId]: e.target.value })
                    }
                  >
                    <option value="">请选择</option>
                    <option value="KEEP_SEPARATE">保留独立身份</option>
                    {conflict.possibleEntityIds.map((entityId: string) => (
                      <option key={entityId} value={entityId}>
                        合并至{' '}
                        {
                          a.units
                            .flatMap((u) => u.payload?.entities || [])
                            .find((e: any) => e.id === entityId)?.name
                        }
                        （{entityId.slice(0, 8)}）
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                disabled={busy || running}
                onClick={() =>
                  void run(async () => {
                    const ids = [
                      ...new Set<string>(
                        a.units.flatMap((u) =>
                          (u.payload?.unresolvedIdentities || []).map((x: any) => x.candidateId),
                        ),
                      ),
                    ];
                    if (ids.some((id) => !decisions[id])) throw Error('请确认所有待整理身份');
                    await api(`/references/${id}/entity-resolutions`, 'POST', {
                      analysisVersionId: a.id,
                      expectedRevision: s.revision,
                      decisions: ids.map((candidateId) => ({
                        candidateId,
                        action:
                          decisions[candidateId] === 'KEEP_SEPARATE' ? 'KEEP_SEPARATE' : 'MERGE',
                        targetEntityId:
                          decisions[candidateId] === 'KEEP_SEPARATE'
                            ? null
                            : decisions[candidateId],
                      })),
                    });
                    setDecisions({});
                  })
                }
              >
                确认身份并创建分析版本
              </button>
            </div>
          )}
          <p>{a.summary}</p>
          <details>
            <summary>逐章证据与实体</summary>
            {a.units.map((u) => (
              <details key={u.id}>
                <summary>
                  单元 {u.number} · 第 {u.chapterNo} 章 · {u.payload ? '已分析' : '待分析'}
                </summary>
                <p>{u.payload?.summary}</p>
                {u.payload?.entities.map((e: any) => (
                  <p key={e.id}>
                    <b>{e.name}</b>：{e.description}
                    <br />
                    {e.evidence.map((s: any) => `「${s.quote}」[${s.start}, ${s.end})`).join(' ')}
                  </p>
                ))}
                <pre>{u.payload && JSON.stringify(u.payload, null, 2)}</pre>
              </details>
            ))}
          </details>
          <div className="actions wrap">
            <button
              disabled={busy || running || a.status !== 'COMPLETE' || !!a.publishedAt}
              onClick={() =>
                void run(() =>
                  api(`/references/${id}/publish`, 'POST', {
                    analysisVersionId: a.id,
                    expectedRevision: s.revision,
                  }),
                )
              }
            >
              发布分析版本
            </button>
            {(['FRAMEWORK', 'ASSET_PACK'] as const).map((kind) => (
              <button
                key={kind}
                disabled={busy || !a.publishedAt}
                onClick={() =>
                  void run(async () => {
                    const job = await api<Job & { input: { itemId: string } }>(
                      '/knowledge',
                      'POST',
                      { kind, title: `${s.title} · ${names[kind]}`, sourceVersionId: a.id },
                      true,
                    );
                    onKnowledge(job.input.itemId);
                  })
                }
              >
                {kind === 'FRAMEWORK' ? '提取叙事框架' : '提取原始素材'}
              </button>
            ))}
          </div>
          <JobPanel job={job} onAction={run} />
        </>
      )}
    </>
  );
}
function KnowledgeDetail({
  id,
  run,
  busy,
}: {
  id: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const q = useQuery({
    queryKey: ['library-detail', 'knowledge', id],
    queryFn: () => api<Item>(`/knowledge/${id}`),
    refetchInterval: 2000,
  });
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<string | null>(null),
    [brief, setBrief] = useState('');
  const item = q.data;
  if (!item) return <ErrorBox error={q.error} />;
  const v = item.versions.find((v) => v.id === selected) || item.versions[0],
    job = item.jobs?.[0],
    running = item.jobs?.some((j) => ['QUEUED', 'RUNNING'].includes(j.status));
  return (
    <>
      <h2>{item.title}</h2>
      <p className="hint">{names[item.kind]} · 发布固定版本后，在小说工作区绑定</p>
      <JobPanel job={job} onAction={run} />
      {v && (
        <>
          <label>
            版本
            <select
              value={v.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setDraft(null);
              }}
            >
              {item.versions.map((v) => (
                <option value={v.id} key={v.id}>
                  第 {v.number} 版 · {v.publishedAt ? '已发布' : '候选'}{' '}
                  {names[v.payload.stage] || ''}
                </option>
              ))}
            </select>
          </label>
          {item.kind === 'ASSET_PACK' && (
            <p>
              {names[v.payload.stage]} · {v.payload.assets.length} 份素材
            </p>
          )}
          <textarea
            className="knowledge-editor"
            aria-label="知识内容"
            rows={18}
            value={draft ?? JSON.stringify(v.payload, null, 2)}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="hint">编辑保存为新候选版本；不会覆盖已经绑定到小说的版本。</p>
          <div className="actions wrap">
            <button
              disabled={busy || running || draft === null}
              onClick={() =>
                void run(async () => {
                  const created = await api<Version>(`/knowledge/${id}/versions`, 'POST', {
                    payload: JSON.parse(draft!),
                    expectedRevision: item.revision,
                  });
                  setSelected(created.id);
                  setDraft(null);
                })
              }
            >
              保存新版本
            </button>
            <button
              className="primary"
              disabled={busy || running || !!v.publishedAt || draft !== null}
              onClick={() =>
                void run(() =>
                  api(`/knowledge/${id}/publish`, 'POST', {
                    versionId: v.id,
                    expectedRevision: item.revision,
                  }),
                )
              }
            >
              发布知识版本
            </button>
            {v.payload.stage === 'RAW' && (
              <button
                disabled={busy || running || !v.publishedAt}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/knowledge/${id}/clean`,
                      'POST',
                      { sourceVersionId: v.id, expectedRevision: item.revision },
                      true,
                    );
                    setSelected(null);
                  })
                }
              >
                清洗素材
              </button>
            )}
          </div>
          {v.payload.stage === 'CLEAN' && (
            <>
              <label>
                改编要求
                <textarea
                  aria-label="改编要求"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="例如：改为近未来星港背景，重新设计人物身份和目标。"
                />
              </label>
              <button
                disabled={busy || running || !v.publishedAt || !brief.trim()}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/knowledge/${id}/adapt`,
                      'POST',
                      {
                        sourceVersionId: v.id,
                        expectedRevision: item.revision,
                        adaptationBrief: brief,
                      },
                      true,
                    );
                    setSelected(null);
                  })
                }
              >
                生成改编素材
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
