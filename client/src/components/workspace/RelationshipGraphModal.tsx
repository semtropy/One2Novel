import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import { useDraftRelationshipGraph, useUpsertDraftRelation, type RelationshipGraph } from "../../api/novel";
import { useNovel } from "../../api/novel";
import { api } from "../../app/api";

interface Props { novelId: string; onClose: () => void }

const TYPE_EMOJI: Record<string, string> = {
  friend: "🤝", enemy: "⚔️", lover: "💕", rival: "🥊", mentor: "👨‍🏫", family: "👪",
};
const TYPE_LABEL: Record<string, string> = {
  friend: "朋友", enemy: "敌人", lover: "恋人", rival: "竞争者", mentor: "导师", family: "家人",
};
const RELATION_TYPES = Object.keys(TYPE_LABEL);

export default function RelationshipGraphModal({ novelId, onClose }: Props) {
  const { data: relGraph } = useDraftRelationshipGraph(novelId);
  const upsertRel = useUpsertDraftRelation();
  const { data: novel } = useNovel(novelId);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newType, setNewType] = useState("friend");

  // Read from DraftCharacter (planning tab source of truth)
  const chars: Array<{ id: string; name: string }> =
    ((novel as unknown) as { draftCharacters?: Array<{ id: string; name: string }> }).draftCharacters ?? [];

  async function handleSave(edgeId: string, _field: string) {
    if (!editVal.trim()) { setEditing(null); return; }
    // For editing, we don't update inline — user can delete and re-add
    setEditing(null);
  }

  async function handleAdd() {
    if (!newSource || !newTarget) return;
    try {
      await upsertRel.mutateAsync({ novelId, sourceCharacterId: newSource, targetCharacterId: newTarget, type: newType });
      setAdding(false); setNewSource(""); setNewTarget(""); setNewType("friend");
    } catch {}
  }

  async function handleDelete(edgeId: string) {
    try { await api.delete(`/novels/${novelId}/draft-relations/${edgeId}`); } catch {}
  }

  if (!relGraph) return null;

  // ─── SVG constants ─────────
  const w = 280, h = 250, cx = w / 2, cy = h / 2;
  const angleStep = (2 * Math.PI) / Math.max(relGraph.nodes.length, 1);
  const radius = Math.min(w, h) / 2 - 40;
  const positions = relGraph.nodes.map((n, i) => ({
    ...n,
    x: cx + radius * Math.cos(i * angleStep - Math.PI / 2),
    y: cy + radius * Math.sin(i * angleStep - Math.PI / 2),
  }));
  const posMap = new Map(positions.map(p => [p.id, p]));
  const roleColor = (role: string) => role === "protagonist" ? "#f59e0b" : role === "antagonist" ? "#ef4444" : "#94a3b8";
  const edgeColor = (type: string, stage: string | null) => {
    if (stage === "conflicted" || type === "enemy" || type === "rival") return "#ef4444";
    if (type === "friend" || type === "lover" || stage === "allied") return "#22c55e";
    return "#94a3b8";
  };
  const edgeWidth = (stage: string | null) => stage === "conflicted" || stage === "estranged" ? 2 : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">角色关系图</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Body: left graph + right scrollable list */}
        <div className="flex gap-4 p-4 flex-1 min-h-0">
          {/* Left: SVG Graph — fixed, no scroll */}
          <div className="shrink-0 rounded-lg border border-slate-100 bg-slate-50/50 p-2 flex items-center justify-center" style={{ width: 300 }}>
            {relGraph.nodes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center">暂无角色数据</p>
            ) : (
              <svg width={w} height={h}>
                {/* Edges */}
                {relGraph.edges.map(e => {
                  const s = posMap.get(e.sourceId), t = posMap.get(e.targetId);
                  if (!s || !t) return null;
                  const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
                  return (
                    <g key={e.id}>
                      <line x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke={edgeColor(e.type, e.stage)} strokeWidth={edgeWidth(e.stage)} />
                      <text x={mx} y={my - 4} textAnchor="middle" fontSize="9" fill="#64748b">
                        {TYPE_EMOJI[e.type] ?? e.type}
                      </text>
                    </g>
                  );
                })}
                {/* Nodes */}
                {positions.map(p => (
                  <g key={p.id}>
                    <circle cx={p.x} cy={p.y} r={14} fill={roleColor(p.role)} stroke="white" strokeWidth={2} />
                    <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">
                      {p.name.charAt(0)}
                    </text>
                    <text x={p.x} y={p.y + 28} textAnchor="middle" fontSize="9" fill="#475569">{p.name}</text>
                  </g>
                ))}
              </svg>
            )}
          </div>

          {/* Right: Relationship List — scrollable */}
          <div className="flex-1 min-w-0 space-y-2 overflow-y-auto">
            {relGraph.edges.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">暂无关系数据</p>
            ) : (
              relGraph.edges.map(e => (
                <div key={e.id} className="rounded-lg border border-slate-100 p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{TYPE_EMOJI[e.type] ?? "🔗"}</span>
                      <span className="font-medium text-slate-700">{e.sourceName}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-medium text-slate-700">{e.targetName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditing(`${e.id}-tension`); setEditVal(e.attitudeSource || e.attitudeTarget || ""); }}
                        className="text-slate-300 hover:text-slate-500"><Pencil size={11} /></button>
                      <button onClick={() => setDeleteConfirm(deleteConfirm === e.id ? null : e.id)}
                        className="text-slate-300 hover:text-red-500"><X size={11} /></button>
                    </div>
                  </div>

                  {editing === `${e.id}-tension` ? (
                    <input autoFocus className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={editVal} onChange={e => setEditVal(e.target.value)}
                      onBlur={() => handleSave(e.id, "attitudeSource")}
                      onKeyDown={x => { if (x.key === "Enter") handleSave(e.id, "attitudeSource"); if (x.key === "Escape") setEditing(null); }}
                      placeholder="当前关系状态描述" />
                  ) : (
                    <div className="text-slate-500 space-y-0.5">
                      <div>
                        <span className="text-slate-400">{TYPE_LABEL[e.type] ?? e.type}</span>
                      </div>
                      {(e.attitudeSource || e.attitudeTarget) && (
                        <div className="text-slate-400 italic truncate">
                          {e.attitudeSource || e.attitudeTarget}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Add form */}
            {adding ? (
              <div className="rounded-lg border border-slate-200 p-2.5 text-xs space-y-2">
                <div className="flex gap-2">
                  <select className="flex-1 rounded border border-slate-200 px-2 py-1" value={newSource} onChange={e => setNewSource(e.target.value)}>
                    <option value="">选择源角色</option>
                    {chars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <span className="text-slate-400 self-center">→</span>
                  <select className="flex-1 rounded border border-slate-200 px-2 py-1" value={newTarget} onChange={e => setNewTarget(e.target.value)}>
                    <option value="">选择目标角色</option>
                    {chars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 items-end">
                  <select className="flex-1 rounded border border-slate-200 px-2 py-1" value={newType} onChange={e => setNewType(e.target.value)}>
                    {RELATION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                  <button onClick={handleAdd} className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700 text-xs">添加</button>
                  <button onClick={() => setAdding(false)} className="rounded border border-slate-200 px-3 py-1 text-slate-500 hover:bg-slate-50 text-xs">取消</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)}
                className="w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-2 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-500">
                <Plus size={12} />添加关系
              </button>
            )}
          </div>
        </div>

        {/* Delete confirm modal */}
        {deleteConfirm && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-xl z-10" onClick={() => setDeleteConfirm(null)}>
            <div className="rounded-xl bg-white p-6 shadow-lg border border-slate-200" onClick={e => e.stopPropagation()}>
              <p className="text-sm text-slate-700 mb-4">确认删除这条关系？</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
                <button onClick={() => { handleDelete(deleteConfirm); setDeleteConfirm(null); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">删除</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
