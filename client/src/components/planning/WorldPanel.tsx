import { useState } from "react";
import { useWorldRules, useCreateWorldRule, useUpdateWorldRule, useDeleteWorldRule, useGenerateWorldRules, useCheckWorldConflicts, useResolveWorldConflict, type WorldRule, type ConflictResult } from "../../api/novel";

const CATEGORIES = ["势力格局", "力量体系", "资源规则", "社会结构", "地理环境", "历史背景"] as const;

interface Props { novelId: string }

export function WorldPanel({ novelId }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "", category: "势力格局" });
  const [showCreate, setShowCreate] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictResult[] | null>(null);
  const [genError, setGenError] = useState("");

  const { data: rules, isLoading } = useWorldRules(novelId, activeCategory || undefined);
  const createMutation = useCreateWorldRule();
  const updateMutation = useUpdateWorldRule();
  const deleteMutation = useDeleteWorldRule();
  const generateMutation = useGenerateWorldRules();
  const conflictMutation = useCheckWorldConflicts();
  const resolveMutation = useResolveWorldConflict();

  const filtered = rules ?? [];
  const activeCount = filtered.filter(r => r.status === "active").length;

  const handleCreate = async () => {
    await createMutation.mutateAsync({ novelId, ...editForm });
    setShowCreate(false);
    setEditForm({ title: "", content: "", category: "势力格局" });
  };

  const handleCheckConflicts = async () => {
    const result = await conflictMutation.mutateAsync(novelId);
    setConflicts(result);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">世界规则</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{activeCount} 条活跃</span>
          <button onClick={() => { setGenError(""); generateMutation.mutate(novelId, { onError: (e) => setGenError(e instanceof Error ? e.message : "生成失败，请重试") }); }} disabled={generateMutation.isPending}
            className="px-2.5 py-1 text-xs rounded-lg bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {generateMutation.isPending ? "生成中..." : "AI 生成"}
          </button>
          <button onClick={handleCheckConflicts} disabled={conflictMutation.isPending}
            className="px-2.5 py-1 text-xs rounded-lg bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 disabled:opacity-50">
            {conflictMutation.isPending ? "检测中..." : "冲突检测"}
          </button>
          <button onClick={() => setShowCreate(true)}
            className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200">
            + 添加
          </button>
        </div>
      </div>

      {genError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-1.5">
          <span className="text-red-400 font-bold shrink-0">!</span>
          <span className="flex-1">{genError}</span>
          <button onClick={() => setGenError("")} className="text-red-400 hover:text-red-600 shrink-0">&times;</button>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto">
        <button onClick={() => setActiveCategory("")}
          className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${!activeCategory ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          全部
        </button>
        {CATEGORIES.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${activeCategory === cat ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Conflicts */}
      {conflicts && conflicts.length > 0 && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-red-800">发现 {conflicts.length} 处逻辑冲突</span>
            <button onClick={() => setConflicts(null)} className="text-red-400 hover:text-red-600 text-xs">&times;</button>
          </div>
          {conflicts.map((c, i) => (
            <div key={i} className="mb-2 last:mb-0 p-2 bg-white rounded border border-red-100 text-xs">
              <div className="font-medium text-red-700">{c.title}</div>
              {c.conflicts.map((cf, j) => (
                <div key={j} className="mt-1 text-red-600">
                  &#8596; {cf.title}: {cf.explanation}
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => resolveMutation.mutate({ novelId, ruleId: cf.ruleId, resolution: "keep" })}
                      className="text-green-600 hover:underline text-[10px]">保留</button>
                    <button onClick={() => resolveMutation.mutate({ novelId, ruleId: cf.ruleId, resolution: "deprecate" })}
                      className="text-gray-500 hover:underline text-[10px]">废弃</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {conflicts?.length === 0 && (
        <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
          未发现逻辑冲突，世界规则一致。
          <button onClick={() => setConflicts(null)} className="ml-2 text-green-500 hover:underline">&times;</button>
        </div>
      )}

      {/* Rule list */}
      {isLoading ? (
        <div className="text-center py-4 text-xs text-gray-400">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-6 text-xs text-gray-400">
          暂无规则。点击「AI 生成」根据小说信息自动创建，或点击「+ 添加」手动创建。
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {filtered.map(rule => (
            <div key={rule.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
              rule.status === "deprecated" ? "border-gray-200 bg-gray-50 opacity-60" :
              rule.status === "conflicted" ? "border-red-200 bg-red-50" :
              "border-slate-200 hover:border-slate-300"
            }`}>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                rule.priority >= 8 ? "bg-red-100 text-red-700" :
                rule.priority >= 5 ? "bg-amber-100 text-amber-700" :
                "bg-slate-100 text-slate-600"
              }`}>
                P{rule.priority}
              </span>
              <div className="flex-1 min-w-0">
                {editing === rule.id ? (
                  <div className="space-y-1">
                    <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                      className="w-full px-2 py-0.5 border rounded text-xs" placeholder="标题" />
                    <input value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))}
                      className="w-full px-2 py-0.5 border rounded text-xs" placeholder="内容" />
                    <div className="flex gap-1">
                      <button onClick={async () => { await updateMutation.mutateAsync({ novelId, ruleId: rule.id, title: editForm.title, content: editForm.content }); setEditing(null); }}
                        className="text-green-600 hover:underline">保存</button>
                      <button onClick={() => setEditing(null)} className="text-gray-400 hover:underline">取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-medium text-slate-700 truncate">{rule.title}</div>
                    <div className="text-gray-500 mt-0.5">{rule.content}</div>
                  </>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => { setEditing(rule.id); setEditForm({ title: rule.title, content: rule.content, category: rule.category }); }}
                  className="text-gray-400 hover:text-gray-600 text-[10px]">编辑</button>
                <button onClick={() => deleteMutation.mutate({ novelId, ruleId: rule.id })}
                  className="text-red-400 hover:text-red-600 text-[10px]">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-lg w-80 p-4" onClick={e => e.stopPropagation()}>
            <h4 className="text-sm font-semibold mb-3">添加世界规则</h4>
            <select value={editForm.category} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
              className="w-full mb-2 px-2 py-1.5 border rounded text-xs">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
              placeholder="规则标题" className="w-full mb-2 px-2 py-1.5 border rounded text-xs" />
            <input value={editForm.content} onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))}
              placeholder="规则内容（10-50字）" className="w-full mb-3 px-2 py-1.5 border rounded text-xs" />
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-1.5 text-xs border rounded-lg">取消</button>
              <button onClick={handleCreate} disabled={!editForm.title || !editForm.content}
                className="flex-1 py-1.5 text-xs bg-slate-800 text-white rounded-lg disabled:opacity-50">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
