import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, BookOpen, Check } from 'lucide-react';
import { api, active, type Project } from '../api';
import { Shell, Modal, ErrorBox, Loading } from '../components/ui';
import { OpeningPanel } from '../features/OpeningPanel';
import { PlanManager } from '../features/PlanManager';
import { KnowledgeBindings } from '../features/KnowledgeBindings';
import { ChapterEditor } from '../features/ChapterEditor';
import { PlanView, EvaluationView, StateView, JobPanel } from '../features/Inspector';
export function Workspace() {
  const { id } = useParams(),
    q = useQuery({
      queryKey: ['project', id],
      queryFn: () => api<Project>(`/projects/${id}`),
      refetchInterval: 2000,
    });
  const [selected, setSelected] = useState<number | null>(null),
    [tab, setTab] = useState('plan'),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [batchOpen, setBatchOpen] = useState(false),
    [bindingsOpen, setBindingsOpen] = useState(false),
    [plansOpen, setPlansOpen] = useState(false),
    [batchCount, setBatchCount] = useState(2),
    [rewrite, setRewrite] = useState<unknown>(null);
  const [recoveryCandidate, setRecoveryCandidate] = useState<{ number: number; id: string } | null>(
    null,
  );
  const qc = useQueryClient();
  const p = q.data,
    command = p?.jobs.find(active) || p?.jobs[0],
    job =
      command?.kind === 'BATCH'
        ? command.children?.find(active) || command.children?.at(-1)
        : command,
    number =
      selected ??
      (command?.kind === 'BATCH' && job && active(job) ? job.number! : p?.headChapter || 1);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['project', id] });
    await qc.invalidateQueries({ queryKey: ['chapter', id] });
  };
  useEffect(() => {
    if (!command || !active(command)) return;
    const events = new EventSource(`/api/v1/jobs/${command.id}/events`);
    const update = () => void refresh();
    for (const name of ['stage', 'done', 'error', 'committed', 'progress'])
      events.addEventListener(name, update);
    return () => events.close();
  }, [command?.id, command?.status]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (q.isPending)
    return (
      <Shell>
        <Loading />
      </Shell>
    );
  if (!p)
    return (
      <Shell>
        <ErrorBox error={q.error} />
      </Shell>
    );
  const isActive = !!p.jobs.find(active),
    next = p.headChapter + 1,
    plan = p.artifacts.find(
      (a) =>
        a.kind === 'PLAN' && (a.payload as { chapterRange: number[] }).chapterRange?.[0] === number,
    ),
    evaluation = p.artifacts.find(
      (a) =>
        a.kind === 'EVALUATION' &&
        p.jobs
          .flatMap((j) => [j, ...(j.children || [])])
          .some((j) => j.number === number && j.id === a.jobId),
    );
  const writeCurrent = async (mode: { mode: string; draftRevision: number | null }) => {
    setSelected(next);
    const restarting =
      command &&
      ['CHAPTER', 'BATCH'].includes(command.kind) &&
      ['PAUSED', 'FAILED', 'INTERRUPTED', 'WAITING_USER'].includes(command.status);
    await api(
      restarting ? `/jobs/${command.id}/restart` : `/projects/${p.id}/write`,
      'POST',
      restarting
        ? { expectedRevision: command.revision, projectRevision: p.revision, ...mode }
        : { expectedRevision: p.revision, ...mode },
      true,
    );
    setRecoveryCandidate(null);
  };
  return (
    <Shell>
      <div className="workspace-top">
        <Link to="/" className="text-link">
          <ArrowLeft size={16} />
          书架
        </Link>
        <div>
          <h1>{p.title}</h1>
          <span>
            {p.genre} · 已完成 {p.headChapter} 章
          </span>
        </div>
        <div className="actions">
          {p.headSnapshotId && (
            <button disabled={busy || isActive} onClick={() => setPlansOpen(true)}>
              计划管理
            </button>
          )}
          <button disabled={busy || isActive} onClick={() => setBindingsOpen(true)}>
            创作知识
          </button>
          {p.headSnapshotId && p.targetCount - p.headChapter >= 2 && (
            <button
              disabled={busy || isActive}
              onClick={() => {
                setBatchCount(Math.min(3, p.targetCount - p.headChapter));
                setBatchOpen(true);
              }}
            >
              连续创作
            </button>
          )}
          <a className="button" href={`/api/v1/projects/${p.id}/export?format=md`}>
            <Download size={15} />
            导出
          </a>
        </div>
      </div>
      <div className="workspace">
        {plansOpen && (
          <PlanManager
            project={p}
            busy={busy || isActive}
            onAction={run}
            onClose={() => setPlansOpen(false)}
          />
        )}
        <aside className="chapters">
          <div className="rail-title">
            章节目录<span>{p.targetCount} 章目标</span>
          </div>
          <button
            className={!p.headSnapshotId ? 'chapter-item selected' : 'chapter-item'}
            onClick={() => setSelected(0)}
          >
            <BookOpen size={16} />
            全书与初始设定
          </button>
          {Array.from({ length: Math.min(next, p.targetCount) }, (_, i) => i + 1).map((n) => {
            const c = p.chapters.find((c) => c.number === n);
            return (
              <button
                key={n}
                className={`chapter-item ${number === n ? 'selected' : ''}`}
                onClick={() => setSelected(n)}
              >
                <span className="chapter-number">{String(n).padStart(2, '0')}</span>
                <span>{c?.title || `第${n}章`}</span>
                {c?.activeContentId ? <Check size={14} className="complete" /> : null}
              </button>
            );
          })}
          <div className="rail-foot">
            <span className="dot" />
            本机保存 · 独立创作
          </div>
        </aside>
        <section className="writing-area">
          <ErrorBox error={error} />
          {!p.headSnapshotId || selected === 0 ? (
            <OpeningPanel project={p} busy={busy || isActive} onAction={run} />
          ) : (
            <ChapterEditor
              key={`${p.id}:${number}`}
              project={p}
              number={number}
              job={job}
              initialVersionId={
                recoveryCandidate?.number === number ? recoveryCandidate.id : undefined
              }
              onAction={run}
              busy={busy || isActive}
              onWrite={writeCurrent}
              onRewrite={async () => {
                const preview = await api(
                  `/projects/${p.id}/rewrite-preview?fromChapter=${number}`,
                );
                setRewrite(preview);
              }}
            />
          )}
        </section>
        <aside className="inspector">
          <div className="tabs">
            {[
              ['plan', '规划'],
              ['quality', '审核'],
              ['state', '事实'],
            ].map(([value, label]) => (
              <button
                className={tab === value ? 'selected' : ''}
                onClick={() => setTab(value)}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'plan' ? (
            <div className="inspector-body">
              <div className="eyebrow">本章方向</div>
              {plan ? (
                <PlanView artifact={plan} />
              ) : (
                <p className="muted">启动章节后，系统会根据当前故事进展整理本章计划。</p>
              )}
            </div>
          ) : tab === 'quality' ? (
            <div className="inspector-body">
              <EvaluationView artifact={evaluation} />
            </div>
          ) : (
            <StateView project={p} />
          )}
          <JobPanel
            job={command}
            onAction={run}
            onViewCandidate={(number, contentId) => {
              setSelected(number);
              setRecoveryCandidate({ number, id: contentId });
            }}
            onRestart={() => writeCurrent({ mode: 'GENERATE', draftRevision: null })}
          />
        </aside>
      </div>
      {batchOpen && (
        <Modal title="连续创作" onClose={() => setBatchOpen(false)}>
          <p>从第 {next} 章开始，逐章审核并提交。某章未通过时会暂停，可处理后继续。</p>
          <label>
            本批章数
            <input
              aria-label="本批章数"
              type="number"
              min={2}
              max={Math.min(10, p.targetCount - p.headChapter)}
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
            />
          </label>
          <p className="hint">
            每章最多 40 次模型请求，初始最多修订正文及状态各 2
            次。可在当前章完成后暂停，或立即取消剩余任务。
          </p>
          <ErrorBox error={error} />
          <div className="actions">
            <button onClick={() => setBatchOpen(false)}>取消</button>
            <button
              className="primary"
              disabled={
                busy ||
                isActive ||
                !Number.isInteger(batchCount) ||
                batchCount < 2 ||
                batchCount > Math.min(10, p.targetCount - p.headChapter)
              }
              onClick={() =>
                void run(async () => {
                  await api(
                    `/projects/${p.id}/production-runs`,
                    'POST',
                    {
                      expectedRevision: p.revision,
                      mode: 'GENERATE',
                      draftRevision: null,
                      count: batchCount,
                    },
                    true,
                  );
                  setSelected(null);
                  setBatchOpen(false);
                })
              }
            >
              开始连续创作
            </button>
          </div>
        </Modal>
      )}
      {bindingsOpen && <KnowledgeBindings project={p} onClose={() => setBindingsOpen(false)} />}
      {!!rewrite && (
        <Modal title={`从第 ${number} 章开始重写`} onClose={() => setRewrite(null)}>
          <p>
            第 {number} 章及之后的正式版本将退出当前故事链，旧版本仍可查看。请重新逐章审核与提交。
          </p>
          <ErrorBox error={error} />
          <div className="actions">
            <button onClick={() => setRewrite(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/projects/${p.id}/rewrites`, 'POST', rewrite, true);
                  setRewrite(null);
                })
              }
            >
              确认回退并重写
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
