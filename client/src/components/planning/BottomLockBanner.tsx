import { CheckCircle, PenLine, AlertTriangle } from "lucide-react";
import { useConfirmationStatus, useConfirmAllScopes } from "../../api/novel";

interface Props { novelId: string; onStartWriting: () => void }

const SCOPE_LABELS: Record<string, string> = {
  story_seed: "故事核心", characters: "角色阵容", blueprint: "章节蓝图",
};

export function BottomLockBanner({ novelId, onStartWriting }: Props) {
  const { data: status } = useConfirmationStatus(novelId);
  const confirmAll = useConfirmAllScopes();

  if (!status) return null;

  // Count dirty scopes
  const dirtyScopes = (["story_seed", "characters", "blueprint"] as const)
    .filter(s => status[s].dirty && status[s].dirtyCount > 0);
  const allClean = dirtyScopes.length === 0;
  const allConfirmed = status.story_seed.confirmed && status.characters.confirmed && status.blueprint.confirmed;

  const doConfirm = (mode: "replace" | "merge") => confirmAll.mutate({ novelId, mode });

  return (
    <div className="sticky bottom-0 bg-white border-t border-slate-200 pt-3 pb-2">
      {allConfirmed && allClean ? (
        /* All confirmed and clean */
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-green-600">
            <CheckCircle size={13} />
            {SCOPE_LABELS["story_seed"]} · {SCOPE_LABELS["characters"]} · {SCOPE_LABELS["blueprint"]} 已确认
          </div>
          <button onClick={onStartWriting}
            className="rounded-xl bg-slate-800 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-700 shadow-lg transition-all flex items-center gap-2">
            开始写作 <PenLine size={15} />
          </button>
        </div>
      ) : dirtyScopes.length > 0 ? (
        /* Has dirty changes — offer replace vs merge */
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs text-amber-600">
            <AlertTriangle size={13} />
            <span>
              有未同步变更：{dirtyScopes.map(s => `${SCOPE_LABELS[s] ?? s}（${status[s].dirtyCount}处）`).join("、")}
            </span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => doConfirm("replace")} disabled={confirmAll.isPending}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
              title="删除写作区旧章节，用当前草稿完全替换">
              {confirmAll.isPending ? "同步中..." : "覆盖同步"}
            </button>
            <button onClick={() => doConfirm("merge")} disabled={confirmAll.isPending}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-600 hover:bg-blue-100"
              title="保留写作区已有章节，仅新增或更新草稿中的章节">
              {confirmAll.isPending ? "同步中..." : "合并同步"}
            </button>
            <button onClick={onStartWriting}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1.5">
              跳过，开始写作 <PenLine size={12} />
            </button>
          </div>
        </div>
      ) : (
        /* First time — nothing confirmed yet, default to replace */
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>待确认：{(["story_seed", "characters", "blueprint"] as const)
              .filter(s => !status[s].confirmed)
              .map(s => SCOPE_LABELS[s] ?? s).join("、")}</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => doConfirm("replace")} disabled={confirmAll.isPending}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100">
              {confirmAll.isPending ? "确认中..." : "确认全部，开始写作"}
            </button>
            <button onClick={onStartWriting}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1.5">
              先开始写，后续再完善 <PenLine size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
