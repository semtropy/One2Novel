/**
 * TimelinePanel — 时间线（提醒+冲突+重提）
 * Extracted from ContextPanel.tsx
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useNovel } from "../../api/novel";
import { useTimelineReminders } from "../../api/timeline";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

export function TimelinePanel({ novelId, chapterId, chapterOrder }: { novelId: string; chapterId: string; chapterOrder?: number }) {
  const { data: novel, refetch } = useNovel(novelId);
  const qc = useQueryClient();
  const timelines = novel?.timelineItems ?? [];
  const { data: reminders } = useTimelineReminders(novelId, chapterOrder);
  const [conflicts, setConflicts] = useState<Array<{ description: string }>>([]);
  const [checking, setChecking] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const hasContent = !!(novel?.chapters?.find(c => c.id === chapterId)?.content && (novel.chapters.find(c => c.id === chapterId)!.content!.length > 100));

  async function handleReExtract() {
    if (reExtracting || !chapterId) return; setReExtracting(true);
    try { await api.post(`/novels/${novelId}/chapters/${chapterId}/timeline/re-extract`); refetch(); qc.invalidateQueries({ queryKey: ["timeline-reminders", novelId, chapterOrder] }); } catch {} finally { setReExtracting(false); }
  }

  return (
    <div className="space-y-3 text-xs">
      {reminders && reminders.reminders.length > 0 && (
        <div className="rounded bg-blue-50 p-2 text-[10px]">
          <p className="font-medium text-blue-700 mb-1">写前提醒</p>
          {reminders.reminders.map((r, i) => <div key={i} className={r.isOverdue ? "text-red-600" : "text-blue-600"}>{r.isOverdue ? "⚠" : "•"} {r.title}</div>)}
        </div>
      )}
      <div className="flex gap-1.5">
        <button onClick={async () => { setChecking(true); try { const r = await api.get(`/novels/${novelId}/timeline/conflicts`); setConflicts(r.data.data ?? []); } catch {} finally { setChecking(false); } }} disabled={checking} className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">{checking ? "检查中..." : "检查冲突"}</button>
        {hasContent && <button onClick={handleReExtract} disabled={reExtracting} className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">{reExtracting ? <RefreshCw size={10} className="animate-spin inline mr-0.5" /> : null}重提</button>}
      </div>
      {conflicts.length > 0 && conflicts.map((c, i) => <div key={i} className="rounded border border-red-200 bg-red-50 p-1.5 text-[10px] text-red-600"><AlertTriangle size={10} className="inline mr-1" />{c.description}</div>)}
      {/* Color legend */}
      {timelines.length > 0 && <div className="flex items-center gap-2 text-[10px] text-slate-400"><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />事件</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-brand-400" />里程碑</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />截止日</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-accent-400" />约束</span></div>}
      {timelines.length > 0 ? (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {timelines.slice(-15).reverse().map((t: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-slate-600">
              <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full", t.status === "violated" ? "bg-red-500" : t.category === "milestone" ? "bg-brand-400" : t.category === "deadline" ? "bg-red-400" : t.category === "constraint" ? "bg-accent-400" : "bg-blue-400")} />
              <span className="truncate">{t.title}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-slate-400 italic">写完章节后自动提取时间线</p>}
    </div>
  );
}
