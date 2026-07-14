/**
 * ReviewPanel — 审查详情（质量评分+诊断）
 * Extracted from ContextPanel.tsx
 */
import { RefreshCw } from "lucide-react";
import { QUALITY_DIMENSIONS } from "@one2novel/shared/types/qualityDimensions";
import { useNovel } from "../../api/novel";
import { type WorkspaceDiagnosis } from "../../api/revision";
import { cn } from "../../lib/cn";

export function ReviewPanel({ novelId, chapterId, quality, diagnosis, reviewing, onReview }: {
  novelId: string; chapterId: string; quality: Record<string, unknown> | null; diagnosis: WorkspaceDiagnosis | null; reviewing: boolean; onReview: () => void;
}) {
  const { data: novel } = useNovel(novelId);
  const chapter = novel?.chapters?.find(c => c.id === chapterId);
  const scores = quality ?? (chapter?.qualityScore && chapter.qualityScore > 0 ? Object.fromEntries(QUALITY_DIMENSIONS.map(d => [d.scoreField, (chapter as unknown as Record<string, unknown>)[d.scoreField] ?? 0])) : null);
  const total = scores ? Object.values(scores).reduce((a: number, b) => a + (typeof b === 'number' ? b : 0), 0) : 0;
  const displayDiagnosis = diagnosis ?? (() => { try { return chapter?.diagnosis ? JSON.parse(chapter.diagnosis) : null; } catch { return null; } })();

  return (
    <div className="space-y-4 text-xs">
      {reviewing ? <div className="flex items-center gap-2 text-blue-500"><RefreshCw size={12} className="animate-spin" />AI 审查中...</div>
      : !scores ? (
        <div className="space-y-2"><p className="text-slate-400">点击对本章进行AI审查（质量评分+段落诊断）</p><button onClick={onReview} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">开始审查</button></div>
      ) : (
        <>
          <div className="text-slate-600">总分 <span className="font-bold text-slate-800">{total}</span>/100</div>
          <div className="space-y-0.5">
            {QUALITY_DIMENSIONS.map(d => {
              const v = typeof scores?.[d.scoreField] === 'number' ? scores[d.scoreField] as number : 0;
              return (
              <div key={d.key} className="flex items-center gap-2"><span className="w-16 text-right text-slate-500 shrink-0">{d.label}</span><div className="flex-1 h-1.5 bg-slate-100 rounded-full"><div className={cn("h-full rounded-full", v>=7?"bg-green-400":v>=5?"bg-accent-400":"bg-red-400")} style={{width:`${v*10}%`}}/></div><span className="w-3 text-right font-medium">{v}</span></div>
            )})}
          </div>
          {displayDiagnosis?.cards?.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-slate-600">段落诊断</p>
              {displayDiagnosis.cards.map((card: any, i: number) => (
                <div key={i} className="rounded border border-slate-200 p-1.5"><span className="text-[10px] px-1 py-0 rounded bg-slate-100 text-slate-600">{card.title}</span><div className="text-slate-500 mt-0.5">{card.problemSummary}</div></div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
