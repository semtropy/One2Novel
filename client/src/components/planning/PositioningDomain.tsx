/**
 * PositioningDomain — 发布定位
 * 商业定位 + 力量体系树 + 期待管理 + 设定释放计划
 */
import { useState, useEffect } from "react";
import { Sparkles, Check, GripVertical, RefreshCw, CheckCircle } from "lucide-react";
import { useNovel } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";
import { PowerSystemTree, type PowerNode } from "../pipeline/PowerSystemTree";

interface Props { novelId: string; onComplete?: () => void }

export function PositioningDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const archTypeLabels: Record<string, string> = {
    skill_slot: "策略搭配型·御兽流",
    sequence_promotion: "身份切换型·诡秘流",
    case_driven: "单元侦探型·办案流",
    cultivation_planning: "完美规划型·修真流",
    hexagon_godhood: "多维补全型·成神流",
    historical_transmigration: "文明种田型·穿越流",
  };

  const [timelineItems, setTimelineItems] = useState<Array<{ title: string; category: string; sortOrder: number; status?: string }>>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    if (novel?.timelineItems) {
      setTimelineItems([...novel.timelineItems].sort((a, b) => a.sortOrder - b.sortOrder));
    }
  }, [novel?.timelineItems]);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...timelineItems];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    const updated = reordered.map((item, i) => ({ ...item, sortOrder: i + 1 }));
    setTimelineItems(updated);
    setDragIdx(null);
    updated.forEach(item => {
      api.patch(`/novels/${novelId}/timeline/${item.title}`, { sortOrder: item.sortOrder }).catch(() => {});
    });
  };

  const profile = (() => {
    if (!novel?.expectationProfile) return null;
    try { return JSON.parse(novel.expectationProfile); } catch { return null; }
  })();

  const recipeAnalogy = (() => {
    if (!profile?.coolPointRecipe) return null;
    const r = profile.coolPointRecipe;
    const dominant = Object.entries(r as Record<string, number>).sort(([, a], [, b]) => (b as number) - (a as number))[0];
    const analogies: Record<string, string> = {
      collect: "类似《不科学御兽》的技能收集快感——每次获得新能力都像解锁图鉴徽章。",
      strategy: "类似《诡秘之主》的策略推演——读者和主角一起分析序列路径、推演敌人弱点。",
      verify: "类似《凡人修仙传》的底牌揭露——每次掀开一张底牌，敌人就绝望一层。",
      reveal: "类似《大奉打更人》的解谜快感——案件背后的大阴谋徐徐展开。",
      upgrade: "类似《赘婿》的文明种田——从个人命运到家国兴亡再到文明方向。",
    };
    return dominant ? analogies[dominant[0]] ?? null : null;
  })();

  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleCalibrate = async () => {
    setCalibrating(true);
    try {
      await api.post(`/novels/${novelId}/pipeline/step/calibration`);
      refetch();
      setCalibrated(true);
      onComplete?.();
      setTimeout(() => setCalibrated(false), 3000);
    } catch {} finally {
      setCalibrating(false);
    }
  };

  const saveField = async (field: string, value: string) => {
    await api.patch(`/novels/${novelId}`, { [field]: value });
    refetch();
    setEditField(null);
  };

  const [powerNodes, setPowerNodes] = useState<PowerNode[]>([]);
  const [powerNodesLoaded, setPowerNodesLoaded] = useState(false);

  useEffect(() => {
    if (!novelId || powerNodesLoaded) return;
    const rules = novel?.worldRules?.filter(r => r.category === "力量体系") ?? [];
    if (rules.length > 0) {
      setPowerNodes(rules.map(r => ({
        id: r.id, name: r.title, breakthroughCondition: r.content,
        abilityUpgrade: "", children: [],
      })));
    }
    setPowerNodesLoaded(true);
  }, [novelId, novel?.worldRules, powerNodesLoaded]);

  const handleSavePowerNodes = async () => {
    for (const node of powerNodes) {
      const existing = novel?.worldRules?.find(r => r.id === node.id);
      if (existing) {
        await api.patch(`/novels/${novelId}/world-rules/${node.id}`, {
          title: node.name, content: node.breakthroughCondition,
        }).catch(() => {});
      } else if (node.name) {
        await api.post(`/novels/${novelId}/world-rules`, {
          category: "力量体系", title: node.name, content: node.breakthroughCondition,
        }).catch(() => {});
      }
    }
    refetch();
  };

  return (
    <div className="space-y-4">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">商业定位（点击字段可编辑）</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[["genre","题材",novel?.genre ?? ""],["targetAudience","目标读者",novel?.targetAudience ?? ""],["bookSellingPoint","核心卖点",novel?.bookSellingPoint ?? ""],["first30ChapterPromise","前30章承诺书",novel?.first30ChapterPromise ?? ""]].map(([field,label,value]) => (
                <div key={field as string} className="col-span-2">
                  <span className="text-slate-400">{label as string}：</span>
                  {editField === field ? (
                    <span className="inline-flex gap-1">
                      <input autoFocus className="border border-indigo-300 rounded px-1.5 py-0.5 text-xs flex-1 min-w-[300px]" value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => saveField(field as string, editValue)}
                        onKeyDown={e => { if (e.key==="Enter") saveField(field as string, editValue); if (e.key==="Escape") setEditField(null); }} />
                      <button onClick={() => saveField(field as string, editValue)} className="text-green-600 text-[10px]">✓</button>
                    </span>
                  ) : (
                    <span className="text-slate-700 cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => { setEditField(field as string); setEditValue(value as string); }}>
                      {(value as string) || "点击编辑..."}
                    </span>
                  )}
                </div>
              ))}
              <div className="col-span-2">
                <span className="text-slate-400">架构标签：</span>
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                  {archTypeLabels[novel?.architectureType ?? ""] ?? novel?.architectureType ?? "未选择"}
                </span>
                <span className="text-slate-300 ml-1">（在上一步「架构选择」中修改）</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-700">力量体系树状图</h3>
              <button onClick={handleSavePowerNodes} className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">保存</button>
            </div>
            <PowerSystemTree nodes={powerNodes} onChange={setPowerNodes} />
          </div>

          {profile && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">期待管理</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-medium text-slate-600 mb-1.5">爽点配方</p>
                  {profile.coolPointRecipe ? (
                    <div className="space-y-1">
                      {Object.entries(profile.coolPointRecipe as Record<string, number>).map(([type, pct]) => (
                        <div key={type} className="flex items-center gap-2">
                          <span className="w-12 text-slate-500 shrink-0">{({ collect: "收集", strategy: "策略", verify: "验证", reveal: "揭示", upgrade: "升级" } as Record<string, string>)[type] ?? type}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} /></div>
                          <span className="w-10 text-right text-slate-400">{pct}%</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-slate-400">未设置</p>}
                  {recipeAnalogy && <p className="text-[10px] text-indigo-500 italic mt-1.5 leading-relaxed">{recipeAnalogy}</p>}
                </div>
                {profile.hookProfile && (
                  <div>
                    <p className="font-medium text-slate-600 mb-1">钩子密度目标</p>
                    <div className="flex gap-4">
                      <span className="text-slate-500">每章{profile.hookProfile.shortTermPerChapter}个短期钩子</span>
                      <span className="text-slate-500">每卷{profile.hookProfile.mediumTermPerVolume}个中期钩子</span>
                      <span className="text-slate-500">{profile.hookProfile.longTermLines}条长期钩子线</span>
                    </div>
                  </div>
                )}
                {profile.payoffWindow && (
                  <div>
                    <p className="font-medium text-slate-600 mb-1">伏笔回收窗口</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-amber-400" style={{ width: "100%" }} /></div>
                      <span className="text-slate-500">{profile.payoffWindow}章</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">设定释放计划</h3>
            {timelineItems.length > 0 ? (
              <div className="space-y-1">
                {timelineItems.filter(t => t.category !== "event").slice(0, 12).map((item, i) => (
                  <div key={i} draggable onDragStart={() => handleDragStart(i)} onDragOver={handleDragOver} onDrop={() => handleDrop(i)}
                    className={`flex items-center gap-2 rounded bg-slate-50 px-3 py-1.5 text-xs cursor-grab ${dragIdx === i ? "bg-indigo-50 border border-indigo-200" : ""}`}>
                    <GripVertical size={10} className="text-slate-300 shrink-0" />
                    <span className={cn("shrink-0 rounded-full w-2 h-2", item.category === "constraint" ? "bg-red-400" : item.category === "milestone" ? "bg-purple-400" : item.category === "deadline" ? "bg-amber-400" : "bg-blue-400")} />
                    <span className="font-medium text-slate-600 flex-1 truncate">{item.title}</span>
                    <span className="text-slate-400 shrink-0">第{item.sortOrder}章</span>
                    {item.status === "resolved" && <Check size={10} className="text-green-500 shrink-0" />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic text-center py-4">暂无设定释放计划。写作过程中AI会自动提取。</p>
            )}
          </div>

          <button onClick={handleCalibrate} disabled={calibrating || calibrated}
            className={cn(
              "w-full rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
              calibrated ? "bg-green-600 text-white" : "bg-indigo-600 text-white hover:bg-indigo-700",
            )}>
            {calibrating ? <RefreshCw size={14} className="animate-spin inline mr-1" /> :
             calibrated ? <CheckCircle size={14} className="inline mr-1" /> :
             <Sparkles size={14} className="inline mr-1" />}
            {calibrating ? "校准中..." : calibrated ? "定位已确认 ✓" : "确认定位，校准期待参数"}
          </button>
        </div>
    </div>
  );
}
