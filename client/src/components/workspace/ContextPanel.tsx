/**
 * ContextPanel — 右侧工具栏，九宫格卡片按钮 + 弹窗面板
 * 覆盖：写法/伏笔/分镜/角色动态/时间线/审查详情/统计/仪表盘/历史
 */
import { useState, useEffect } from "react";
import {
  Users, History, ClipboardList, Eye, Target, FileText, BarChart3,
  RefreshCw, X, AlertTriangle, Gauge, Clock,
} from "lucide-react";
import { useNovel, useTimelineReminders, useFormattingIssues, useCleanupChapter, usePayoffStats, useNovelStatistics } from "../../api/novel";
import { StatisticsDashboard } from "./StatisticsDashboard";
import { WritingDashboard } from "./WritingDashboard";
import { ChapterDiffModal } from "./ChapterDiffModal";
import { api } from "../../app/api";
import { SEVERITY_LABEL } from "@one2novel/shared";
import { OPERATION_LABELS, type WorkspaceDiagnosis } from "../../api/revision";
import { cn } from "../../lib/cn";

interface Props {
  novelId: string; chapterId: string | null;
  chapterTitle?: string; chapterOrder?: number;
  quality: Record<string, unknown> | null;
  diagnosis: WorkspaceDiagnosis | null;
  reviewing: boolean;
  onReview: () => void;
}

type PanelKey = "style" | "payoff" | "scene" | "character" | "timeline" | "review" | "stats" | "dashboard" | "history";

const PANELS: Array<{ key: PanelKey; label: string; icon: any }> = [
  { key: "style",     label: "写法",     icon: Eye },
  { key: "payoff",    label: "伏笔",     icon: Target },
  { key: "scene",     label: "分镜",     icon: FileText },
  { key: "character", label: "角色动态", icon: Users },
  { key: "timeline",  label: "时间线",   icon: History },
  { key: "review",    label: "审查详情", icon: ClipboardList },
  { key: "stats",     label: "统计",     icon: BarChart3 },
  { key: "dashboard", label: "仪表盘",   icon: Gauge },
  { key: "history",   label: "历史",     icon: Clock },
];

export function ContextPanel(p: Props) {
  const [active, setActive] = useState<PanelKey | null>(null);

  return (
    <div className="flex flex-col h-full">
      <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2 px-1">工具箱</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {PANELS.map(panel => (
          <button key={panel.key} onClick={() => setActive(panel.key)} disabled={!p.chapterId}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white p-2.5 transition-all hover:border-slate-400 hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
            <panel.icon size={16} className="text-slate-600" />
            <span className="text-[10px] font-medium text-slate-500">{panel.label}</span>
          </button>
        ))}
      </div>

      {/* Full components (self-contained modals) */}
      {active === "stats" && p.chapterId && <StatisticsDashboard novelId={p.novelId} onClose={() => setActive(null)} />}
      {active === "dashboard" && p.chapterId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActive(null)}>
          <div className="w-[42rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">写作仪表盘</h3>
              <button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <WritingDashboard novelId={p.novelId} chapterId={p.chapterId} />
          </div>
        </div>
      )}
      {active === "history" && p.chapterId && <ChapterDiffModal novelId={p.novelId} chapterId={p.chapterId} onClose={() => setActive(null)} />}

      {/* Generic modal for other panels */}
      {active && p.chapterId && !["stats", "dashboard", "history"].includes(active) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActive(null)}>
          <div className="w-[36rem] max-h-[80vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">{PANELS.find(x => x.key === active)?.label}</h3>
              <button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <PanelBody novelId={p.novelId} chapterId={p.chapterId} chapterOrder={p.chapterOrder}
              panelKey={active} quality={p.quality} diagnosis={p.diagnosis}
              reviewing={p.reviewing} onReview={p.onReview} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel Body Router ────────────────────────────────────

function PanelBody({ novelId, chapterId, chapterOrder, panelKey, quality, diagnosis, reviewing, onReview }: {
  novelId: string; chapterId: string; chapterOrder?: number; panelKey: PanelKey;
  quality: Record<string, unknown> | null; diagnosis: WorkspaceDiagnosis | null;
  reviewing: boolean; onReview: () => void;
}) {
  switch (panelKey) {
    case "style":     return <StylePanel novelId={novelId} chapterId={chapterId} />;
    case "payoff":    return <PayoffPanel novelId={novelId} chapterId={chapterId} />;
    case "scene":     return <ScenePanel novelId={novelId} chapterId={chapterId} />;
    case "character": return <CharacterPanel novelId={novelId} chapterId={chapterId} />;
    case "timeline":  return <TimelinePanel novelId={novelId} chapterId={chapterId} chapterOrder={chapterOrder} />;
    case "review":    return <ReviewPanel novelId={novelId} chapterId={chapterId} quality={quality} diagnosis={diagnosis} reviewing={reviewing} onReview={onReview} />;
    default: return null;
  }
}

// ─── Individual Panels ────────────────────────────────────

function StylePanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { data: issues } = useFormattingIssues(novelId, chapterId);
  const cleanup = useCleanupChapter();
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">章节格式检查与清理，去除AI痕迹和冗余表达。</p>
      {issues && issues.length > 0 ? (
        <div className="space-y-1">
          {issues.map((iss, i) => (
            <div key={i} className="rounded border border-slate-200 p-2">
              <span className={cn("text-[10px] px-1 py-0.5 rounded mr-1", iss.severity === "high" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")}>{iss.type}</span>
              <span className="text-slate-600">{iss.description}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-slate-400 italic">点击下方按钮检查格式问题</p>}
      <button onClick={() => cleanup.mutate({ novelId, chapterId })} disabled={cleanup.isPending}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {cleanup.isPending ? "清理中..." : "自动清理格式问题"}
      </button>
    </div>
  );
}

function PayoffPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const stats = usePayoffStats(novelId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", scopeType: "volume" });

  async function handleAdd() {
    if (!form.title.trim()) return;
    try { await api.post(`/novels/${novelId}/payoffs`, form); setShowForm(false); setForm({ title: "", summary: "", scopeType: "volume" }); } catch {}
  }

  return (
    <div className="space-y-3 text-xs">
      {stats.data && (
        <div className="flex gap-3 text-[10px] text-slate-400">
          <span>总计{stats.data.total}条</span>
          <span className="text-accent-500">待兑现{stats.data.pendingPayoff}</span>
          <span className="text-green-500">已兑现{stats.data.paidOff}</span>
        </div>
      )}
      <button onClick={() => setShowForm(!showForm)}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">+ 添加伏笔</button>
      {showForm && (
        <div className="space-y-2 rounded border border-slate-200 p-3">
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="伏笔标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="简要描述" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
          <select className="w-full rounded border border-slate-200 px-2 py-1 text-xs" value={form.scopeType} onChange={e => setForm({ ...form, scopeType: e.target.value })}>
            <option value="book">全书级</option><option value="volume">卷级</option><option value="chapter">章级</option>
          </select>
          <button onClick={handleAdd} className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">确认添加</button>
        </div>
      )}
    </div>
  );
}

function ScenePanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const [scenes, setScenes] = useState<Array<{ goal: string; pov: string; summary: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!chapterId) return;
    api.get(`/novels/${novelId}/chapters/${chapterId}/scenes`).then(({ data }) => {
      if (data.data?.scenes) setScenes(data.data.scenes);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [novelId, chapterId]);

  async function handleGenerate() {
    try { const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/scenes/generate`); if (data.data?.scenes) setScenes(data.data.scenes); } catch {}
  }

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">章节分镜计划，2-4个场景，每个场景有明确的叙事目标和POV。</p>
      {scenes.length > 0 ? (
        <div className="space-y-2">
          {scenes.map((s, i) => (
            <div key={i} className="rounded border border-slate-200 p-2">
              <div className="font-medium text-slate-700">场景{i + 1} · POV: {s.pov}</div>
              <div className="text-slate-500 mt-0.5">{s.summary}</div>
            </div>
          ))}
        </div>
      ) : loaded ? <p className="text-slate-400 italic">暂无分镜，点击生成</p> : <p className="text-slate-400 italic">加载中...</p>}
      <button onClick={handleGenerate} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">AI 生成分镜</button>
    </div>
  );
}

function CharacterPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { data: novel } = useNovel(novelId);
  const chars = (novel as any)?.characters ?? [];
  const active = chars.filter((c: any) => c.currentStatus || c.currentGoal);

  return (
    <div className="space-y-2 text-xs">
      {active.length > 0 ? active.slice(0, 8).map((c: any, i: number) => (
        <div key={i} className="rounded border border-slate-200 p-2">
          <div className="font-medium text-slate-700">{c.name} · {c.role === "protagonist" ? "主角" : c.role === "antagonist" ? "反派" : "配角"}</div>
          {c.currentStatus && <div className="text-slate-500">状态：{c.currentStatus}</div>}
          {c.currentGoal && <div className="text-slate-500">目标：{c.currentGoal}</div>}
        </div>
      )) : <p className="text-slate-400 italic">写完章节后自动更新角色状态</p>}
    </div>
  );
}

function TimelinePanel({ novelId, chapterId, chapterOrder }: { novelId: string; chapterId: string; chapterOrder?: number }) {
  const { data: novel } = useNovel(novelId);
  const timelines = (novel as any)?.timelineItems ?? [];
  const { data: reminders } = useTimelineReminders(novelId, chapterOrder);
  const [conflicts, setConflicts] = useState<Array<{ description: string }>>([]);
  const [checking, setChecking] = useState(false);

  return (
    <div className="space-y-3 text-xs">
      {reminders && reminders.reminders.length > 0 && (
        <div className="rounded bg-blue-50 p-2 text-[10px]">
          <p className="font-medium text-blue-700 mb-1">写前提醒</p>
          {reminders.reminders.map((r, i) => (
            <div key={i} className={r.isOverdue ? "text-red-600" : "text-blue-600"}>{r.isOverdue ? "⚠" : "•"} {r.title}</div>
          ))}
        </div>
      )}
      <button onClick={async () => { setChecking(true); try { const r = await api.get(`/novels/${novelId}/timeline/conflicts`); setConflicts(r.data.data ?? []); } catch {} finally { setChecking(false); } }}
        disabled={checking} className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {checking ? "检查中..." : "检查时间线冲突"}
      </button>
      {conflicts.length > 0 && conflicts.map((c, i) => (
        <div key={i} className="rounded border border-red-200 bg-red-50 p-1.5 text-[10px] text-red-600"><AlertTriangle size={10} className="inline mr-1" />{c.description}</div>
      ))}
      {timelines.length > 0 && (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {timelines.slice(-15).reverse().map((t: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-slate-600">
              <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full", t.category === "milestone" ? "bg-brand-400" : t.category === "deadline" ? "bg-red-400" : "bg-blue-400")} />
              <span className="truncate">{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ novelId, chapterId, quality, diagnosis, reviewing, onReview }: {
  novelId: string; chapterId: string; quality: Record<string, unknown> | null;
  diagnosis: WorkspaceDiagnosis | null; reviewing: boolean; onReview: () => void;
}) {
  const { data: novel } = useNovel(novelId);
  const chapter = (novel as any)?.chapters?.find((c: any) => c.id === chapterId);
  const scores = quality ?? (chapter?.qualityScore > 0 ? { openingScore: chapter.openingScore, plotScore: chapter.plotScore, characterScore: chapter.characterScore, dialogueScore: chapter.dialogueScore, suspenseScore: chapter.suspenseScore, pacingScore: chapter.pacingScore, showNotTellScore: chapter.showNotTellScore, languageScore: chapter.languageScore, genreScore: chapter.genreScore, coherenceScore: chapter.coherenceScore } : null);
  const total = scores ? Object.values(scores as Record<string,number>).reduce((a,b) => a+(b||0), 0) : 0;
  const displayDiagnosis = diagnosis ?? (() => { try { return chapter?.diagnosis ? JSON.parse(chapter.diagnosis) : null; } catch { return null; } })();

  return (
    <div className="space-y-4 text-xs">
      {reviewing ? <div className="flex items-center gap-2 text-blue-500"><RefreshCw size={12} className="animate-spin" />AI 审查中...</div>
      : !scores ? (
        <div className="space-y-2">
          <p className="text-slate-400">点击对本章进行AI审查</p>
          <button onClick={onReview} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">开始审查</button>
        </div>
      ) : (
        <>
          <div className="text-slate-600">总分 <span className="font-bold text-slate-800">{total}</span>/100</div>
          <div className="space-y-0.5">
            {[["开头吸引力","openingScore"],["情节推进","plotScore"],["人物塑造","characterScore"],["对话质量","dialogueScore"],["悬念设置","suspenseScore"],["节奏控制","pacingScore"],["展示而非讲述","showNotTellScore"],["语言质量","languageScore"],["题材适应度","genreScore"],["跨章连贯性","coherenceScore"]].map(([l,k]) => (
              <div key={l} className="flex items-center gap-2">
                <span className="w-16 text-right text-slate-500 shrink-0">{l}</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full"><div className={cn("h-full rounded-full", (scores as any)[k]>=7?"bg-green-400":(scores as any)[k]>=5?"bg-accent-400":"bg-red-400")} style={{width:`${(scores as any)[k]*10}%`}}/></div>
                <span className="w-3 text-right font-medium">{(scores as any)[k]}</span>
              </div>
            ))}
          </div>
          {displayDiagnosis?.cards?.length > 0 && displayDiagnosis.cards.map((card: any, i: number) => (
            <div key={i} className="rounded border border-slate-200 p-1.5"><span className="text-[10px] px-1 py-0 rounded bg-slate-100 text-slate-600">{card.title}</span><div className="text-slate-500 mt-0.5">{card.problemSummary}</div></div>
          ))}
        </>
      )}
    </div>
  );
}

