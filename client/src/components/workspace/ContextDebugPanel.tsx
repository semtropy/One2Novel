import { useState } from "react";
import { Bug, X, Layers } from "lucide-react";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string; chapterId: string | null }

interface BlockInfo { id: string; group: string; priority: number; required: boolean; contentPreview: string }

// Tier definitions for visualization
const TIER_GROUPS: Record<string, { tier: number; label: string; color: string }> = {
  book_contract: { tier: 0, label: "硬核规则", color: "border-l-red-400 bg-red-50/30" },
  character_hard_facts: { tier: 0, label: "硬核规则", color: "border-l-red-400 bg-red-50/30" },
  style_contract: { tier: 0, label: "硬核规则", color: "border-l-red-400 bg-red-50/30" },
  chapter_mission: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  payoff_directives: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  character_dynamics: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  open_conflicts: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  recent_chapters: { tier: 2, label: "压缩记忆", color: "border-l-green-400 bg-green-50/30" },
  recent_skeleton: { tier: 2, label: "压缩记忆", color: "border-l-green-400 bg-green-50/30" },
  volume_summary: { tier: 2, label: "压缩记忆", color: "border-l-green-400 bg-green-50/30" },
  volume_archive: { tier: 2, label: "压缩记忆", color: "border-l-green-400 bg-green-50/30" },
  previous_chapter_hook: { tier: 3, label: "邻近原文", color: "border-l-amber-400 bg-amber-50/30" },
  story_macro: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  volume_window: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  timeline: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
  world_rules: { tier: 0, label: "硬核规则", color: "border-l-red-400 bg-red-50/30" },
  scene_plan: { tier: 1, label: "当前状态", color: "border-l-blue-400 bg-blue-50/30" },
};

const TIER_LABELS = [
  { tier: 0, label: "硬核规则层", desc: "全书不变的基础约束（故事核心、角色设定、世界规则、风格）" },
  { tier: 1, label: "当前状态层", desc: "本章的动态约束（章节任务、伏笔状态、角色调度、冲突状态）" },
  { tier: 2, label: "分层压缩层", desc: "前文的多层摘要（邻近详细→骨架→卷摘要→归档）" },
  { tier: 3, label: "邻近原文层", desc: "上一章结尾原文，确保连贯衔接" },
];

export function ContextDebugPanel({ novelId, chapterId }: Props) {
  const [show, setShow] = useState(false);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedTier, setExpandedTier] = useState<number | null>(null);

  async function load() {
    if (!chapterId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/novels/${novelId}/chapters/${chapterId}/context-preview`);
      setBlocks(data.data?.blocks ?? []);
      setShow(true);
    } catch {} finally { setLoading(false); }
  }

  if (!chapterId) return null;

  // Group blocks by tier
  const tieredBlocks: Record<number, BlockInfo[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (const b of blocks) {
    const tierInfo = TIER_GROUPS[b.group] ?? { tier: -1, label: "其他", color: "border-l-slate-400 bg-slate-50/30" };
    const tier = tierInfo.tier;
    if (!tieredBlocks[tier]) tieredBlocks[tier] = [];
    tieredBlocks[tier].push(b);
  }

  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const totalChars = blocks.reduce((s, b) => s + (b.contentPreview?.length ?? 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return (
    <>
      <button onClick={load} disabled={loading}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
        title="查看AI写作时使用的完整上下文 — 按四层架构分类">
        <Layers size={11} />{loading ? "加载中..." : "上下文"}
      </button>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShow(false)}>
          <div className="w-[44rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">AI 上下文装配 ({blocks.length} 块)</h3>
                <p className="text-[10px] text-slate-400">四层架构 · 估算 {estimatedTokens.toLocaleString()} tokens</p>
              </div>
              <button onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            {/* Tier summary bar */}
            <div className="flex gap-2 mb-4">
              {TIER_LABELS.map(({ tier, label }) => {
                const count = tieredBlocks[tier]?.length ?? 0;
                return (
                  <button key={tier} onClick={() => setExpandedTier(expandedTier === tier ? null : tier)}
                    className="flex-1 rounded-lg border border-slate-200 p-2 text-center text-xs hover:bg-slate-50 transition-colors">
                    <div className={cn(
                      "font-medium mb-0.5",
                      tier === 0 ? "text-red-600" : tier === 1 ? "text-blue-600" :
                      tier === 2 ? "text-green-600" : "text-amber-600",
                    )}>
                      {label}
                    </div>
                    <div className="text-slate-400">{count}块</div>
                  </button>
                );
              })}
            </div>

            {/* Block list — group by tier */}
            {TIER_LABELS.map(({ tier, label, desc }) => {
              const tierBlocks = tieredBlocks[tier] ?? [];
              if (tierBlocks.length === 0) return null;
              const isExpanded = expandedTier === tier || expandedTier === null;
              return (
                <div key={tier} className="mb-3">
                  <button onClick={() => setExpandedTier(expandedTier === tier ? null : tier)}
                    className="flex items-center gap-2 w-full text-left py-1 text-xs font-medium text-slate-600">
                    <span>{label}</span>
                    <span className="text-slate-400 font-normal">({tierBlocks.length}块 · {desc})</span>
                  </button>
                  {isExpanded && (
                    <div className="space-y-1.5 mt-1">
                      {tierBlocks.map(b => (
                        <div key={b.id} className={`rounded border border-slate-100 p-2 ${TIER_GROUPS[b.group]?.color ?? "border-l-slate-400"} border-l-2`}>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium text-slate-700">{b.group}</span>
                            <span className="text-[10px] text-slate-400">P{b.priority}</span>
                            {b.required && <span className="rounded bg-red-50 px-1 text-[10px] text-red-500">必选</span>}
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2">{b.contentPreview || "（空）"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
