/**
 * BlueprintDomain — 章节蓝图决策域
 * 回环泳道 → 卷展开 → 生成模式切换
 */
import { useState } from "react";
import { Sparkles, RefreshCw, Zap, Check, Loader2, CheckCircle, Scale } from "lucide-react";
import { useNovel, useRebalanceVolume } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string; onComplete?: () => void }
type GenMode = "full" | "per_volume";

const LOOP_PHASE_LABELS: Record<string, { label: string; hint: string; color: string }> = {
  trigger: { label: "触发事件", hint: "新副本/任务/危机引入", color: "bg-yellow-100 text-yellow-700" },
  enter: { label: "进入探索", hint: "主角进入新环境", color: "bg-blue-100 text-blue-700" },
  explore: { label: "深入展开", hint: "副本内部展开，遭遇挑战", color: "bg-brand-100 text-brand-700" },
  setback: { label: "受挫考验", hint: "遭遇重大阻碍或失败", color: "bg-red-100 text-red-700" },
  turn: { label: "转折翻盘", hint: "利用资源/信息逆转局势", color: "bg-brand-100 text-brand-700" },
  climax: { label: "决战高潮", hint: "与最大威胁最终对抗", color: "bg-orange-100 text-orange-700" },
  settlement: { label: "结算收获", hint: "获得新能力/信息/身份", color: "bg-green-100 text-green-700" },
};

export function BlueprintDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const [genMode, setGenMode] = useState<GenMode>("per_volume");
  const [generating, setGenerating] = useState(false);
  const [genSuccess, setGenSuccess] = useState(false);
  const [expandingLoop, setExpandingLoop] = useState<number | null>(null);
  const [expandedLoops, setExpandedLoops] = useState<Set<number>>(new Set());
  const [expandSuccess, setExpandSuccess] = useState(false);
  const [genError, setGenError] = useState("");

  const skeleton = (() => {
    if (!novel?.loopSkeleton) return null;
    try { return JSON.parse(novel.loopSkeleton); } catch { return null; }
  })();

  const volumes = (novel?.volumes ?? []) as Array<{
    id: string; sortOrder: number; title: string; summary?: string | null;
    chapterPlans: Array<{
      id: string; chapterId: string | null; chapterOrder: number; title: string;
      loopPhase?: string | null; chapterType?: string | null;
      chapter?: { id: string; chapterStatus: string } | null;
    }>;
  }>;

  const volumeForLoop = (loopIndex: number) => volumes.find(v => v.sortOrder === loopIndex);

  const handleGenerateSkeleton = async () => {
    setGenerating(true); setGenError(""); setGenSuccess(false);
    try {
      await api.post(`/novels/${novelId}/loops/generate-skeleton`, { architectureType: novel?.architectureType });
      refetch();
      setGenSuccess(true);
      setTimeout(() => setGenSuccess(false), 3000);
    } catch (e) { setGenError(e instanceof Error ? e.message : "生成失败"); }
    finally { setGenerating(false); }
  };

  const [expandError, setExpandError] = useState("");
  const rebalance = useRebalanceVolume();

  const handleExpandVolume = async (volumeOrder: number) => {
    setExpandingLoop(volumeOrder);
    setExpandError("");
    try {
      await api.post(`/novels/${novelId}/pipeline/expand-volume/${volumeOrder}`);
      setExpandedLoops(prev => new Set(prev).add(volumeOrder));
      refetch();
      onComplete?.();
      setExpandSuccess(true);
      setTimeout(() => setExpandSuccess(false), 3000);
    } catch (e) {
      setExpandError(e instanceof Error ? e.message : "展开失败，请重试");
    } finally { setExpandingLoop(null); }
  };

  const handleGenerateAll = async () => {
    setGenerating(true); setGenError("");
    try { await api.post(`/novels/${novelId}/pipeline/generate-all-volumes`); refetch(); }
    catch (e) { setGenError(e instanceof Error ? e.message : "生成失败"); }
    finally { setGenerating(false); }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">生成模式：</span>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button onClick={() => setGenMode("full")} className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", genMode==="full"?"bg-white text-slate-800 shadow-sm":"text-slate-500 hover:text-slate-700")}><Zap size={12} className="inline mr-1" />一键全生成</button>
            <button onClick={() => setGenMode("per_volume")} className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", genMode==="per_volume"?"bg-white text-slate-800 shadow-sm":"text-slate-500 hover:text-slate-700")}>逐卷生成</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {genMode === "full"
            ? "AI 将自动生成回环骨架并一次性展开所有卷为章节（约需 30-90 秒，适合已经确认架构和角色的情况）。"
            : "先生成回环骨架总览，然后你需要逐卷点击「展开为章节」——每卷展开约需 10-30 秒，适合需要精细控制每卷内容的用户。"}
        </p>
      </section>

      {!skeleton && (
        <section className="rounded-xl border border-dashed border-brand-300 bg-brand-50/30 py-8 text-center space-y-3">
          <p className="text-sm text-brand-700 font-medium">{genMode === "full" ? "一键生成全书蓝图" : "先生成回环骨架"}</p>
          <p className="text-xs text-brand-500">{genMode === "full" ? "AI 将一次性生成全书所有回环并展开为章节" : "生成回环骨架后，逐卷展开为章节"}</p>
          <button onClick={genMode === "full" ? handleGenerateAll : handleGenerateSkeleton} disabled={generating || genSuccess}
            className={cn("rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-40",
              genSuccess ? "bg-green-600" : "bg-brand-600 hover:bg-brand-700")}>
            {generating ? <RefreshCw size={13} className="animate-spin inline mr-1" /> :
             genSuccess ? <Check size={13} className="inline mr-1" /> :
             <Sparkles size={13} className="inline mr-1" />}
            {generating ? "生成中..." : genSuccess ? "生成完成" : genMode === "full" ? "一键生成全书蓝图" : "生成回环骨架"}
          </button>
          {genError && <p className="text-xs text-red-500">{genError}</p>}
          {expandError && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-600">{expandError}</div>}
        </section>
      )}

      {skeleton?.loops && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">回环迭代表 · {skeleton.totalLoops}轮回环 · 预计 {skeleton.estimatedTotalChapters} 章</h3>
            {genMode === "full" && <button onClick={handleGenerateAll} disabled={generating} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50"><RefreshCw size={11} className={generating?"animate-spin":""} /> 重新生成</button>}
          </div>

          <div className="overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {skeleton.loops.map((loop: { loopIndex: number; dungeonName: string; estimatedChapters: number }) => {
                const vol = volumeForLoop(loop.loopIndex);
                const isExpanded = expandedLoops.has(loop.loopIndex) || ((vol?.chapterPlans?.length ?? 0) > 0);
                const isExpanding = expandingLoop === loop.loopIndex;
                return (
                  <div key={loop.loopIndex} className={cn("rounded-xl border bg-white min-w-[160px] max-w-[200px] flex flex-col", isExpanded ? "border-green-300" : "border-brand-200")}>
                    <div className="p-3 border-b border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="rounded bg-brand-100 px-1.5 py-0.5 text-xs font-medium text-brand-600">第{loop.loopIndex}轮</span>
                        {isExpanded && <Check size={12} className="text-green-500" />}
                      </div>
                      <div className="text-sm font-medium text-slate-700 truncate">{loop.dungeonName}</div>
                      <div className="text-xs text-slate-400 mt-0.5">~{loop.estimatedChapters}章</div>
                    </div>
                    <div className="p-2 flex-1 space-y-0.5">
                      {["trigger","enter","explore","setback","turn","climax","settlement"].map(phase => (
                        <div key={phase} className={cn("rounded px-1.5 py-0.5 text-[10px]", LOOP_PHASE_LABELS[phase]?.color ?? "bg-slate-100 text-slate-500")}>{LOOP_PHASE_LABELS[phase]?.label ?? phase}</div>
                      ))}
                    </div>
                    <div className="p-2 border-t border-slate-100">
                      {isExpanded ? (
                        <span className="text-[10px] text-green-600 font-medium">已展开 · {vol?.chapterPlans?.length ?? "?"}章</span>
                      ) : (
                        <button onClick={() => handleExpandVolume(loop.loopIndex)} disabled={isExpanding}
                          className={cn(
                            "w-full rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                            expandSuccess && expandedLoops.has(loop.loopIndex) ? "border-green-300 bg-green-50 text-green-600" : "border-brand-200 text-brand-500 hover:bg-brand-50",
                          )}>
                          {isExpanding ? <><Loader2 size={10} className="animate-spin inline mr-0.5" />展开中...</>
                           : expandSuccess && expandedLoops.has(loop.loopIndex) ? <><CheckCircle size={10} className="inline mr-0.5" />展开完成</>
                           : "展开为章节"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {volumes.filter(v => v.chapterPlans.length > 0).slice(0, 3).map(vol => (
            <div key={vol.id} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 p-3 border-b border-slate-100">
                <span className="text-sm font-medium text-slate-700">第{vol.sortOrder}卷 · {vol.title}</span>
                <span className="text-xs text-slate-400">{vol.chapterPlans.length}章</span>
                <div className="flex-1" />
                <button onClick={async () => { try { await rebalance.mutateAsync({ novelId, sortOrder: vol.sortOrder }); refetch(); } catch {} }}
                  disabled={rebalance.isPending}
                  className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 hover:text-brand-600 hover:border-brand-300 disabled:opacity-50"
                  title="根据已写章节重新平衡后续章节">
                  <Scale size={10} />重平衡
                </button>
              </div>
              <div className="p-2">
                {vol.chapterPlans.slice(0, 5).map(ch => (
                  <div key={ch.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <span className="w-5 text-center text-slate-400 shrink-0">{ch.chapterOrder}</span>
                    <span className="text-slate-700 truncate flex-1">{ch.title}</span>
                    {ch.loopPhase && <span className={cn("rounded px-1 py-0 text-[10px] shrink-0", LOOP_PHASE_LABELS[ch.loopPhase]?.color ?? "bg-slate-100 text-slate-500")}>{LOOP_PHASE_LABELS[ch.loopPhase]?.label ?? ch.loopPhase}</span>}
                    {(ch as any).contentBeat && <span className="rounded px-1 py-0 text-[10px] bg-slate-800 text-white shrink-0">{(ch as any).contentBeat}</span>}
                    {ch.chapter?.chapterStatus === "completed" && <Check size={10} className="text-green-500 shrink-0" />}
                  </div>
                ))}
                {vol.chapterPlans.length > 5 && <p className="text-[10px] text-slate-400 px-2 py-1">... 还有 {vol.chapterPlans.length - 5} 章</p>}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
