import { useEffect, useState } from "react";
import { Sparkles, Link, Unlink } from "lucide-react";
import { api } from "../../app/api";

interface Props { novelId: string }

export function StyleSelector({ novelId }: Props) {
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; category?: string }>>([]);
  const [bindings, setBindings] = useState<Array<{ id: string; styleProfileId: string; styleProfile?: { name: string } }>>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [p, b] = await Promise.all([
      api.get("/styles").then(r => r.data.data ?? []).catch(() => []),
      api.get(`/styles/bindings/novel/${novelId}`).then(r => r.data.data ?? []).catch(() => []),
    ]);
    setProfiles(p); setBindings(b);
  }

  useEffect(() => { load(); }, [novelId]);

  async function handleBind(profileId: string) {
    setLoading(true);
    try { await api.post(`/styles/${profileId}/bind`, { targetType: "novel", targetId: novelId }); await load(); } catch {} finally { setLoading(false); }
  }

  async function handleUnbind(bindingId: string) {
    setLoading(true);
    try { await api.delete(`/styles/${bindingId}/bind/${bindingId}`); await load(); } catch {} finally { setLoading(false); }
  }

  const boundProfileIds = bindings.map(b => b.styleProfileId);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">选择写法</h3>
        <span className="text-xs text-slate-400">在「写法引擎」中管理</span>
      </div>
      {profiles.length === 0 ? (
        <p className="text-xs text-slate-400">暂无写法配置，请先在「写法引擎」中创建</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {profiles.map((p) => {
            const bound = boundProfileIds.includes(p.id);
            return (
              <button key={p.id} disabled={loading} onClick={() => bound ? handleUnbind(bindings.find(b => b.styleProfileId === p.id)!.id) : handleBind(p.id)}
                className={"rounded-full px-2.5 py-1 text-xs transition-colors " + (bound ? "bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200" : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200")}>
                {bound ? <Unlink size={10} className="inline mr-1" /> : <Link size={10} className="inline mr-1" />}
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
