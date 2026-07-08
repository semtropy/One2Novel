/**
 * CharacterPanel — 角色动态（含资源详情弹窗）
 * Extracted from ContextPanel.tsx
 */
import { useState } from "react";
import { useNovel } from "../../api/novel";
import { useResources as useCharacterResources } from "../../api/characters";
import { cn } from "../../lib/cn";

export function CharacterPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { data: novel } = useNovel(novelId);
  const chars = novel?.characters ?? [];
  const active = chars.filter(c => c.currentStatus || c.currentGoal);
  const [detailCharId, setDetailCharId] = useState<string | null>(null);
  const { data: resources } = useCharacterResources(novelId, detailCharId ?? undefined);
  const ROLE_LABEL: Record<string, string> = { protagonist: "主角", antagonist: "对手", supporting: "配角", minor: "次要" };

  return (
    <div className="space-y-2 text-xs">
      {active.length > 0 ? (
        <>
          {active.slice(0, 10).map(c => (
            <div key={c.id} className="rounded border border-slate-200 p-2 cursor-pointer hover:bg-slate-50" onClick={() => setDetailCharId(detailCharId === c.id ? null : c.id)}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">{c.name} · {ROLE_LABEL[c.role] ?? c.role}</span>
                {c.currentStatus && <span className="text-[10px] text-slate-400">{c.currentStatus}</span>}
              </div>
              {c.currentGoal && <div className="text-slate-500 mt-0.5">目标：{c.currentGoal}</div>}
              {detailCharId === c.id && (
                <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                  {c.identityLabel && <div className="text-slate-400">身份：{c.identityLabel}{c.factionLabel ? ` · ${c.factionLabel}` : ""}</div>}
                  {c.currentLocation && <div className="text-slate-400">位置：{c.currentLocation}</div>}
                  {c.voiceTexture && <div className="text-slate-400 italic">声线：{c.voiceTexture}</div>}
                  <div className="text-slate-400">
                    资源：{(resources ?? []).length > 0 ? (resources ?? []).map(r => <span key={r.id} className={cn("mr-1 px-1 py-0.5 rounded text-[10px]", r.status === "depleted" ? "bg-slate-100 text-slate-300 line-through" : "bg-slate-100 text-slate-600")}>{r.name}</span>) : <span className="text-slate-300 italic">暂无</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      ) : <p className="text-slate-400 italic">写完章节后自动更新角色状态</p>}
    </div>
  );
}
