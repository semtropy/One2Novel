import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, BookOpen, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { useNovels, useCreateNovel } from "../api/novel";
import { api } from "../app/api";
import { useQueryClient } from "@tanstack/react-query";

export function NovelsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: novels, isLoading, error } = useNovels();
  const createNovel = useCreateNovel();

  async function handleCreate() {
    setCreating(true);
    try {
      const novel = await createNovel.mutateAsync({ title: "未命名小说" });
      qc.invalidateQueries({ queryKey: ["novels"] });
      navigate(`/novels/${novel.id}`);
    } catch {} finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try { await api.delete(`/novels/${deleteId}`); qc.invalidateQueries({ queryKey: ["novels"] }); } catch {}
    setDeleteId(null);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">我的小说</h2>
        <button onClick={handleCreate} disabled={creating}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {creating ? "创建中..." : "新建小说"}
        </button>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-sm text-slate-400">加载中...</div>
      ) : error ? (  // M5: error state
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-300 bg-red-50/50 py-20">
          <AlertTriangle size={40} className="mb-4 text-red-400" />
          <h3 className="mb-2 text-sm font-medium text-red-600">加载失败</h3>
          <p className="mb-4 text-xs text-red-400">{(error as Error)?.message ?? "请检查网络连接后重试"}</p>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">重新加载</button>
        </div>
      ) : (!novels || novels.length === 0) ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-20">
          <BookOpen size={40} className="mb-4 text-slate-300" />
          <h3 className="mb-2 text-sm font-medium text-slate-600">还没有小说</h3>
          <p className="mb-4 text-xs text-slate-400">从一句灵感开始你的创作之旅</p>
          <button onClick={handleCreate} disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {creating ? "创建中..." : "创建第一本小说"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {novels.map((novel) => {
            const tags = (() => { try { const t = JSON.parse(novel.commercialTags ?? "[]"); return Array.isArray(t) ? t.slice(0, 4) : []; } catch { return []; } })();
            return (
              <div key={novel.id}
                className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => navigate(`/novels/${novel.id}`)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-slate-800">{novel.title}</h3>
                    {novel.genre && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{novel.genre}</span>}
                  </div>
                  {novel.description && <p className="text-sm text-slate-500 line-clamp-2 mb-2">{novel.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>{new Date(novel.updatedAt).toLocaleDateString("zh-CN")} 更新</span>
                    {novel.projectStatus && <span>{novel.projectStatus === "completed" ? "已完成" : novel.projectStatus === "in_progress" ? "创作中" : "未开始"}</span>}
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tags.map((t: string, i: number) => (<span key={i} className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600">{t}</span>))}
                    </div>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setDeleteId(novel.id); }}
                  className="shrink-0 rounded-lg p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteId(null)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-full bg-red-100 p-2"><Trash2 size={18} className="text-red-600" /></div>
              <div><h3 className="text-sm font-semibold text-slate-800">删除小说</h3><p className="text-xs text-slate-500">此操作不可撤销</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleDelete} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
