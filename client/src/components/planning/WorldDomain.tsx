/**
 * WorldDomain — Step 2: 世界构建
 *
 * Consolidates: architecture selection (template + loop phases + expectation profile) +
 * power system tree + world rules (factions/resources/society/geography/history) +
 * golden finger design.
 *
 * The three sub-concepts are inter-dependent:
 * - Architecture type determines power system shape (sequence tree vs cultivation levels vs skill slots)
 * - World rules define the boundaries within which the golden finger is the "exception"
 * - Golden finger must reference both the power system and world rules to design limits
 */
import { useState, useEffect, useCallback } from "react";
import { Sparkles, Target, Globe, GitBranch } from "lucide-react";
import { useNovel, useUpdateNovel, useGenerateGoldenFinger } from "../../api/novel";
import { cn } from "../../lib/cn";
import { ArchitectureDomain } from "./ArchitectureDomain";
import { WorldPanel } from "./WorldPanel";

interface Props {
  novelId: string;
  onComplete?: () => void;
}

export function WorldDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
  const genGoldenFinger = useGenerateGoldenFinger();

  const [tab, setTab] = useState<"architecture" | "world" | "golden">("architecture");

  // ── Golden Finger (moved from FoundationDomain) ──
  const [gfName, setGfName] = useState("");
  const [gfAbilities, setGfAbilities] = useState("");
  const [gfLimits, setGfLimits] = useState("");

  useEffect(() => {
    if (novel?.goldenFinger) {
      try {
        const gf = JSON.parse(novel.goldenFinger);
        if (gf.goldenFingerName) setGfName(gf.goldenFingerName);
        if (Array.isArray(gf.abilities)) setGfAbilities(gf.abilities.join("\n"));
        if (Array.isArray(gf.limits)) setGfLimits(gf.limits.join("\n"));
      } catch {}
    }
  }, [novel?.goldenFinger]);

  const handleSaveGoldenFinger = useCallback(async () => {
    const gf = JSON.stringify({
      goldenFingerName: gfName,
      abilities: gfAbilities.split("\n").filter(Boolean),
      limits: gfLimits.split("\n").filter(Boolean),
    });
    await updateNovel.mutateAsync({ id: novelId, goldenFinger: gf });
    refetch();
  }, [novelId, gfName, gfAbilities, gfLimits, updateNovel, refetch]);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-slate-100 pb-2">
        {([
          { id: "architecture" as const, label: "架构选择", icon: GitBranch, hint: "选模板 · 回环阶段 · 期待参数" },
          { id: "world" as const, label: "世界规则", icon: Globe, hint: "势力格局 · 力量体系 · 资源社会 · 树状视图" },
          { id: "golden" as const, label: "金手指", icon: Target, hint: "能力设计 · 限制边界" },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "architecture" && (
        <ArchitectureDomain novelId={novelId} onComplete={onComplete} />
      )}

      {tab === "world" && (
        <WorldPanel novelId={novelId} />
      )}

      {tab === "golden" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">金手指是主角在力量体系中的「例外」——设计时必须参照左侧架构选择中的力量体系类型和世界规则中的约束边界。</p>
            <button onClick={async () => {
              try { const result = await genGoldenFinger.mutateAsync(novelId); setGfName(result.goldenFingerName); setGfAbilities(result.abilities.join("\n")); setGfLimits(result.limits.join("\n")); refetch(); } catch {}
            }} disabled={genGoldenFinger.isPending}
              className="flex items-center gap-1 shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
              <Sparkles size={11} />{genGoldenFinger.isPending ? "生成中…" : "AI 生成金手指"}
            </button>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-slate-400">名称</label>
              <input value={gfName} onChange={e => setGfName(e.target.value)}
                placeholder="如：技能图鉴、副本模拟器、古神血脉"
                className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-brand-300 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">能力（一行一条）</label>
              <textarea value={gfAbilities} onChange={e => setGfAbilities(e.target.value)}
                className="w-full min-h-[60px] rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={3} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400">限制（一行一条）</label>
              <textarea value={gfLimits} onChange={e => setGfLimits(e.target.value)}
                className="w-full min-h-[60px] rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={3} />
            </div>
            <button onClick={handleSaveGoldenFinger}
              className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
              保存金手指设定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
