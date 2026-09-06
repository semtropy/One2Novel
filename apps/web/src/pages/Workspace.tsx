import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, BookOpen, Check } from 'lucide-react';
import { api, active, type Project } from '../api';
import { Shell, Modal, ErrorBox, Loading } from '../components/ui';
import { OpeningPanel } from '../features/OpeningPanel';
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
    [rewrite, setRewrite] = useState<unknown>(null);
  const qc = useQueryClient();
  const p = q.data,
    job = p?.jobs.find(active) || p?.jobs[0],
    number = selected ?? (p?.headChapter ? p.headChapter : 1);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['project', id] });
    await qc.invalidateQueries({ queryKey: ['chapter', id] });
  };
  useEffect(() => {
    if (!job || !active(job)) return;
    const events = new EventSource(`/api/v1/jobs/${job.id}/events`);
    const update = () => void refresh();
    for (const name of ['stage', 'done', 'error', 'committed'])
      events.addEventListener(name, update);
    return () => events.close();
  }, [job?.id, job?.status]);
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
      (a) => a.kind === 'EVALUATION' && p.jobs.some((j) => j.number === number && j.id === a.jobId),
    );
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
        <a className="button" href={`/api/v1/projects/${p.id}/export?format=md`}>
          <Download size={15} />
          导出
        </a>
      </div>
      <div className="workspace">
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
              onAction={run}
              busy={busy || isActive}
              onWrite={async (mode) => {
                setSelected(next);
                await api(
                  `/projects/${p.id}/write`,
                  'POST',
                  {
                    expectedRevision: p.revision,
                    mode: mode.mode,
                    draftRevision: mode.draftRevision,
                  },
                  true,
                );
              }}
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
          <JobPanel job={job} onAction={run} />
        </aside>
      </div>
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
