/**
 * BlueprintDomain — 章节蓝图决策域
 * 回环泳道 → 卷展开 → 生成模式切换
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, RefreshCw, Zap, Check, Loader2, CheckCircle, Scale, GripVertical, GitBranch, AlertTriangle, ArrowUp, ArrowDown, Plus, X, Save } from "lucide-react";
import { useNovel } from "../../api/novel";
import { useRebalanceVolume } from "../../api/volumes";
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
  const navigate = useNavigate();
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

  // Check if skeleton was generated with full context (post world+characters)
  const hasGolden = (() => { try { const g = JSON.parse(novel?.goldenFinger||'{}'); return !!(g.goldenFingerName); } catch { return false; } })();
  const hasChars = (novel?.characters?.length ?? 0) > 0;
  const upstreamReady = hasGolden && hasChars;
  const hasStaleSkeleton = skeleton && skeleton.loops?.length > 0 && !hasChars;

  const volumes = (novel?.volumes ?? []) as Array<{
    id: string; sortOrder: number; title: string; summary?: string | null;
    chapterPlans: Array<{
      id: string; chapterId: string | null; chapterOrder: number; title: string;
      loopPhase?: string | null; chapterType?: string | null;
      chapter?: { id: string; chapterStatus: string } | null;
    }>;
  }>;

  const volumeForLoop = (loopIndex: number) => volumes.find(v => v.sortOrder === loopIndex);

  const [expandError, setExpandError] = useState("");
  const rebalance = useRebalanceVolume();

  // Timeline (moved from PositioningDomain)
  const [timelineItems, setTimelineItems] = useState<Array<{ title: string; category: string; sortOrder: number; status?: string }>>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  useEffect(() => {
    if (novel?.timelineItems) setTimelineItems([...novel.timelineItems].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [novel?.timelineItems]);
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...timelineItems];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    const updated = reordered.map((item, i) => ({ ...item, sortOrder: i + 1 }));
    setTimelineItems(updated); setDragIdx(null);
    updated.forEach(item => { api.patch(`/novels/${novelId}/timeline/${item.title}`, { sortOrder: item.sortOrder }).catch(() => {}); });
  };

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
      {/* Loop Phase Editor */}
      <LoopPhaseEditor novelId={novelId} />

      {/* Generation mode */}
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
            ? "AI 将综合故事核心 + 世界构建 + 角色阵容，分批生成回环骨架并一次性展开为章节（约需 60-120 秒）。"
            : "生成回环骨架总览后，逐卷点击「展开为章节」——每卷约需 10-30 秒，适合精细控制。"}
        </p>
      </section>

      {/* Context availability summary */}
      <div className="flex gap-2 text-[10px]">
        <span className={cn("rounded px-1.5 py-0.5", "bg-emerald-50 text-emerald-600")}>故事核心 ✓</span>
        <span className={cn("rounded px-1.5 py-0.5", hasGolden ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}>金手指 {hasGolden ? "✓" : "✗"}</span>
        <span className={cn("rounded px-1.5 py-0.5", hasChars ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}>角色阵容 {hasChars ? "✓" : "✗"}</span>
      </div>

      {/* Stale skeleton warning */}
      {hasStaleSkeleton && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          ⚠️ 当前回环骨架在角色生成前创建（仅5轮回环，为旧版架构步骤的遗留数据）。建议重新生成以利用完整的角色和世界上下文。
        </div>
      )}

      {/* Generation entry */}
      <div className={cn(
        "rounded-xl border border-dashed py-8 text-center space-y-3",
        upstreamReady ? "border-brand-300 bg-brand-50/30" : "border-slate-300 bg-slate-50/30",
      )}>
        {!upstreamReady ? (
          <>
            <p className="text-sm text-slate-500 font-medium">请先完成前序步骤</p>
            <p className="text-xs text-slate-400">
              生成回环骨架需要：故事核心 + 世界构建（规则/力量/金手指）+ 角色阵容。
              {!hasGolden && " 请先到「世界构建」生成金手指。"}
              {hasGolden && !hasChars && " 请先到「角色阵容」生成角色。"}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-700 font-medium">
              {skeleton?.loops?.length > 0
                ? `已有 ${skeleton.loops.length} 轮回环（预估 ${skeleton.estimatedTotalChapters} 章）。重新生成将覆盖。`
                : "生成回环骨架"}
            </p>
            <p className="text-xs text-brand-500">
              综合 故事核心 + 世界规则 + 力量体系 + 金手指 + {hasChars ? novel?.characters?.length : 0}位角色，分批生成完整回环骨架。
            </p>
            <button
              onClick={genMode === "full" ? handleGenerateAll : async () => {
                setGenerating(true); setGenError("");
                try { await api.post(`/novels/${novelId}/pipeline/step/outline`, { mode: "per_volume", skeletonOnly: true }); refetch(); }
                catch (e) { setGenError(e instanceof Error ? e.message : "生成失败"); }
                finally { setGenerating(false); }
              }}
              disabled={generating || !upstreamReady}
              className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm">
              {generating ? <><RefreshCw size={13} className="animate-spin inline mr-1" />生成中（约30-90秒）…</> :
               <><Sparkles size={13} className="inline mr-1" />{genMode === "full" ? "一键生成全书蓝图" : skeleton?.loops?.length > 0 ? "重新生成回环骨架" : "生成回环骨架"}</>}
            </button>
          </>
        )}
        {/* Chapter info hint */}
        <div className="pt-2 border-t border-brand-200/50">
          <p className="text-[10px] text-brand-400 mb-1.5">展开后每章包含：第N章 · 标题 · 回环阶段 · 章节类型 · 内容节拍 · 核心事件 · 章尾钩子</p>
        </div>
        {genError && <p className="text-xs text-red-500">{genError}</p>}
        {expandError && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-600">{expandError}</div>}
      </div>

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
                <button onClick={async () => { try { const r = await rebalance.mutateAsync({ novelId, sortOrder: vol.sortOrder }); refetch(); } catch {} }}
                  disabled={rebalance.isPending}
                  className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 hover:text-brand-600 hover:border-brand-300 disabled:opacity-50"
                  title="根据已写章节重新平衡后续章节（自动应用调整）">
                  <Scale size={10} />{rebalance.isPending ? "重平衡中..." : "重平衡"}
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

      {/* ── Setting Release Plan (moved from PositioningDomain) ── */}
      {timelineItems.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 mt-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">设定释放计划</h3>
          <div className="space-y-1">
            {timelineItems.filter(t => t.category !== "event").slice(0, 12).map((item, i) => (
              <div key={i} draggable onDragStart={() => handleDragStart(i)} onDragOver={handleDragOver} onDrop={() => handleDrop(i)}
                className={`flex items-center gap-2 rounded bg-slate-50 px-3 py-1.5 text-xs cursor-grab ${dragIdx === i ? "bg-brand-50 border border-brand-200" : ""}`}>
                <GripVertical size={10} className="text-slate-300 shrink-0" />
                <span className={cn("shrink-0 rounded-full w-2 h-2", item.category === "constraint" ? "bg-red-400" : item.category === "milestone" ? "bg-brand-400" : item.category === "deadline" ? "bg-accent-400" : "bg-blue-400")} />
                <span className="font-medium text-slate-600 flex-1 truncate">{item.title}</span>
                <span className="text-slate-400 shrink-0">第{item.sortOrder}章</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Expectation Profile (Step 4: displayed after volume expansion for writing guidance) ── */}
      {(() => {
        const profile = (() => { if (!novel?.expectationProfile) return null; try { return JSON.parse(novel.expectationProfile); } catch { return null; } })();
        if (!profile) return null;
        const recipeAnalogy = (() => {
          if (!profile?.coolPointRecipe) return null;
          const r = profile.coolPointRecipe;
          const dominant = Object.entries(r as Record<string, number>).sort(([, a], [, b]) => (b as number) - (a as number))[0];
          const analogies: Record<string, string> = {
            collect: "类似《不科学御兽》的技能收集快感——每次获得新能力都像解锁图鉴徽章。",
            strategy: "类似《诡秘之主》的策略推演——读者和主角一起分析序列路径、推演敌人弱点。",
            verify: "类似《凡人修仙传》的底牌揭露——每次掀开一张底牌，敌人就绝望一层。",
            reveal: "类似《大奉打更人》的解谜快感——案件背后的大阴谋徐徐展开。",
            upgrade: "类似《赘婿》的文明种田——从个人命运到家国兴亡再到文明方向。",
          };
          return dominant ? analogies[dominant[0]] ?? null : null;
        })();
        return (
          <div className="rounded-lg border border-slate-200 bg-white p-4 mt-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">期待管理</h3>
            <div className="space-y-3 text-xs">
              <div>
                <p className="font-medium text-slate-600 mb-1.5">爽点配方</p>
                {profile.coolPointRecipe ? (
                  <div className="space-y-1">
                    {Object.entries(profile.coolPointRecipe as Record<string, number>).map(([type, pct]) => (
                      <div key={type} className="flex items-center gap-2">
                        <span className="w-12 text-slate-500 shrink-0">{({ collect: "收集", strategy: "策略", verify: "验证", reveal: "揭示", upgrade: "升级" } as Record<string, string>)[type] ?? type}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-brand-400" style={{ width: `${pct}%` }} /></div>
                        <span className="w-10 text-right text-slate-400">{pct}%</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-slate-400">未设置</p>}
                {recipeAnalogy && <p className="text-[10px] text-brand-500 italic mt-1.5 leading-relaxed">{recipeAnalogy}</p>}
              </div>
              {profile.hookProfile && (
                <div>
                  <p className="font-medium text-slate-600 mb-1">钩子密度目标</p>
                  <div className="flex gap-4">
                    <span className="text-slate-500">每章{profile.hookProfile.shortTermPerChapter}个短期钩子</span>
                    <span className="text-slate-500">每卷{profile.hookProfile.mediumTermPerVolume}个中期钩子</span>
                    <span className="text-slate-500">{profile.hookProfile.longTermLines}条长期钩子线</span>
                  </div>
                </div>
              )}
              {profile.payoffWindow && (
                <div>
                  <p className="font-medium text-slate-600 mb-1">伏笔回收窗口</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-accent-400" style={{ width: "100%" }} /></div>
                    <span className="text-slate-500">{profile.payoffWindow}章</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Loop Phase Editor (moved from ArchitectureDomain) ──────

interface PhaseDef {
  phase: string; label: string; description: string; typicalChapterCount: [number, number];
}

// Default phases — used when no user configuration or reference book data
const DEFAULT_PHASES: PhaseDef[] = [
  { phase: "trigger",    label: "触发事件", description: "新副本/任务/危机的引入", typicalChapterCount: [1,3] },
  { phase: "enter",      label: "进入探索", description: "进入新环境，收集线索和资源", typicalChapterCount: [2,5] },
  { phase: "explore",    label: "深入展开", description: "副本内部展开，推进核心探索", typicalChapterCount: [3,6] },
  { phase: "setback",    label: "受挫考验", description: "遭遇重大阻碍或失败", typicalChapterCount: [1,3] },
  { phase: "turn",       label: "转折翻盘", description: "利用资源/信息实现逆转", typicalChapterCount: [1,3] },
  { phase: "climax",     label: "决战高潮", description: "与最大威胁的最终对抗", typicalChapterCount: [1,2] },
  { phase: "settlement", label: "结算收获", description: "成果盘点，暗示下一轮方向", typicalChapterCount: [1,2] },
];

function LoopPhaseEditor({ novelId }: { novelId: string }) {
  const [phases, setPhases] = useState<PhaseDef[]>(DEFAULT_PHASES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loaded) return;
    // Load user-configured phases from DB, or auto-populate from reference book
    api.get(`/novels/${novelId}/loop-definition`).then(async ({ data: loopData }) => {
      if (loopData.data?.phases) {
        setPhases(loopData.data.phases);
      } else {
        // Try to load reference book phases
        try {
          const { data: novelData } = await api.get(`/novels/${novelId}`);
          const activeProfileId = novelData?.data?.activeProfileId;
          if (activeProfileId) {
            const { data: profileData } = await api.get(`/profiles/${activeProfileId}`);
            const raw = profileData?.data?.analysisResult;
            if (raw) {
              const ar = typeof raw === "string" ? JSON.parse(raw) : raw;
              const ap = ar.architecture?.architectureProfile || ar.architectureProfile; // V3+V2 compat
              const refPhases = ap?.loopPhases;
              if (refPhases?.length > 0) {
                setPhases(refPhases.map((p: any) => ({
                  phase: p.phase, label: p.label, description: p.description,
                  typicalChapterCount: p.typicalChapterRange || p.typicalChapterCount || [1,3],
                })));
              }
            }
          }
        } catch { /* use defaults */ }
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [novelId]);

  const updatePhase = (idx: number, field: keyof PhaseDef, value: unknown) =>
    setPhases(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next; });

  const handleSave = async () => {
    setSaving(true); setError("");
    try { await api.put(`/novels/${novelId}/loop-definition`, { phases }); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium text-slate-700">回环阶段</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">自定义每轮回环的阶段顺序。如不编辑则使用通用流程（触发→探索→高潮→结算）。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPhases(prev => [...prev, { phase: `phase_${prev.length+1}`, label: "新阶段", description: "", typicalChapterCount: [1,3] }])}
            className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"><Plus size={11} />新增</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}保存</button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400 flex-1">
          {phases.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{p.label}</span>
              <span className="text-slate-300">({p.typicalChapterCount[0]}-{p.typicalChapterCount[1]}章)</span>
              {i < phases.length - 1 && <span className="text-slate-300">→</span>}
            </span>
          ))}
        </div>
        <span className="shrink-0 text-[9px] text-slate-400">
          {phases === DEFAULT_PHASES ? "（默认流程）" : "（已自定义）"}
        </span>
      </div>
      {/* Editable list */}
      <div className="space-y-1.5">
        {phases.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 p-2 group">
            <div className="flex flex-col shrink-0">
              <button onClick={() => { if (idx>0) setPhases(prev => { const n=[...prev]; [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; return n; }); }} disabled={idx===0} className="text-slate-300 hover:text-slate-500 disabled:opacity-30"><ArrowUp size={10} /></button>
              <button onClick={() => { if (idx<phases.length-1) setPhases(prev => { const n=[...prev]; [n[idx],n[idx+1]]=[n[idx+1],n[idx]]; return n; }); }} disabled={idx===phases.length-1} className="text-slate-300 hover:text-slate-500 disabled:opacity-30"><ArrowDown size={10} /></button>
            </div>
            <input className="w-16 shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 focus:border-brand-300 focus:outline-none" value={p.phase} onChange={e => updatePhase(idx,"phase",e.target.value)} placeholder="key" />
            <input className="w-20 shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 focus:border-brand-300 focus:outline-none" value={p.label} onChange={e => updatePhase(idx,"label",e.target.value)} placeholder="名称" />
            <input className="flex-1 min-w-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 focus:border-brand-300 focus:outline-none" value={p.description} onChange={e => updatePhase(idx,"description",e.target.value)} placeholder="描述" />
            <div className="flex items-center gap-1 shrink-0">
              <input className="w-8 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 focus:border-brand-300 focus:outline-none text-center" type="number" min={1} max={10} value={p.typicalChapterCount[0]} onChange={e => updatePhase(idx,"typicalChapterCount",[parseInt(e.target.value)||1,p.typicalChapterCount[1]])} />
              <span className="text-[10px] text-slate-300">-</span>
              <input className="w-8 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 focus:border-brand-300 focus:outline-none text-center" type="number" min={1} max={30} value={p.typicalChapterCount[1]} onChange={e => updatePhase(idx,"typicalChapterCount",[p.typicalChapterCount[0],parseInt(e.target.value)||3])} />
              <span className="text-[10px] text-slate-400">章</span>
            </div>
            <button onClick={() => setPhases(prev => prev.filter((_,i) => i!==idx))} className="shrink-0 text-slate-300 hover:text-red-500 opacity-60 hover:opacity-100 transition-opacity"><X size={12} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
