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
  { id: "skill_slot", name: "技能栏搭配", desc: "力量体系有固定槽位限制，主角获得更多槽位或自由组合能力。每次解锁新槽位或合成新技能都是一次'开奖'，持续制造稀缺感和期待感。", genres: "御兽/游戏/竞技", works: "《不科学御兽》", phases: "触发→解锁槽位→收集技能→搭配验证→战斗→结算", coolPoints: "策略搭配(40%) > 验证战(30%) > 收集(20%) > 升级(10%)", hookStyle: "以'下一个槽位解锁什么'为长期钩子，每章以战斗悬念或新技能线索收尾" },
  { id: "sequence_promotion", name: "序列晋升", desc: "力量体系呈序列/途径树状。晋升需要材料+仪式+扮演，每个序列有独特能力和隐藏职业。晋升不是数值提升而是行为艺术。", genres: "克苏鲁/诡秘/超凡", works: "《诡秘之主》", phases: "触发→收集材料→完成仪式→扮演消化→新能力探索→结算", coolPoints: "揭示(35%) > 策略(25%) > 收集(20%) > 升级(20%)", hookStyle: "以'下一个序列是什么'为核心驱动，章尾常用信息揭示或世界观扩展收尾" },
  { id: "case_driven", name: "超凡办案", desc: "主角隶属于超凡执法机构，通过办案积累功绩和资源。案件背后有核心阴谋串联，单元剧结构天然适配网文追读。", genres: "悬疑/探案/都市", works: "《大奉打更人》", phases: "接案→调查→遭遇超凡→推理→收网→论功行赏", coolPoints: "策略(35%) > 打脸(25%) > 揭示(20%) > 收集(20%)", hookStyle: "案件谜题+体制内晋升双线驱动，章尾以新线索或权力博弈收尾" },
  { id: "cultivation_planning", name: "修真规划", desc: "传统修真体系，金手指放大资源获取效率。主角在每个境界完美规划/补齐辅修，同阶无敌+越级挑战的极致满足感。", genres: "仙侠/修真/古典", works: "《凡人修仙传》", phases: "触发→资源收集→闭关突破→出关验证→碾压对手→结算收获", coolPoints: "升级(35%) > 收集(30%) > 打脸(20%) > 策略(15%)", hookStyle: "以'下一个境界是什么'为长期钩子，章尾以突破预兆或敌人逼近收尾" },
  { id: "hexagon_godhood", name: "六边形成神", desc: "主角需在武力/精神/势力/财富/知识/声望六维度逐一补全短板。每一步都从泥泞中爬起，反差感贯穿全书，最终登临神座。", genres: "西幻/史诗/黑暗", works: "《亵渎》", phases: "触发→受挫暴露短板→补全某维度→新能力形成→验证→结算", coolPoints: "策略(30%) > 升级(25%) > 揭示(20%) > 打脸(15%) > 收集(10%)", hookStyle: "以'下一个要补全的维度是什么'为驱动，章尾常用反转或代价揭示收尾" },
  { id: "historical_transmigration", name: "穿越历史", desc: "穿越到特定历史时期，用前世知识+金手指改变历史进程、进行社会实验。五级递进舞台：个人→家族→地区→国家→文明方向。", genres: "历史/都市/科幻", works: "《庆余年》", phases: "触发→知识变现→势力崛起→改变格局→文明重建→结算", coolPoints: "策略(35%) > 打脸(25%) > 揭示(20%) > 升级(20%)", hookStyle: "以'主角的身世秘密'为长期钩子，章尾以政治博弈或身份揭示收尾" },
];

interface PhaseDef {
  phase: string; label: string; description: string; typicalChapterCount: [number, number];
}

export function ArchitectureDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
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
          {ARCH_TEMPLATES.map(arch => {
            const isSelected = selectedArch === arch.id;
            return (
            <button key={arch.id} onClick={() => handleSelectArch(arch.id)}
              className={cn("rounded-xl border text-left transition-all", isSelected ? "border-slate-900 bg-slate-50 ring-1 ring-slate-300" : "border-slate-200 bg-white hover:border-slate-300")}>
              <div className="p-3.5">
                <div className={cn("text-sm font-semibold mb-1", isSelected ? "text-slate-900" : "text-slate-700")}>{arch.name}</div>
                <div className="text-xs text-slate-500 leading-relaxed mb-1.5">{arch.desc}</div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400"><span>{arch.genres}</span><span className="text-slate-400">·</span><span className="italic">{arch.works}</span></div>
              </div>
              {isSelected && (
                <div className="border-t border-slate-200 p-3 space-y-2 text-xs bg-white">
                  <div><span className="font-medium text-slate-600">回环阶段：</span><span className="text-slate-500">{arch.phases}</span></div>
                  <div><span className="font-medium text-slate-600">爽点配比：</span><span className="text-slate-500">{arch.coolPoints}</span></div>
                  <div><span className="font-medium text-slate-600">钩子策略：</span><span className="text-slate-500">{arch.hookStyle}</span></div>
                </div>
              )}
            </button>
          )})}
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
