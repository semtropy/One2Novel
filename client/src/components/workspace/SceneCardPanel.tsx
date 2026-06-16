import { useState, useCallback } from "react";
import type { Scene } from "../../api/scene";
import { useScenePlan, useGenerateScenePlan, useUpdateScenePlan, useToggleScenePlan } from "../../api/scene";
import { Film, Plus, Trash2, Wand2, Save, X, GripVertical } from "lucide-react";

interface Props { novelId: string; chapterId: string | undefined }

function newScene(): Scene {
  return { id: `new-${Date.now().toString(36)}`, order: 0, title: "", summary: "", estimatedWords: 500 };
}

export function SceneCardPanel({ novelId, chapterId }: Props) {
  const { data: plan } = useScenePlan(novelId, chapterId);
  const generate = useGenerateScenePlan(novelId, chapterId);
  const update = useUpdateScenePlan(novelId, chapterId);
  const toggle = useToggleScenePlan(novelId, chapterId);

  const [showPopup, setShowPopup] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [popped, setPopped] = useState(false);

  // Sync from server when popup opens
  if (showPopup && !popped && plan?.scenes) {
    setPopped(true);
    setScenes(plan.scenes.map(s => ({ ...s })));
    setDirty(false);
  }
  // Reset when popup closes
  const openPopup = useCallback(() => {
    setPopped(false);
    setScenes([]);
    setDirty(false);
    setShowPopup(true);
  }, []);
  const closePopup = useCallback(() => {
    setShowPopup(false);
    setPopped(false);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!chapterId) return;
    try {
      const result = await generate.mutateAsync();
      setScenes(result.scenes.map(s => ({ ...s })));
      setDirty(true);
    } catch { /* */ }
  }, [chapterId, generate]);

  const handleSave = useCallback(async () => {
    if (!chapterId || !dirty) return;
    try {
      const normalized = scenes.map((s, i) => ({
        ...s, order: i + 1,
        // participants: keep as array — if stored as string, split by 、
        participants: typeof s.participants === "string"
          ? (s.participants as string).split(/[、,，]/).map(p => p.trim()).filter(Boolean)
          : s.participants,
      }));
      await update.mutateAsync(normalized);
      setDirty(false);
    } catch { /* */ }
  }, [chapterId, dirty, scenes, update]);

  const handleAdd = () => {
    setScenes(prev => [...prev, { ...newScene(), order: prev.length + 1 }]);
    setDirty(true);
  };

  const handleDelete = (id: string) => {
    setScenes(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i + 1 })));
    setDirty(true);
  };

  const handleEdit = (id: string, field: keyof Scene, value: string | number) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    setDirty(true);
  };

  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setScenes(prev => {
      const next = [...prev];
      const [item] = next.splice(dragIdx, 1);
      next.splice(idx, 0, item);
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setDragIdx(idx);
    setDirty(true);
  };
  const handleDragEnd = () => setDragIdx(null);

  const sceneCount = plan?.scenes?.length ?? 0;
  const enabled = plan?.enabled !== false && sceneCount > 0;

  if (!chapterId) return null;

  return (
    <>
      {/* Compact indicator in BottomPanel */}
      <div className="flex-1 overflow-hidden cursor-pointer hover:bg-slate-50 rounded p-2 -m-2 flex flex-col" onClick={openPopup}>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1 shrink-0"><Film size={12} />分镜</h4>
        {sceneCount > 0 ? (
          <div className="text-xs text-slate-500 leading-relaxed">
            <div className="text-slate-400 mb-0.5">共 {sceneCount} 个场景 · {enabled ? "已启用" : "未启用"}</div>
            {plan!.scenes.slice(0, 3).map((s, i) => (
              <div key={i} className="truncate">{s.title || "未命名"}</div>
            ))}
            {sceneCount > 3 && <div className="text-slate-300">...</div>}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center"><p className="text-xs text-slate-400 italic">点击生成分镜</p></div>
        )}
      </div>

      {/* Detail Popup */}
      {showPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closePopup}>
          <div className="w-[52rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-800">分镜</h3>
                {sceneCount > 0 && (
                  <button onClick={() => toggle.mutate(!enabled)}
                    className={`text-xs px-2 py-0.5 rounded-full ${enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {enabled ? "已启用 ●" : "未启用 ○"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={handleGenerate} disabled={generate.isPending}
                  className="text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-0.5">
                  <Wand2 size={10} />{generate.isPending ? "生成中..." : scenes.length > 0 ? "重新生成" : "AI 生成"}
                </button>
                <button onClick={() => {
                  setScenes(plan!.scenes.map(s => ({ ...s })));
                  setDirty(false);
                }} className={`text-xs px-2 py-1 rounded border ${dirty ? "border-slate-300 text-slate-700 hover:bg-slate-100" : "border-slate-100 text-slate-300"}`}>
                  撤销
                </button>
                <button onClick={handleSave} disabled={update.isPending || !dirty}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-0.5 ${dirty ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-green-50/50 text-green-400"}`}>
                  <Save size={10} />保存
                </button>
                <button onClick={closePopup} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>
            </div>

            {/* Empty state */}
            {scenes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
                <Film size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500 mb-1">还没有分镜计划</p>
                <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto leading-relaxed">
                  AI 可将本章拆分为 3-6 个有因果关系的场景，每个场景含标题、摘要、目标、地点、视点、出场角色
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={handleGenerate} disabled={generate.isPending}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700">
                    {generate.isPending ? "AI 生成中..." : "AI 生成"}
                  </button>
                  <button onClick={handleAdd}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">
                    手动添加
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {scenes.map((s, idx) => (
                  <div key={s.id} draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`rounded-lg border bg-white p-4 text-xs cursor-default ${dragIdx === idx ? "border-brand-400 bg-brand-50/30" : "border-slate-200"}`}>
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-3">
                      <GripVertical size={14} className="text-slate-300 cursor-grab shrink-0" />
                      <span className="text-slate-300 font-mono text-sm w-6">#{idx + 1}</span>
                      <input
                        className="flex-1 text-sm font-medium border-b border-transparent hover:border-slate-200 focus:border-brand-300 px-1 py-0.5 outline-none"
                        value={s.title} onChange={e => handleEdit(s.id, "title", e.target.value)}
                        onBlur={() => setDirty(true)} placeholder="场景标题"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-slate-400">约</span>
                        <input type="number" min={100} max={3000}
                          className="w-14 text-center border-b border-transparent hover:border-slate-200 focus:border-brand-300 px-1 py-0.5 text-sm outline-none text-slate-600"
                          value={s.estimatedWords ?? ""} onChange={e => handleEdit(s.id, "estimatedWords", parseInt(e.target.value) || 0)}
                          onBlur={() => setDirty(true)} placeholder="500"
                        />
                        <span className="text-slate-400">字</span>
                      </div>
                      <button onClick={() => handleDelete(s.id)}
                        className="text-slate-300 hover:text-red-400 p-0.5" title="删除"><Trash2 size={14} /></button>
                    </div>

                    {/* Summary */}
                    <textarea
                      className="w-full border border-slate-100 rounded px-2.5 py-2 text-xs resize-none focus:border-brand-200 focus:outline-none mb-3"
                      rows={2} value={s.summary} onChange={e => handleEdit(s.id, "summary", e.target.value)}
                      onBlur={() => setDirty(true)} placeholder="场景摘要"
                    />

                    {/* Metadata — two columns */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <Field label="目标">
                        <input value={s.goal ?? ""} onChange={e => handleEdit(s.id, "goal", e.target.value)}
                          onBlur={() => setDirty(true)} placeholder="场景目标" />
                      </Field>
                      <Field label="地点">
                        <input value={s.location ?? ""} onChange={e => handleEdit(s.id, "location", e.target.value)}
                          onBlur={() => setDirty(true)} placeholder="地点" />
                      </Field>
                      <Field label="时间">
                        <input value={s.timeOfDay ?? ""} onChange={e => handleEdit(s.id, "timeOfDay", e.target.value)}
                          onBlur={() => setDirty(true)} placeholder="如：傍晚" />
                      </Field>
                      <Field label="视点">
                        <input value={s.povCharacter ?? ""} onChange={e => handleEdit(s.id, "povCharacter", e.target.value)}
                          onBlur={() => setDirty(true)} placeholder="POV 角色名" />
                      </Field>
                      <Field label="出场" fullWidth>
                        <input value={Array.isArray(s.participants) ? s.participants.join("、") : (typeof s.participants === "string" ? s.participants : "")}
                          onChange={e => handleEdit(s.id, "participants", e.target.value)}
                          onBlur={() => setDirty(true)} placeholder="角色名，顿号分隔" />
                      </Field>
                    </div>
                  </div>
                ))}
                {scenes.length < 8 && (
                  <button onClick={handleAdd}
                    className="w-full text-xs text-slate-400 hover:text-brand-500 border border-dashed border-slate-200 rounded-lg py-2 flex items-center justify-center gap-1">
                    <Plus size={10} />添加场景
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${fullWidth ? "col-span-2" : ""}`}>
      <span className="text-slate-400 text-[10px] w-8 shrink-0 text-right">{label}</span>
      <div className="flex-1 [&_input]:w-full [&_input]:border [&_input]:border-slate-100 [&_input]:rounded [&_input]:px-2 [&_input]:py-1 [&_input]:text-xs [&_input]:focus:border-brand-200 [&_input]:focus:outline-none">
        {children}
      </div>
    </div>
  );
}

