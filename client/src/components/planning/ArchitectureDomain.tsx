/**
 * ArchitectureDomain — 长篇架构决策域
 * 架构模板选择 → 回环阶段编辑器 → 金手指设定 → 终局悬念
 */
import { useState, useEffect } from "react";
import { Sparkles, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Plus, X, Save, RefreshCw, CheckCircle } from "lucide-react";
import { useNovel, useUpdateNovel } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string; onComplete?: () => void }

const ARCH_TEMPLATES = [
  { id: "skill_slot", name: "技能栏搭配", desc: "收集技能→搭配策略→验证战斗。固定槽位制造稀缺感，每次'开奖'都让读者兴奋。", genres: "御兽/游戏/竞技", works: "《不科学御兽》" },
  { id: "sequence_promotion", name: "序列晋升", desc: "收集材料→完成仪式→解锁能力。晋升不是数值提升而是行为艺术，隐藏职业带来极致优越感。", genres: "克苏鲁/诡秘/超凡", works: "《诡秘之主》" },
  { id: "case_driven", name: "超凡办案", desc: "接任务→查案→遭遇超凡→收网。案件是天然的单元剧容器，体制内身份解决动机问题。", genres: "悬疑/探案/都市", works: "《大奉打更人》" },
  { id: "cultivation_planning", name: "修真规划", desc: "资源收集→完美突破→底牌碾压。在每一境界都把能点满的技能点满，同阶无敌的极致满足。", genres: "仙侠/修真/古典", works: "《凡人修仙传》" },
  { id: "hexagon_godhood", name: "六边形成神", desc: "逐维度补全短板→吞噬强者→降维打击。从泥泞中一步步爬上神座，反差感贯穿全书。", genres: "西幻/史诗/黑暗", works: "《亵渎》" },
  { id: "historical_transmigration", name: "穿越历史", desc: "知识差→势力崛起→改变历史→文明重建。五级递进舞台，从个人到家国再到文明方向。", genres: "历史/都市/科幻", works: "《庆余年》" },
];

interface PhaseDef {
  phase: string; label: string; description: string; typicalChapterCount: [number, number];
}

export function ArchitectureDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
  const [localAbilities, setLocalAbilities] = useState("");
  const [localLimits, setLocalLimits] = useState("");
  const [selectedArch, setSelectedArch] = useState(novel?.architectureType ?? "");
  const [showLoopEditor, setShowLoopEditor] = useState(false);
  const [phases, setPhases] = useState<PhaseDef[]>([]);
  const [phasesLoaded, setPhasesLoaded] = useState(false);
  const [savingPhases, setSavingPhases] = useState(false);
  const [phaseError, setPhaseError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => { if (novel?.architectureType && !selectedArch) setSelectedArch(novel.architectureType); }, [novel?.architectureType]);

  useEffect(() => {
    if (novel?.goldenFinger) {
      try {
        const gf = JSON.parse(novel.goldenFinger);
        if (Array.isArray(gf.abilities)) setLocalAbilities(gf.abilities.join("\n"));
        if (Array.isArray(gf.limits)) setLocalLimits(gf.limits.join("\n"));
      } catch {}
    }
  }, [novel?.goldenFinger]);

  useEffect(() => {
    if (!novelId || phasesLoaded) return;
    api.get(`/novels/${novelId}/loop-definition`).then(({ data }) => {
      if (data.data?.phases) setPhases(data.data.phases);
      setPhasesLoaded(true);
    }).catch(() => setPhasesLoaded(true));
  }, [novelId, phasesLoaded]);

  const handleSelectArch = async (archId: string) => {
    setSelectedArch(archId);
    try {
      const { data } = await api.get(`/novels/${novelId}/architecture/templates`);
      const tmpl = (data.data ?? []).find((t: { id: string }) => t.id === archId);
      if (tmpl?.defaultLoop?.phases) setPhases(tmpl.defaultLoop.phases.map((p: PhaseDef) => ({ ...p })));
    } catch {}
  };

  const updatePhase = (idx: number, field: keyof PhaseDef, value: unknown) =>
    setPhases(prev => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next; });

  const handleConfirmArchitecture = async () => {
    setSaving(true); setSaveError("");
    try {
      if (phases.length > 0) await api.put(`/novels/${novelId}/loop-definition`, { phases }).catch(() => {});
      await api.post(`/novels/${novelId}/pipeline/step/architecture`, {
        architectureType: selectedArch || "case_driven",
        goldenFinger: { abilities: localAbilities.split("\n").filter(Boolean), limits: localLimits.split("\n").filter(Boolean) },
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

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3">选择长篇架构</h3>
        <div className="grid grid-cols-3 gap-2.5">
          {ARCH_TEMPLATES.map(arch => (
            <button key={arch.id} onClick={() => handleSelectArch(arch.id)}
              className={cn("rounded-xl border p-3.5 text-left transition-all", selectedArch === arch.id ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 bg-white hover:border-slate-300")}>
              <div className={cn("text-sm font-semibold mb-1", selectedArch === arch.id ? "text-brand-800" : "text-slate-700")}>{arch.name}</div>
              <div className="text-xs text-slate-500 leading-relaxed mb-1.5">{arch.desc}</div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400"><span>{arch.genres}</span><span className="text-brand-400">·</span><span className="italic">{arch.works}</span></div>
            </button>
          ))}
        </div>
        <button onClick={() => setShowLoopEditor(!showLoopEditor)} className="mt-3 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
          {showLoopEditor ? <ChevronDown size={12} /> : <ChevronRight size={12} />}编辑回环阶段 ({phases.length}个阶段)
        </button>
        {showLoopEditor && phases.length > 0 && (
          <div className="mt-2 rounded-lg border border-brand-100 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">自定义每轮回环的阶段顺序、名称和典型章数。</p>
              <div className="flex gap-2">
                <button onClick={() => setPhases(prev => [...prev, { phase: `new_${prev.length+1}`, label: "新阶段", description: "描述此阶段", typicalChapterCount: [1,3] }])}
                  className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"><Plus size={11} />新增</button>
                <button onClick={async () => { setSavingPhases(true); try { await api.put(`/novels/${novelId}/loop-definition`, { phases }); } catch (e) { setPhaseError(e instanceof Error ? e.message : "保存失败"); } finally { setSavingPhases(false); } }}
                  disabled={savingPhases} className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {savingPhases ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}保存</button>
              </div>
            </div>
            {phaseError && <p className="text-xs text-red-500">{phaseError}</p>}
            <div className="space-y-2">
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
          </div>
        )}
      </section>

      <section className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
        <h3 className="text-sm font-medium text-brand-800 mb-3">金手指设定</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-xs font-medium text-slate-500">能力清单</span><textarea className="w-full mt-1 rounded-lg border border-slate-200 p-2.5 text-xs resize-none focus:border-brand-300 focus:outline-none" rows={5} value={localAbilities} onChange={e => setLocalAbilities(e.target.value)} placeholder={"每行一条能力\n如：\n可以看到物品的隐藏信息\n能在战斗中预判敌人动作"} /></div>
          <div><span className="text-xs font-medium text-slate-500">限制清单</span><textarea className="w-full mt-1 rounded-lg border border-slate-200 p-2.5 text-xs resize-none focus:border-brand-300 focus:outline-none" rows={5} value={localLimits} onChange={e => setLocalLimits(e.target.value)} placeholder={"每行一条限制\n如：\n每天只能使用3次预判\n吞噬能力有30%失败率"} /></div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-700">终局悬念</h3>
        <div className="space-y-2">
          <div><label className="text-xs text-slate-500">全书最大的秘密是什么？</label><input className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" placeholder="如：这个世界的真相其实是..." defaultValue={novel?.centralQuestion ?? ""} onBlur={e => { if (e.target.value) updateNovel.mutate({ id: novelId, centralQuestion: e.target.value }); }} /></div>
          <div><label className="text-xs text-slate-500">最终敌人/主角终极形态？</label><input className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" placeholder="如：太古神王·混沌之主" defaultValue={novel?.endingDirection ?? ""} onBlur={e => { if (e.target.value) updateNovel.mutate({ id: novelId, endingDirection: e.target.value }); }} /></div>
        </div>
      </section>

      <button onClick={handleConfirmArchitecture} disabled={saving || saveSuccess}
        className={cn(
          "w-full rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
          saveSuccess ? "bg-green-600 text-white" : "bg-slate-900 text-white hover:bg-slate-800",
        )}>
        {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" /> :
         saveSuccess ? <CheckCircle size={14} className="inline mr-1" /> :
         <Sparkles size={14} className="inline mr-1" />}
        {saving ? "保存中..." : saveSuccess ? "架构已确认 ✓" : "确认架构（生成回环骨架 + 保存金手指）"}
      </button>
      {saveError && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">{saveError}</div>}
    </div>
  );
}
