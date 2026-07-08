/**
 * ContextPanel — 右侧工具箱，九宫格卡片按钮 + 弹窗面板
 */
import { useState } from "react";
import {
  Users, History, ClipboardList, Eye, Target, FileText, BarChart3,
  X, Gauge, Clock,
} from "lucide-react";
import { useNovel } from "../../api/novel";
import { type WorkspaceDiagnosis } from "../../api/revision";
import { StatisticsDashboard } from "./StatisticsDashboard";
import { WritingDashboard } from "./WritingDashboard";
import { ChapterDiffModal } from "./ChapterDiffModal";
import { SceneCardPanel } from "./SceneCardPanel";
import { StylePanel } from "./StylePanel";
import { PayoffPanel } from "./PayoffPanel";
import { CharacterPanel } from "./CharacterPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ReviewPanel } from "./ReviewPanel";

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
      <div className="flex flex-col gap-1.5">
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
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">写作仪表盘</h3><button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button></div>
            <WritingDashboard novelId={p.novelId} chapterId={p.chapterId} />
          </div>
        </div>
      )}
      {active === "history" && p.chapterId && <ChapterDiffModal novelId={p.novelId} chapterId={p.chapterId} onClose={() => setActive(null)} />}

      {/* Generic modal for other panels */}
      {active && p.chapterId && !["stats", "dashboard", "history"].includes(active) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActive(null)}>
          <div className="w-[36rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">{PANELS.find(x => x.key === active)?.label}</h3><button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button></div>
            {active === "style" && <StylePanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "payoff" && <PayoffPanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "scene" && <SceneCardPanel novelId={p.novelId} chapterId={p.chapterId ?? undefined} />}
            {active === "character" && <CharacterPanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "timeline" && <TimelinePanel novelId={p.novelId} chapterId={p.chapterId} chapterOrder={p.chapterOrder} />}
            {active === "review" && <ReviewPanel novelId={p.novelId} chapterId={p.chapterId} quality={p.quality} diagnosis={p.diagnosis} reviewing={p.reviewing} onReview={p.onReview} />}
          </div>
        </div>
      )}
    </div>
  );
}
