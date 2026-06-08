import { Sparkles, RefreshCw, Plus, X, GitGraph, XCircle } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovel, useGenerateCharacters, type NovelCharacter } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";
import RelationshipGraphModal from "../workspace/RelationshipGraphModal";

interface Props { novelId: string }

const ROLE_LABELS: Record<string, string> = { protagonist: "主角", antagonist: "对手", supporting: "配角", minor: "次要" };
const FIELD_META: Array<{ key: string; label: string; rows: number }> = [
  { key: "name", label: "姓名", rows: 1 },
  { key: "identityLabel", label: "身份", rows: 1 },
  { key: "appearance", label: "外貌", rows: 1 },
  { key: "quirks", label: "习惯动作", rows: 1 },
  { key: "currentStatus", label: "当前状态", rows: 1 },
  { key: "background", label: "背景", rows: 1 },
  { key: "personality", label: "性格", rows: 1 },
  { key: "currentGoal", label: "目标", rows: 1 },
  { key: "voiceTexture", label: "说话风格", rows: 1 },
  { key: "prohibitions", label: "行事底线", rows: 1 },
];

export function CharacterPanel({ novelId }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const gen = useGenerateCharacters();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<NovelCharacter | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("supporting");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [genError, setGenError] = useState("");


  type DraftChar = { id: string; name: string; role: string; personality?: string | null; background?: string | null; appearance?: string | null; quirks?: string | null; currentStatus?: string | null; currentGoal?: string | null; voiceTexture?: string | null; identityLabel?: string | null; prohibitions?: string | null; synced: boolean };
  const draftChars: DraftChar[] = ((novel as unknown) as { draftCharacters?: DraftChar[] } | undefined)?.draftCharacters ?? [];
  const chars: Array<NovelCharacter & { relations_source?: unknown[]; relations_target?: unknown[] }> = draftChars.map(dc => ({
    id: dc.id, novelId, name: dc.name, role: dc.role,
    personality: dc.personality ?? null, background: dc.background ?? null,
    appearance: dc.appearance ?? null, quirks: dc.quirks ?? null,
    currentGoal: dc.currentGoal ?? null, currentStatus: dc.currentStatus ?? null,
    voiceTexture: dc.voiceTexture ?? null, identityLabel: dc.identityLabel ?? null,
    prohibitions: dc.prohibitions ?? null,
  }) as unknown as NovelCharacter & { relations_source?: unknown[]; relations_target?: unknown[] });

  async function saveField(charId: string, key: string, value: string) {
    try {
      await api.patch(`/novels/${novelId}/draft-characters/${charId}`, { [key]: value });
      refetch();
      qc.invalidateQueries({ queryKey: ["confirmation-status", novelId] });
    } catch {}
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post(`/novels/${novelId}/draft-characters`, { name: newName.trim(), role: newRole });
      setNewName(""); setNewRole("supporting"); setIsCreating(false);
      refetch();
      qc.invalidateQueries({ queryKey: ["confirmation-status", novelId] });
    } catch {} finally { setCreating(false); }
  }

  function openCreate() { setIsCreating(true); setNewName(""); setNewRole("supporting"); }
  function openEdit(char: NovelCharacter) { setSelected(char); setIsCreating(false); }
  function closePopup() { setSelected(null); setIsCreating(false); }

  const popupChar = isCreating ? null : selected;

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">角色阵容</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => { setGenError(""); gen.mutate(novelId, { onError: (e) => setGenError(e instanceof Error ? e.message : "生成失败，请重试") }); }} disabled={gen.isPending}
            className={cn("rounded-lg px-3 py-1.5 text-xs", chars.length > 0 ? "border border-slate-200 text-slate-600 hover:bg-slate-50" : "bg-slate-800 text-white hover:bg-slate-700")}>
            {gen.isPending ? <RefreshCw size={13} className="animate-spin" /> : "AI生成"}
          </button>
          {genError && <span className="text-xs text-red-500 flex items-center gap-1"><XCircle size={11} />{genError.slice(0, 80)}</span>}
          {chars.length > 0 && <button onClick={() => setShowGraph(true)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><GitGraph size={11} className="inline mr-1" />关系图</button>}
        </div>
      </div>

      {/* Cards or empty state */}
      {chars.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {chars.map((char) => (
            <div key={char.id}
              onClick={() => openEdit(char)}
              className="group rounded-lg border border-slate-100 bg-white p-3 hover:border-slate-200 cursor-pointer h-12 flex flex-col justify-start">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                  char.role === "protagonist" ? "bg-amber-100 text-amber-700" :
                  char.role === "antagonist" ? "bg-red-100 text-red-700" :
                  "bg-slate-100 text-slate-600")}>{ROLE_LABELS[char.role] ?? char.role}</span>
                <span className="text-sm font-medium text-slate-800 shrink-0">{char.name}</span>
                {char.background && <span className="text-xs text-slate-400 truncate flex-1 min-w-0">· {char.background}</span>}
                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(char.id); }}
                  className="shrink-0 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
          <button onClick={openCreate}
            className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-100 hover:border-slate-400 transition-colors text-slate-400 hover:text-slate-600 h-12">
            <Plus size={20} />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={openCreate}
            className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-100 hover:border-slate-400 transition-colors text-slate-400 hover:text-slate-600 h-12">
            <Plus size={20} />
          </button>
        </div>
      )}

      {/* Unified Popup: Create or Edit */}
      {(selected || isCreating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closePopup}>
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              {isCreating ? (
                <h3 className="text-lg font-bold text-slate-900">添加角色</h3>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={cn("rounded px-2 py-0.5 text-sm font-medium",
                    selected!.role === "protagonist" ? "bg-amber-100 text-amber-700" :
                    selected!.role === "antagonist" ? "bg-red-100 text-red-700" :
                    "bg-slate-100 text-slate-600")}>{ROLE_LABELS[selected!.role] ?? selected!.role}</span>
                  <h3 className="text-lg font-bold text-slate-900">{selected!.name}</h3>
                </div>
              )}
              <button onClick={closePopup} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">关闭</button>
            </div>

            {/* Create mode — name + role */}
            {isCreating && (
              <div className="mb-4 flex items-end gap-2">
                <div className="flex-1">
                  <div className="text-xs text-slate-500 font-medium mb-1">姓名</div>
                  <input autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                    value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                    placeholder="角色名" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 font-medium mb-1">身份</div>
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                    value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                  </select>
                </div>
                <button onClick={handleCreate} disabled={creating || !newName.trim()}
                  className="shrink-0 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
                  {creating ? "创建中..." : "创建"}
                </button>
              </div>
            )}

            {/* Always-editable fields (edit mode only) */}
            {!isCreating && (
              <div className="space-y-2.5">
                {FIELD_META.map(({ key, label, rows }) => (
                  <EditableField key={key}
                    label={label}
                    value={((selected as unknown) as Record<string, unknown>)[key] as string ?? ""}
                    rows={rows}
                    onSave={(v) => saveField(selected!.id, key, v)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteConfirm(null)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">删除角色</h3>
            <p className="text-xs text-slate-500 mb-4">此操作不可撤销，确认删除？</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={async () => { await api.delete(`/novels/${novelId}/draft-characters/${deleteConfirm}`); setDeleteConfirm(null); refetch(); qc.invalidateQueries({ queryKey: ["confirmation-status", novelId] }); }} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Relationship Graph modal */}
      {showGraph && <RelationshipGraphModal novelId={novelId} onClose={() => setShowGraph(false)} />}
    </div>
  );
}

// ─── Always-editable field with auto-save on blur ─────

function EditableField({ label, value, rows = 1, onSave }: {
  label: string; value: string; rows?: number; onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {rows > 1 ? (
        <textarea
          className="w-full mt-0.5 rounded border border-slate-100 bg-slate-50 p-2 text-sm resize-none focus:border-slate-300 focus:bg-white focus:outline-none"
          rows={rows} value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) onSave(local); }}
          placeholder="未设置"
        />
      ) : (
        <input
          className="w-full mt-0.5 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm focus:border-slate-300 focus:bg-white focus:outline-none"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) onSave(local); }}
          placeholder="未设置"
        />
      )}

    </div>
  );
}

