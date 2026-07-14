/**
 * WorldDomain — Step 2: 世界构建
 *
 * Four tabs: Reference Book → World Rules → Power System → Golden Finger
 * "AI 生成世界框架" generates rules + power + golden finger in serial pipeline.
 * Reference book analysis results automatically inject into all downstream AI calls.
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Target, Globe, BookOpen, Zap, Check } from "lucide-react";
import { useNovel, useUpdateNovel } from "../../api/novel";
import { useGenerateGoldenFinger } from "../../api/story-core";
import { useWorldRules } from "../../api/world";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";
import { WorldPanel } from "./WorldPanel";
import { PowerSystemTree, type PowerNode } from "../pipeline/PowerSystemTree";

interface Props {
  novelId: string;
  onComplete?: () => void;
}

type StepId = "reference" | "world" | "power" | "golden";

interface ProfileItem {
  id: string; name: string; createdAt: string;
}

export function WorldDomain({ novelId, onComplete }: Props) {
  const navigate = useNavigate();
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
  const genGoldenFinger = useGenerateGoldenFinger();
  const { data: worldRules } = useWorldRules(novelId);

  const [activeStep, setActiveStep] = useState<StepId>("reference");

  // Completion status
  const hasProfile = !!(novel?.activeProfileId);
  const worldDone = (worldRules?.filter(r => r.status === "active").length ?? 0) > 0;
  const powerDone = !!(novel?.powerSystemTree);
  const goldenDone = (() => {
    if (!novel?.goldenFinger) return false;
    try { const gf = JSON.parse(novel.goldenFinger); return !!(gf.goldenFingerName && gf.abilities?.length > 0); } catch { return false; }
  })();
  const doneCount = [hasProfile, worldDone, powerDone, goldenDone].filter(Boolean).length;

  // Reference profiles
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  useEffect(() => {
    api.get("/profiles").then(({ data }) => { if (data.data) setProfiles(data.data); }).catch(() => {});
  }, [novelId]);

  const [selectingProfile, setSelectingProfile] = useState(false);
  const handleSelectProfile = async (profile: ProfileItem) => {
    setSelectingProfile(true); setSaveError("");
    try {
      await api.put(`/${novelId}/active-profile`, { profileId: profile.id });
      await refetch();
    } catch { setSaveError("选择失败，请重试"); }
    finally { setSelectingProfile(false); }
  };

  // Power System Tree
  const [powerNodes, setPowerNodes] = useState<PowerNode[]>([]);
  const [powerGenPending, setPowerGenPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (novel?.powerSystemTree) {
      try { const tree = JSON.parse(novel.powerSystemTree); if (Array.isArray(tree)) setPowerNodes(tree); } catch {}
    }
  }, [novel?.powerSystemTree]);

  useEffect(() => {
    if (powerNodes.length === 0) return;
    const timer = setTimeout(async () => {
      if (!mountedRef.current) return;
      try { await updateNovel.mutateAsync({ id: novelId, powerSystemTree: JSON.stringify(powerNodes) }); } catch {}
    }, 800);
    return () => clearTimeout(timer);
  }, [powerNodes, novelId, updateNovel]);

  const handleGeneratePowerSystem = async () => {
    setPowerGenPending(true); setSaveError("");
    try { const { data } = await api.post(`/novels/${novelId}/power-system/generate`); if (data?.data) { setPowerNodes(data.data); refetch(); } }
    catch { setSaveError("生成失败，请重试"); } finally { setPowerGenPending(false); }
  };

  // Golden Finger
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

  const [genAllPending, setGenAllPending] = useState(false);

  const handleGenerateAllWorld = async () => {
    setGenAllPending(true); setSaveError("");
    try { await api.post(`/novels/${novelId}/generate-world-framework`); refetch(); }
    catch { setSaveError("生成失败，请重试"); }
    finally { setGenAllPending(false); }
  };

  const STEPS = [
    { id: "reference" as const, index: 1, label: "参考书", icon: BookOpen, done: hasProfile, hint: "上传参考书进行深度分析，分析结果自动注入后续生成" },
    { id: "world" as const,     index: 2, label: "世界规则", icon: Globe,   done: worldDone,  hint: "六大分类：势力格局 · 力量规则 · 资源社会 · 地理历史" },
    { id: "power" as const,     index: 3, label: "力量体系", icon: Zap,     done: powerDone,  hint: "境界序列树 · AI 生成 · 手动编辑等级" },
    { id: "golden" as const,    index: 4, label: "金手指",   icon: Target,  done: goldenDone, hint: "主角在规则中的例外 · 能力设计 · 限制边界" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">世界构建</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {doneCount === 4 ? "✅ 全部完成" : `已完成 ${doneCount}/4 项`}
            </p>
          </div>
          <button onClick={handleGenerateAllWorld} disabled={genAllPending}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 shadow-sm",
              doneCount >= 2 ? "border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100" : "bg-slate-900 text-white hover:bg-slate-800")}>
            <Sparkles size={15} className={genAllPending ? "animate-spin" : ""} />
            {genAllPending ? "生成中（约需30-60秒）…" : "AI 生成世界框架（规则 → 力量 → 金手指）"}
          </button>
        </div>
        {saveError && <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-600">{saveError}</div>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {STEPS.map(({ id, index, label, icon: Icon, done, hint }) => (
          <button key={id} onClick={() => setActiveStep(id)} title={hint}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all flex-1 justify-center",
              activeStep === id ? "bg-slate-900 text-white shadow-sm" :
              done ? "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100" :
              "bg-white border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700")}>
            <span className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              activeStep === id ? "bg-white/20 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500")}>
              {done ? <Check size={10} /> : index}
            </span>
            <Icon size={11} className="hidden sm:block" />{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeStep === "reference" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">参考书蓝图</h3>
          <p className="text-xs text-slate-400 mb-4">上传对标网络小说，AI 将深度分析其结构（回环/节奏/金手指/写法），分析结果自动注入后续所有生成步骤。</p>
          {profiles.length > 0 ? (
            <div className="grid grid-cols-3 gap-2.5">
              {profiles.map(p => {
                const isActive = novel?.activeProfileId === p.id;
                return (
                  <button key={p.id} onClick={() => handleSelectProfile(p)} disabled={selectingProfile}
                    className={cn("rounded-xl border text-left transition-all p-3",
                      isActive ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200" : "border-slate-200 bg-white hover:border-slate-300",
                      selectingProfile && "opacity-50")}>
                    <span className={cn("text-[10px] rounded px-1.5 py-0.5", isActive ? "bg-emerald-100 text-emerald-700" : "bg-brand-100 text-brand-700")}>参考书</span>
                    <div className="text-sm font-semibold text-slate-700 mt-1 truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{new Date(p.createdAt).toLocaleDateString("zh-CN")} 分析</div>
                    {isActive && <div className="text-xs text-emerald-600 mt-1.5 font-semibold">✓ 已选为当前蓝图</div>}
                    {selectingProfile && <div className="text-[10px] text-brand-500 mt-1">设置中…</div>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center">
              <BookOpen size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-xs text-slate-400 mb-3">尚未上传参考书。上传后 AI 自动分析结构数据。</p>
              <button onClick={() => navigate("/reference-profiles/new")}
                className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
                上传参考书
              </button>
            </div>
          )}
        </section>
      )}

      {activeStep === "world" && <WorldPanel novelId={novelId} />}

      {activeStep === "power" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">参考书分析数据将自动注入 AI 生成。可手动编辑。</p>
            <button onClick={handleGeneratePowerSystem} disabled={powerGenPending}
              className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
              <Sparkles size={11} />{powerGenPending ? "生成中…" : "AI 生成"}
            </button>
          </div>
          {powerNodes.length > 0 ? (
            <PowerSystemTree nodes={powerNodes} onChange={setPowerNodes} />
          ) : (
            <div className="py-12 text-center">
              <Zap size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-xs text-slate-400">点击「AI 生成」根据故事核心和参考书数据自动设计境界树</p>
            </div>
          )}
        </div>
      )}

      {activeStep === "golden" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">金手指是主角在世界规则和力量体系中的例外。参考书分析数据自动注入。</p>
            <button onClick={async () => {
              try { const result = await genGoldenFinger.mutateAsync(novelId); setGfName(result.goldenFingerName); setGfAbilities(result.abilities.join("\n")); setGfLimits(result.limits.join("\n")); refetch(); setSaveError(""); }
              catch { setSaveError("金手指生成失败"); }
            }} disabled={genGoldenFinger.isPending}
              className="flex items-center gap-1 shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
              <Sparkles size={11} />{genGoldenFinger.isPending ? "生成中…" : "AI 生成金手指"}
            </button>
          </div>
          <div className="space-y-2">
            <div><label className="text-[10px] text-slate-400">名称</label>
              <input value={gfName} onChange={e => setGfName(e.target.value)}
                onBlur={() => { const gf = JSON.stringify({ goldenFingerName: gfName, abilities: gfAbilities.split("\n").filter(Boolean), limits: gfLimits.split("\n").filter(Boolean) }); updateNovel.mutate({ id: novelId, goldenFinger: gf }); refetch(); }}
                placeholder="如：基因编辑终端、模拟副本系统" className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-brand-300 focus:outline-none" /></div>
            <div><label className="text-[10px] text-slate-400">能力（一行一条）</label>
              <textarea value={gfAbilities} onChange={e => setGfAbilities(e.target.value)}
                onBlur={() => { const gf = JSON.stringify({ goldenFingerName: gfName, abilities: gfAbilities.split("\n").filter(Boolean), limits: gfLimits.split("\n").filter(Boolean) }); updateNovel.mutate({ id: novelId, goldenFinger: gf }); refetch(); }}
                className="w-full min-h-[60px] rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={3} /></div>
            <div><label className="text-[10px] text-slate-400">限制（一行一条）</label>
              <textarea value={gfLimits} onChange={e => setGfLimits(e.target.value)}
                onBlur={() => { const gf = JSON.stringify({ goldenFingerName: gfName, abilities: gfAbilities.split("\n").filter(Boolean), limits: gfLimits.split("\n").filter(Boolean) }); updateNovel.mutate({ id: novelId, goldenFinger: gf }); refetch(); }}
                className="w-full min-h-[60px] rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={3} /></div>
            <p className="text-[10px] text-slate-400">失焦自动保存</p>
          </div>
        </div>
      )}
    </div>
  );
}
