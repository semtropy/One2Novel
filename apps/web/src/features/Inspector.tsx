import { useQuery } from '@tanstack/react-query';
import { Check, AlertCircle, LoaderCircle, Square, RotateCcw } from 'lucide-react';
import { stageLabels, type EvaluatorResult, type StoryState } from '@one2novel/contracts';
import { api, active, type Artifact, type Project, type Job } from '../api';
import { ErrorBox } from '../components/ui';
export function PlanView({ artifact }: { artifact: Artifact }) {
  const p = artifact.payload as {
    title: string;
    summary: string;
    expectedEvents: string[];
    beats: { description: string }[];
  };
  return (
    <>
      <h3>{p.title}</h3>
      <p>{p.summary}</p>
      <h4>预计发生</h4>
      {p.expectedEvents.map((e, i) => (
        <div className="beat" key={i}>
          <span>{i + 1}</span>
          <p>{e}</p>
        </div>
      ))}
    </>
  );
}

export function EvaluationView({ artifact }: { artifact?: Artifact }) {
  if (!artifact)
    return <p className="muted">正文生成后进行独立审核。只有必需审核通过，章节才会正式提交。</p>;
  const e = artifact.payload as { status: string; results: EvaluatorResult[] };
  return (
    <>
      <div className={`verdict ${e.status === 'PASS' ? 'pass' : ''}`}>
        {e.status === 'PASS' ? <Check size={17} /> : <AlertCircle size={17} />}{' '}
        {e.status === 'PASS' ? '审核通过' : '需要修订'}
      </div>
      {e.results.map((r) => (
        <details className="evaluation" key={r.evaluatorId}>
          <summary>
            <span>
              {(
                {
                  'chapter-quality': '章节质量',
                  continuity: '连续性',
                  'core.hard-constraints': '计划与约束',
                  logic: '因果逻辑',
                  'character-consistency': '人物一致性',
                  style: '文字风格',
                  repetition: '重复检查',
                  'core.state-consistency': '事实一致性',
                } as Record<string, string>
              )[r.evaluatorId] || r.evaluatorId}
            </span>
            <b>{r.score === null ? '—' : `${r.score}/4`}</b>
          </summary>
          <p>{r.reason}</p>
          {r.issues.map((i) => (
            <div className="issue" key={i.id}>
              <strong>
                {i.severity} · {i.message}
              </strong>
              <p>{i.suggestion}</p>
              {i.spans.map((s, n) => (
                <blockquote key={n}>{s.quote}</blockquote>
              ))}
            </div>
          ))}
        </details>
      ))}
    </>
  );
}

export function StateView({ project: p }: { project: Project }) {
  const q = useQuery({
    queryKey: ['state', p.id, p.headSnapshotId],
    queryFn: () => api<{ state: StoryState }>(`/projects/${p.id}/story-state`),
    enabled: !!p.headSnapshotId,
  });
  return (
    <div className="inspector-body">
      <div className="eyebrow">已发生的故事</div>
      <p className="hint">截至第 {p.headChapter} 章的已提交事实</p>
      <ErrorBox error={q.error} />
      {q.data ? (
        <>
          {Object.values(q.data.state.entities).map((e) => (
            <details className="evaluation" key={e.id}>
              <summary>
                {e.name}
                <span className="muted">
                  {e.kind === 'CHARACTER'
                    ? '人物'
                    : e.kind === 'LOCATION'
                      ? '地点'
                      : e.kind === 'ITEM'
                        ? '物品'
                        : '设定'}
                </span>
              </summary>
              <p>{e.description}</p>
              {q.data!.state.characters[e.id] && (
                <p>生命状态：{q.data!.state.characters[e.id].life}</p>
              )}
            </details>
          ))}
          {Object.values(q.data.state.promises).map((p) => (
            <div className="issue" key={p.id}>
              <strong>{p.description}</strong>
              <p>
                {p.status} · {p.resolutionCondition}
              </p>
            </div>
          ))}
          <details>
            <summary>完整事实记录</summary>
            <pre>{JSON.stringify(q.data.state, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p className="muted">确认开书设定后可查看初始事实。</p>
      )}
    </div>
  );
}

export function JobPanel({
  job,
  onAction,
}: {
  job?: Job;
  onAction: (f: () => Promise<unknown>) => Promise<void>;
}) {
  if (!job) return null;
  const isBatch = job.kind === 'BATCH',
    children = job.children || [],
    child = children.find((j) => j.status !== 'SUCCEEDED'),
    budgetJob = isBatch ? child : job,
    resumable = ['PAUSED', 'FAILED', 'INTERRUPTED'].includes(job.status);
  return (
    <div className="job-panel">
      <div className="job-title">
        {active(job) ? (
          <LoaderCircle className="spin" size={15} />
        ) : job.status === 'SUCCEEDED' ? (
          <Check size={15} />
        ) : (
          <AlertCircle size={15} />
        )}
        <strong>{stageLabels[active(job) ? job.stage : job.status] || job.status}</strong>
      </div>
      {isBatch ? (
        <>
          <p className="batch-progress">
            本批已提交 {children.filter((j) => j.status === 'SUCCEEDED').length} / {job.input.count}{' '}
            章
          </p>
          <p className="hint">
            第 {job.input.fromChapter}–{job.input.endChapter} 章 · 累计调用{' '}
            {children.reduce((sum, j) => sum + j.httpUsed, 0)} 次
          </p>
          {child && (
            <p className="hint">
              第 {child.number} 章 ·{' '}
              {stageLabels[active(child) ? child.stage : child.status] || child.status} · 调用{' '}
              {child.httpUsed}/{child.httpLimit}
            </p>
          )}
          {job.pauseRequested && active(job) && <p className="hint">当前章完成后暂停</p>}
          {job.status === 'SUCCEEDED' && <p className="hint">本批创作结束，未自动标记全书完结。</p>}
        </>
      ) : (
        <p className="hint">
          模型调用 {job.httpUsed} / {job.httpLimit}
        </p>
      )}
      {job.cancelRequested && active(job) && <p className="hint">正在取消…</p>}
      {job.errorMessage && <p className="job-error">{job.errorMessage}</p>}
      <div className="actions wrap">
        {active(job) ? (
          <>
            {isBatch && (
              <button
                disabled={job.pauseRequested || job.cancelRequested}
                onClick={() =>
                  void onAction(() =>
                    api(`/jobs/${job.id}/pause`, 'POST', { expectedRevision: job.revision }),
                  )
                }
              >
                本章后暂停
              </button>
            )}
            <button
              disabled={job.cancelRequested}
              onClick={() => void onAction(() => api(`/jobs/${job.id}/cancel`, 'POST', {}))}
            >
              <Square size={12} />
              取消任务
            </button>
          </>
        ) : resumable ? (
          <>
            <button
              onClick={() =>
                void onAction(() =>
                  api(`/jobs/${job.id}/retry`, 'POST', { expectedRevision: job.revision }),
                )
              }
            >
              <RotateCcw size={13} />
              恢复任务
            </button>
            {budgetJob && (
              <button
                onClick={() =>
                  void onAction(() =>
                    api(`/jobs/${budgetJob.id}/budget`, 'POST', {
                      expectedRevision: budgetJob.revision,
                      httpLimit: budgetJob.httpLimit + 20,
                      bodyRepairLimit: budgetJob.bodyRepairLimit + 2,
                      deltaRepairLimit: budgetJob.deltaRepairLimit + 2,
                    }),
                  )
                }
              >
                增加额度
              </button>
            )}
            {isBatch && (
              <button
                onClick={() => void onAction(() => api(`/jobs/${job.id}/cancel`, 'POST', {}))}
              >
                结束此批次
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
