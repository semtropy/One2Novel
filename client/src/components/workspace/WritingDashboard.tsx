/**
 * WritingDashboard — unified writing rhythm and health dashboard.
 * Merges RhythmPanel + ExpectationDashboard + WritingAlerts into tabs:
 *   爽点节奏 / 钩子健康 / 写作提醒 / 角色状态
 */
import { useState, useMemo } from "react";
import { Zap, Target, AlertTriangle, Users } from "lucide-react";
import { cn } from "../../lib/cn";
import { useNovel, useCoolPointStatus, useHookDensity, useVolumeRhythmReport, useHookCheck, useLongAbsentCharacters } from "../../api/novel";

interface Props {
  novelId: string;
  chapterId: string | null;
}

const TABS = [
  { key: "rhythm", label: "爽点节奏", icon: Zap },
  { key: "hooks", label: "钩子健康", icon: Target },
  { key: "alerts", label: "写作提醒", icon: AlertTriangle },
  { key: "chars", label: "角色状态", icon: Users },
] as const;

const COOL_POINT_LABELS: Record<string, string> = {
  collect: "收集", strategy: "策略", verify: "验证", reveal: "揭示", upgrade: "升级", face_slap: "打脸",
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "text-red-600 bg-red-50 border-red-200",
  medium: "text-accent-600 bg-accent-50 border-accent-200",
  low: "text-slate-500 bg-slate-50 border-slate-200",
};

export function WritingDashboard({ novelId, chapterId }: Props) {
  const [activeTab, setActiveTab] = useState<string>("rhythm");
  const { data: novel } = useNovel(novelId);

  const currentVolumeOrder = useMemo(() => {
    if (!novel?.volumes || !chapterId) return undefined;
    for (const vol of novel.volumes) {
      if (vol.chapterPlans.some(cp => cp.chapterId === chapterId || cp.chapter?.id === chapterId)) {
        return vol.sortOrder;
      }
    }
    return undefined;
  }, [novel, chapterId]);

  const { data: coolPointStatus } = useCoolPointStatus(novelId, currentVolumeOrder);
  const { data: hookDensity } = useHookDensity(novelId, currentVolumeOrder);
  const { data: rhythmReport } = useVolumeRhythmReport(novelId, currentVolumeOrder);
  const { data: hookCheck } = useHookCheck(novelId, chapterId ?? undefined);
  const { data: longAbsent } = useLongAbsentCharacters(novelId);

  const loopProgress = useMemo(() => {
    if (!novel?.volumes) return null;
    const total = novel.volumes.length;
    const completed = novel.volumes.filter(v =>
      v.chapterPlans.length > 0 && v.chapterPlans.every(cp => cp.chapter?.chapterStatus === "completed")
    ).length;
    return { completed, total, current: currentVolumeOrder };
  }, [novel, currentVolumeOrder]);

  const allAlerts = [
    ...(coolPointStatus?.alerts ?? []),
    ...(rhythmReport?.violations.map(v => ({ type: v.category, severity: v.severity, message: v.description, chaptersSince: 0 })) ?? []),
  ];

  return (
    <div className="space-y-3 text-xs">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-100 pb-2">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "bg-brand-50 text-brand-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
            )}
          >
            <tab.icon size={11} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: 爽点节奏 */}
      {activeTab === "rhythm" && (
        <div className="space-y-3">
          {/* Loop Progress */}
          {loopProgress && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-400 mb-1">回环进度</div>
              <div className="flex items-center gap-1">
                {Array.from({ length: loopProgress.total }, (_, i) => (
                  <div key={i} className={cn(
                    "w-4 h-4 rounded-full flex items-center justify-center text-xs",
                    i < loopProgress.completed ? "bg-green-100 text-green-600" :
                    i === (loopProgress.current ?? -1) - 1 ? "bg-brand-100 text-brand-600 ring-1 ring-brand-300" :
                    "bg-slate-100 text-slate-300"
                  )}>
                    {i < loopProgress.completed ? "✓" : i + 1}
                  </div>
                ))}
              </div>
              <div className="text-slate-400 mt-1">{loopProgress.completed}/{loopProgress.total} 卷完成</div>
            </div>
          )}

          {/* Cool Point Status */}
          {coolPointStatus && coolPointStatus.breakdown.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-400 mb-1">爽点分布</div>
              <div className="space-y-1">
                {coolPointStatus.breakdown.map(b => (
                  <div key={b.type} className="flex items-center justify-between">
                    <span className="text-slate-600">{COOL_POINT_LABELS[b.type] ?? b.type}</span>
                    <span className={cn("text-xs", b.gap === "✓" ? "text-green-500" : "text-accent-500")}>
                      {b.actual}/{b.target} {b.gap}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!coolPointStatus && !loopProgress && (
            <p className="text-slate-400 text-center py-4">展开章节并完成写作后显示节奏数据</p>
          )}
        </div>
      )}

      {/* Tab: 钩子健康 */}
      {activeTab === "hooks" && (
        <div className="space-y-3">
          {hookDensity && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-400 mb-1">钩子密度</div>
              <div className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                hookDensity.verdict === "good" ? "bg-green-50 text-green-600" :
                hookDensity.verdict === "acceptable" ? "bg-accent-50 text-accent-600" :
                "bg-red-50 text-red-600"
              )}>
                {hookDensity.verdict === "good" ? "✓ 良好" : hookDensity.verdict === "acceptable" ? "⚠ 可接受" : "✗ 需改进"}
              </div>
              {hookDensity.verdict !== "good" && (
                <div className="text-slate-500 mt-1">{hookDensity.suggestion}</div>
              )}
            </div>
          )}

          {hookCheck && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="text-slate-400 mb-1">本章钩子</div>
              <div className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                hookCheck.hookQuality === "strong" ? "bg-green-50 text-green-600" :
                hookCheck.hookQuality === "adequate" ? "bg-blue-50 text-blue-600" :
                hookCheck.hookQuality === "weak" ? "bg-accent-50 text-accent-600" :
                "bg-red-50 text-red-600"
              )}>
                {hookCheck.hookQuality === "strong" ? "✓ 强钩子" :
                 hookCheck.hookQuality === "adequate" ? "○ 可接受" :
                 hookCheck.hookQuality === "weak" ? "⚠ 弱钩子" : "✗ 无钩子"}
              </div>
              {hookCheck.issue && <div className="text-xs text-slate-500 mt-1">{hookCheck.issue}</div>}
            </div>
          )}
          {!hookDensity && !hookCheck && (
            <p className="text-slate-400 text-center py-4">完成章节后显示钩子数据</p>
          )}
        </div>
      )}

      {/* Tab: 写作提醒 */}
      {activeTab === "alerts" && (
        <div className="space-y-2">
          {allAlerts.length > 0 ? (
            allAlerts.slice(0, 10).map((alert, i) => (
              <div key={i} className={cn(
                "rounded border p-2 flex items-start gap-1.5",
                SEVERITY_STYLE[alert.severity] ?? "bg-slate-50 border-slate-200",
              )}>
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>{alert.message}</span>
              </div>
            ))
          ) : (
            <p className="text-slate-400 text-center py-4">暂无写作提醒</p>
          )}
        </div>
      )}

      {/* Tab: 角色状态 */}
      {activeTab === "chars" && (
        <div className="space-y-3">
          {longAbsent && longAbsent.length > 0 && (
            <div className="rounded-lg border border-accent-200 bg-accent-50/50 p-2.5">
              <div className="flex items-center gap-1 text-xs text-accent-600 mb-1">
                <Users size={10} /> 角色缺席提醒
              </div>
              {longAbsent.slice(0, 5).map(c => (
                <div key={c.characterId} className="text-xs text-accent-700">
                   「{c.characterName}」已 {c.chaptersSinceLastAppearance} 章未出场
                </div>
              ))}
            </div>
          )}
          {(!longAbsent || longAbsent.length === 0) && (
            <p className="text-slate-400 text-center py-4">所有角色状态正常</p>
          )}
        </div>
      )}
    </div>
  );
}
