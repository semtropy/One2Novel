/**
 * ArchitectureDomain — 长篇架构决策域（统一视图）
 * 内置架构模板 + 参考书分析结果 → 同一组可选架构卡片 → 回环阶段编辑器（默认展开）
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowUp, ArrowDown, Plus, X, Save, RefreshCw, CheckCircle, GitBranch, BookOpen, ArrowRight } from "lucide-react";
import { useNovel, useUpdateNovel } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string; onComplete?: () => void }

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};

interface PhaseDef {
  phase: string; label: string; description: string; typicalChapterCount: [number, number];
}

interface ProfileItem {
  id: string; name: string; createdAt: string;
}

export function ArchitectureDomain({ novelId, onComplete }: Props) {
  const navigate = useNavigate();
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();

  const [selectedArch, setSelectedArch] = useState(novel?.architectureType ?? "");
  const [selectedProfileId, setSelectedProfileId] = useState(novel?.activeProfileId ?? "");

  // Loop phase editor
  const [phases, setPhases] = useState<PhaseDef[]>([]);
  const [phasesLoaded, setPhasesLoaded] = useState(false);
  const [savingPhases, setSavingPhases] = useState(false);
  const [phaseError, setPhaseError] = useState("");

  // Reference profiles
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);

  // Confirm button state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Init from novel
  useEffect(() => { if (novel?.architectureType && !selectedArch) setSelectedArch(novel.architectureType); }, [novel?.architectureType]);
  useEffect(() => { if (novel?.activeProfileId) setSelectedProfileId(novel.activeProfileId); }, [novel?.activeProfileId]);

  // Load loop definition
  useEffect(() => {
    if (!novelId || phasesLoaded) return;
    api.get(`/novels/${novelId}/loop-definition`).then(({ data }) => {
      if (data.data?.phases) setPhases(data.data.phases);
      setPhasesLoaded(true);
    }).catch(() => setPhasesLoaded(true));
  }, [novelId, phasesLoaded]);

  // Load reference profiles
  useEffect(() => {
    api.get("/profiles").then(({ data }) => setProfiles(data.data ?? [])).catch(() => {});
  }, []);

  // ── Handlers ─────────────────────────────────────

  const handleSelectProfile = async (profile: ProfileItem) => {
    setSelectedProfileId(profile.id);
    // Profile selected — no longer exposes architectureType directly (in analysisResult now)
    await api.put(`/novels/${novelId}/active-profile`, { profileId: profile.id }).catch(() => {});
    // If the profile has a deep analysis result, apply its ArchitectureProfile to the novel
    try {
      const { data } = await api.get(`/profiles/${profile.id}`);
      const full = data?.data;
      if (full?.architectureProfile) {
        await api.patch(`/novels/${novelId}`, { architectureProfile: full.architectureProfile });
      }
    } catch {}
    refetch();
  };

  const updatePhase = (idx: number, field: keyof PhaseDef, value: unknown) =>
    setPhases(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next; });

  const handleConfirmArchitecture = async () => {
    setSaving(true); setSaveError("");
    try {
      if (phases.length > 0) await api.put(`/novels/${novelId}/loop-definition`, { phases }).catch(() => {});
      await api.post(`/novels/${novelId}/pipeline/step/architecture`, {
        architectureType: selectedArch || "case_driven",
        centralQuestion: novel?.centralQuestion ?? undefined,
        endingDirection: novel?.endingDirection ?? undefined,
      });
      refetch();
      setSaveSuccess(true);
      onComplete?.();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) { setSaveError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  // ── Render ───────────────────────────────────────

  const hasProfileArchs = profiles.length > 0;
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3">选择长篇架构</h3>
        <p className="text-xs text-slate-400 mb-4">上传参考书进行深度分析，获得对标书的真实架构数据作为蓝图。</p>

        {/* Reference profiles as architecture cards */}
        {hasProfileArchs && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-[10px] text-slate-400 shrink-0">参考书分析结果</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {profiles.map(profile => {
                const isSelected = selectedProfileId === profile.id;
                const archLabel = "已分析";
                return (
                <button key={profile.id} onClick={() => handleSelectProfile(profile)}
                  className={cn("rounded-xl border text-left transition-all", isSelected ? "border-brand-600 bg-brand-50/30 ring-1 ring-brand-300" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <div className="p-3.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] rounded bg-brand-100 px-1 py-0 text-brand-700">参考书</span>
                      <span className={cn("text-sm font-semibold truncate", isSelected ? "text-brand-900" : "text-slate-700")}>{profile.name}</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-1.5">架构：{archLabel}</div>
                    <div className="text-[10px] text-slate-400">{new Date(profile.createdAt).toLocaleDateString("zh-CN")} 分析</div>
                  </div>
                  {isSelected && (
                    <div className="border-t border-brand-100 p-3 space-y-1.5 text-xs bg-white">
                      <div><span className="font-medium text-slate-600">状态：</span><span className="text-slate-500">已分析，查看驾驶舱获取完整架构蓝图</span></div>
                      <div><span className="font-medium text-slate-600">分析维度：</span><span className="text-slate-500">回环叙事 · 节奏曲线 · 金手指 · 写法技法 · 写作统计</span></div>
                    </div>
                  )}
                </button>
              )})}
            </div>
          </>
        )}

        {/* CTA: analyze new reference book */}
        <button onClick={() => navigate("/reference-profiles")}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors w-full justify-center">
          <BookOpen size={12} />分析新的参考书，提取定制架构 <ArrowRight size={10} />
        </button>
      </section>

      {/* Loop Phase Editor — always visible when phases exist */}
      {phases.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-slate-700">回环阶段</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">每轮回环按此阶段顺序推进。调整阶段名、描述和章数范围来自定义你的故事节奏。</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPhases(prev => [...prev, { phase: `new_${prev.length+1}`, label: "新阶段", description: "描述此阶段", typicalChapterCount: [1,3] }])}
                className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"><Plus size={11} />新增</button>
              <button onClick={async () => { setSavingPhases(true); try { await api.put(`/novels/${novelId}/loop-definition`, { phases }); } catch (e) { setPhaseError(e instanceof Error ? e.message : "保存失败"); } finally { setSavingPhases(false); } }}
                disabled={savingPhases} className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {savingPhases ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}保存阶段</button>
            </div>
          </div>
          {phaseError && <p className="text-xs text-red-500 mb-2">{phaseError}</p>}

          {/* Quick overview — phase flow */}
          <div className="mb-3 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
            {phases.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{p.label}</span>
                <span className="text-slate-300">({p.typicalChapterCount[0]}-{p.typicalChapterCount[1]}章)</span>
                {i < phases.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>

          {/* Editable phase list */}
          <div className="space-y-1.5">
            {phases.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 p-2 group">
                <div className="flex flex-col shrink-0">
                  <button onClick={() => { if (idx>0) setPhases(prev => { const n=[...prev]; [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; return n; }); }} disabled={idx===0} className="text-slate-300 hover:text-slate-500 disabled:opacity-30"><ArrowUp size={10} /></button>
                  <button onClick={() => { if (idx<phases.length-1) setPhases(prev => { const n=[...prev]; [n[idx],n[idx+1]]=[n[idx+1],n[idx]]; return n; }); }} disabled={idx===phases.length-1} className="text-slate-300 hover:text-slate-500 disabled:opacity-30"><ArrowDown size={10} /></button>
                </div>
                <input className="w-16 shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 focus:border-brand-300 focus:outline-none" value={p.phase} onChange={e => updatePhase(idx,"phase",e.target.value)} placeholder="key" />
                <input className="w-20 shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 focus:border-brand-300 focus:outline-none" value={p.label} onChange={e => updatePhase(idx,"label",e.target.value)} placeholder="阶段名称" />
                <input className="flex-1 min-w-0 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 focus:border-brand-300 focus:outline-none" value={p.description} onChange={e => updatePhase(idx,"description",e.target.value)} placeholder="阶段描述" />
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
      )}

      {/* Confirm button */}
      <button onClick={handleConfirmArchitecture} disabled={saving || saveSuccess}
        className={cn(
          "w-full rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
          saveSuccess ? "bg-green-600 text-white" : "bg-slate-900 text-white hover:bg-slate-800",
        )}>
        {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" /> :
         saveSuccess ? <CheckCircle size={14} className="inline mr-1" /> :
         <Sparkles size={14} className="inline mr-1" />}
        {saving ? "保存中..." : saveSuccess ? "架构已确认 ✓" : "确认架构"}
      </button>
      {saveError && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">{saveError}</div>}
    </div>
  );
}
