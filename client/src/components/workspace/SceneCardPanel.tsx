import { useState, useCallback, useRef } from "react";
import type { Scene, ScenePlan } from "../../api/scene";
import { useScenePlan, useGenerateScenePlan, useUpdateScenePlan } from "../../api/scene";
import { Film, Plus, GripVertical, Pencil, Trash2, Wand2, Save } from "lucide-react";

interface Props {
  novelId: string;
  chapterId: string | undefined;
}

function newScene(): Scene {
  return {
    id: `new-${Date.now().toString(36)}`,
    order: 0,
    title: "",
    summary: "",
    estimatedWords: 500,
  };
}

export default function SceneCardPanel({ novelId, chapterId }: Props) {
  const { data: plan, isLoading } = useScenePlan(novelId, chapterId);
  const generate = useGenerateScenePlan(novelId, chapterId);
  const update = useUpdateScenePlan(novelId, chapterId);

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Sync from server when plan loads
  const synced = useRef(false);
  if (plan?.scenes && !synced.current) {
    synced.current = true;
    setScenes(plan.scenes);
  }
  // Reset when chapterId changes
  const prevChapterId = useRef(chapterId);
  if (prevChapterId.current !== chapterId) {
    prevChapterId.current = chapterId;
    synced.current = false;
    setScenes([]);
    setDirty(false);
    setEditingId(null);
  }

  const handleGenerate = useCallback(async () => {
    if (!chapterId) return;
    try {
      const result = await generate.mutateAsync();
      setScenes(result.scenes);
      setDirty(false);
    } catch { /* errors handled by mutation */ }
  }, [chapterId, generate]);

  const handleSave = useCallback(async () => {
    if (!chapterId || !dirty) return;
    try {
      await update.mutateAsync(scenes.map((s, i) => ({ ...s, order: i + 1 })));
      setDirty(false);
    } catch { /* errors handled by mutation */ }
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

  // Drag handlers
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

  if (!chapterId) {
    return (
      <div className="flex-1 overflow-y-auto">
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1"><Film size={12} />分镜</h4>
        <p className="text-slate-400 italic text-xs">请先选择一个章节</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1"><Film size={12} />分镜</h4>
        <p className="text-slate-400 italic text-xs">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="font-semibold text-slate-700 flex items-center gap-1">
          <Film size={12} />分镜
          {scenes.length > 0 && <span className="text-slate-400 font-normal text-xs">({scenes.length})</span>}
        </h4>
        <div className="flex items-center gap-1">
          {scenes.length === 0 ? (
            <button
              onClick={handleGenerate}
              disabled={generate.isPending}
              className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-0.5"
            >
              <Wand2 size={10} />{generate.isPending ? "生成中..." : "AI 生成"}
            </button>
          ) : (
            <>
              <button
                onClick={handleGenerate}
                disabled={generate.isPending}
                className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-0.5"
                title="重新生成（覆盖当前分镜）"
              >
                <Wand2 size={10} />{generate.isPending ? "..." : "重生成"}
              </button>
              {dirty && (
                <button
                  onClick={handleSave}
                  disabled={update.isPending}
                  className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50 flex items-center gap-0.5"
                >
                  <Save size={10} />{update.isPending ? "..." : "保存"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Error messages */}
      {generate.isError && <p className="text-red-500 text-xs mb-1">生成失败，请重试</p>}
      {update.isError && <p className="text-red-500 text-xs mb-1">保存失败，请重试</p>}

      {/* Scene list */}
      {scenes.length === 0 && !generate.isPending ? (
        <p className="text-slate-400 italic text-xs">点击 "AI 生成" 自动规划本章场景</p>
      ) : (
        <div className="space-y-1">
          {scenes.map((s, idx) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`rounded border text-xs ${
                dragIdx === idx ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"
              } cursor-default`}
            >
              {/* Compact row */}
              <div className="flex items-center gap-1 px-1.5 py-1">
                <GripVertical size={10} className="text-slate-300 cursor-grab shrink-0" />
                <span className="text-slate-400 font-mono text-[10px] shrink-0">#{idx + 1}</span>
                {editingId === s.id ? (
                  <input
                    autoFocus
                    className="flex-1 border border-indigo-200 rounded px-1 py-0 text-xs outline-none"
                    value={s.title}
                    onChange={e => handleEdit(s.id, "title", e.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={e => { if (e.key === "Enter") setEditingId(null); }}
                    placeholder="场景标题"
                  />
                ) : (
                  <span
                    className="flex-1 truncate cursor-pointer hover:text-indigo-600"
                    onClick={() => setEditingId(s.id)}
                  >
                    {s.title || "未命名场景"}
                  </span>
                )}
                {s.estimatedWords && (
                  <span className="text-slate-400 shrink-0 text-[10px]">{s.estimatedWords}字</span>
                )}
                <button
                  onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                  className="text-slate-300 hover:text-slate-500 shrink-0"
                ><Pencil size={10} /></button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="text-slate-300 hover:text-red-400 shrink-0"
                ><Trash2 size={10} /></button>
              </div>
              {/* Expanded editor */}
              {editingId === s.id && (
                <div className="px-3 pb-2 space-y-1">
                  <textarea
                    className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs resize-none"
                    rows={2}
                    value={s.summary}
                    onChange={e => handleEdit(s.id, "summary", e.target.value)}
                    placeholder="场景摘要"
                  />
                  <div className="flex gap-2 flex-wrap">
                    <input
                      className="w-20 border border-slate-200 rounded px-1 py-0 text-xs"
                      value={s.goal ?? ""}
                      onChange={e => handleEdit(s.id, "goal", e.target.value)}
                      placeholder="目标"
                    />
                    <input
                      className="w-20 border border-slate-200 rounded px-1 py-0 text-xs"
                      value={s.location ?? ""}
                      onChange={e => handleEdit(s.id, "location", e.target.value)}
                      placeholder="地点"
                    />
                    <input
                      className="w-16 border border-slate-200 rounded px-1 py-0 text-xs"
                      type="number"
                      value={s.estimatedWords ?? ""}
                      onChange={e => handleEdit(s.id, "estimatedWords", parseInt(e.target.value) || 0)}
                      placeholder="字数"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          {/* Add scene button */}
          {scenes.length < 8 && (
            <button
              onClick={handleAdd}
              className="w-full text-xs text-slate-400 hover:text-indigo-500 border border-dashed border-slate-200 rounded py-0.5 flex items-center justify-center gap-1"
            >
              <Plus size={10} />添加场景
            </button>
          )}
        </div>
      )}
    </div>
  );
}
