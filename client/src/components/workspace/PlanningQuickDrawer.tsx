/**
 * PlanningQuickDrawer — slide-out panel showing planning summary in the writing tab.
 * Allows writers to review story core, loop progress, character states, and pending payoffs
 * without leaving the writing area.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, BookOpen, Users, Target, AlertCircle, Sparkles, ShieldAlert } from "lucide-react";
import { useNovel } from "../../api/novel";
import { api } from "../../app/api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "../../lib/cn";

interface Props { novelId: string; onSwitchToPlanning?: () => void }

export function PlanningQuickDrawer({ novelId, onSwitchToPlanning }: Props) {
  const [open, setOpen] = useState(false);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyField, setEmergencyField] = useState("");
  const [emergencyValue, setEmergencyValue] = useState("");
  const { data: novel, refetch } = useNovel(novelId);
  const qc = useQueryClient();

  const handleEmergencyModify = async () => {
    if (!emergencyField || !emergencyValue.trim()) return;
    try {
      await api.patch(`/novels/${novelId}`, { [emergencyField]: emergencyValue });
      refetch();
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
      setShowEmergencyDialog(false);
      setEmergencyField("");
      setEmergencyValue("");
    } catch {}
  };

  const archLabels: Record<string, string> = {
    skill_slot: "技能栏搭配", sequence_promotion: "序列晋升",
    case_driven: "超凡办案", cultivation_planning: "修真规划",
    hexagon_godhood: "六边形成神", historical_transmigration: "穿越历史",
  };

  const skeleton = (() => {
    if (!novel?.loopSkeleton) return null;
    try { return JSON.parse(novel.loopSkeleton); } catch { return null; }
  })();

  const chapters = novel?.chapters ?? [];
  const completedCount = chapters.filter(c => c.chapterStatus === "completed").length;
  const totalChapters = chapters.length;

  const openPayoffs = (() => {
    // Count payoffs by checking for hook/expectation fields
    return chapters.filter(c => c.hook && c.chapterStatus !== "completed").length;
  })();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 rounded-r-lg border border-l-0 border-brand-200 bg-brand-50 px-1.5 py-4 text-brand-500 hover:bg-brand-100 transition-colors shadow-sm"
        title="查看创作规划"
      >
        <ChevronRight size={14} />
      </button>
    );
  }

  return (
    <div className="fixed left-0 top-0 z-40 h-full w-72 border-r border-slate-200 bg-white shadow-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-brand-500" />
          <h3 className="text-sm font-semibold text-slate-800">创作规划</h3>
        </div>
        <button onClick={() => setOpen(false)}
          className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
        {/* Story Core Summary */}
        {novel?.storySummary && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <Target size={12} className="text-slate-400" />
              <span className="font-medium text-slate-600">故事核心</span>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5 space-y-1">
              <p className="text-slate-600 leading-relaxed line-clamp-3">{novel.storySummary}</p>
              {novel.centralQuestion && (
                <p className="text-slate-500 leading-relaxed text-[11px]">
                  <span className="font-medium text-brand-500">悬念：</span>{novel.centralQuestion.slice(0, 80)}...
                </p>
              )}
            </div>
          </section>
        )}

        {/* Loop Progress */}
        {skeleton && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={12} className="text-brand-400" />
              <span className="font-medium text-slate-600">回环进度</span>
            </div>
            <div className="space-y-1">
              {skeleton.loops?.slice(0, 5).map((loop: { loopIndex: number; dungeonName: string }) => (
                <div key={loop.loopIndex} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1">
                  <span className="rounded bg-brand-100 px-1 py-0 text-[10px] font-medium text-brand-600 shrink-0">
                    #{loop.loopIndex}
                  </span>
                  <span className="text-slate-600 truncate">{loop.dungeonName}</span>
                </div>
              ))}
              {skeleton.loops?.length > 5 && (
                <p className="text-[10px] text-slate-400 pl-2">... 还有 {skeleton.loops.length - 5} 轮回环</p>
              )}
            </div>
          </section>
        )}

        {/* Character Status */}
        {novel?.characters && novel.characters.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <Users size={12} className="text-green-400" />
              <span className="font-medium text-slate-600">角色状态</span>
            </div>
            <div className="space-y-1">
              {novel.characters.slice(0, 6).map(char => (
                <div key={char.id} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1">
                  <span className={cn(
                    "rounded-full w-2 h-2 shrink-0",
                    char.role === "protagonist" ? "bg-blue-400" :
                    char.role === "antagonist" ? "bg-red-400" : "bg-slate-300",
                  )} />
                  <span className="font-medium text-slate-600">{char.name}</span>
                  {char.loopFunctionTag && (
                    <span className="text-[10px] text-slate-400 truncate">· {char.loopFunctionTag}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Progress */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertCircle size={12} className="text-accent-400" />
            <span className="font-medium text-slate-600">写作进度</span>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between mb-1">
              <span className="text-slate-500">完成章节</span>
              <span className="font-bold text-slate-700">{completedCount}/{totalChapters}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: `${totalChapters > 0 ? Math.round(completedCount / totalChapters * 100) : 0}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-slate-400">
              <span>待回收伏笔: ~{openPayoffs}</span>
              <span>{totalChapters > 0 ? Math.round(completedCount / totalChapters * 100) : 0}%</span>
            </div>
          </div>
        </section>

        {/* Architecture + Golden Finger */}
        <section>
          <div className="rounded-lg bg-brand-50/30 border border-brand-100 p-2.5 space-y-1">
            <p className="text-slate-600">
              <span className="text-slate-400">架构：</span>
              <span className="font-medium">{archLabels[novel?.architectureType ?? ""] ?? novel?.architectureType ?? "未选择"}</span>
            </p>
            {novel?.genre && (
              <p className="text-slate-600">
                <span className="text-slate-400">题材：</span>{novel.genre}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Footer — go to planning tab + emergency modify */}
      <div className="shrink-0 border-t border-slate-100 px-4 py-2 space-y-1.5">
        <button onClick={() => { setOpen(false); onSwitchToPlanning?.(); }}
          className="block w-full text-center rounded-lg border bg-slate-800 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-700 rounded-lg">
          切换到规划面板编辑
        </button>
        <button onClick={() => setShowEmergencyDialog(true)}
          className="w-full flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-500 hover:bg-red-100 transition-colors">
          <ShieldAlert size={11} /> 紧急修改
        </button>
      </div>

      {/* Emergency Modification Dialog */}
      {showEmergencyDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-lg" onClick={() => setShowEmergencyDialog(false)}>
          <div className="w-80 rounded-xl bg-white p-4 shadow-xl border border-red-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert size={16} className="text-red-500" />
              <h3 className="text-sm font-semibold text-red-800">紧急修改硬核规则</h3>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              此操作直接修改已锁定的规划参数，可能导致已写作章节与规划不一致。AI 不会自动重写已生成章节。修改后请手动检查受影响章节的连续性。
            </p>
            <div className="space-y-2 mb-3">
              <select value={emergencyField} onChange={e => setEmergencyField(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs focus:border-red-300 focus:outline-none">
                <option value="">选择修改项...</option>
                <option value="architectureType">架构类型</option>
                <option value="centralQuestion">核心悬念</option>
                <option value="endingDirection">结局方向</option>
                <option value="storySummary">故事简介</option>
                <option value="goldenFinger">金手指设定（JSON）</option>
                <option value="expectationProfile">期待管理参数（JSON）</option>
              </select>
              <textarea value={emergencyValue} onChange={e => setEmergencyValue(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs resize-none focus:border-red-300 focus:outline-none"
                rows={3} placeholder="输入新值..." />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowEmergencyDialog(false)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleEmergencyModify} disabled={!emergencyField}
                className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40">
                确认修改（风险自担）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
