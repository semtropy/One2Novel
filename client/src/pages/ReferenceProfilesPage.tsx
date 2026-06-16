import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Plus, Trash2, GitBranch } from "lucide-react";
import { api } from "../app/api";

interface ProfileItem { id: string; name: string; architectureType?: string | null; totalChapters?: number | null; createdAt: string; }

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};

export function ReferenceProfilesPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const { data } = await api.get("/profiles"); setProfiles(data.data ?? []); } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`删除档案「${name}」？此操作不可撤销。`)) return;
    try { await api.delete(`/profiles/${id}`); load(); } catch {}
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">参考书档案</h2>
            <p className="text-xs text-slate-400 mt-1">分析结果独立保存，可被多本小说复用。</p>
          </div>
          <button onClick={() => navigate("/reference-profiles/new")}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            <Plus size={16} />新建档案
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-slate-400">加载中...</div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-20">
            <BookOpen size={40} className="mb-4 text-slate-300" />
            <h3 className="mb-2 text-sm font-medium text-slate-600">暂无参考书档案</h3>
            <p className="mb-4 text-xs text-slate-400">上传一本网络小说，AI 将分析其回环结构、爽点分布、写法技法</p>
            <button onClick={() => navigate("/reference-profiles/new")}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
              <Plus size={16} />新建档案
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map(p => (
              <div key={p.id}
                className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => navigate(`/reference-profiles/${p.id}`)}>
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <GitBranch size={18} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-slate-800">{p.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                    {p.architectureType && <span>{ARCH_LABELS[p.architectureType] ?? p.architectureType}</span>}
                    {p.totalChapters && <span>{p.totalChapters}章</span>}
                    <span>{new Date(p.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                  className="shrink-0 rounded-lg p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-60 hover:opacity-100 transition-all">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}