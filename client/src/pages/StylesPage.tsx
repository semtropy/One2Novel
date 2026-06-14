import { useState } from "react";
import { Sparkles, Trash2, Plus, FileText, RefreshCw, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";
import { useStyleProfiles, useCreateStyleProfile, useExtractStyle } from "../api/style";
import { api } from "../app/api";
import { useQueryClient } from "@tanstack/react-query";

const FIELD_ORDER = ["narrativeRules","languageRules","characterRules","rhythmRules","antiAiRules"] as const;
const FIELD_LABELS: Record<string, string> = { narrativeRules:"叙事", languageRules:"语言", characterRules:"角色", rhythmRules:"节奏", antiAiRules:"反AI" };

export function StylesPage() {
  const { data: profiles } = useStyleProfiles();
  const createProfile = useCreateStyleProfile();
  const extractStyle = useExtractStyle();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [addField, setAddField] = useState<string | null>(null);
  const [addVal, setAddVal] = useState("");
  const [editNameId, setEditNameId] = useState<string | null>(null);
  const [editNameVal, setEditNameVal] = useState("");

  async function handleDelete(id: string) {
    try { await api.delete(`/styles/${id}`); qc.invalidateQueries({ queryKey: ["styles"] }); } catch {}
  }

  async function handleSaveRule(profileId: string, field: string, index: number, text: string) {
    if (!text.trim()) { setEditKey(null); return; }
    try {
      await api.patch(`/styles/${profileId}/rules`, { field, index, text });
      qc.invalidateQueries({ queryKey: ["styles"] });
    } catch {}
    setEditKey(null);
  }

  async function handleAddRule(profileId: string, field: string) {
    if (!addVal.trim()) return;
    try {
      await api.post(`/styles/${profileId}/rules/add`, { field, text: addVal.trim() });
      qc.invalidateQueries({ queryKey: ["styles"] });
      setAddVal(""); setAddField(null);
    } catch {}
  }

  async function handleDeleteRule(profileId: string, field: string, index: number) {
    try {
      await api.delete(`/styles/${profileId}/rules/${index}?field=${field}`);
      qc.invalidateQueries({ queryKey: ["styles"] });
    } catch {}
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseRules(profile: any, field: string): string[] {
    try { const arr = JSON.parse((profile[field] as string) ?? "[]"); return Array.isArray(arr) ? arr : []; }
    catch { return []; }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">写法引擎</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"><Plus size={16} />新建写法</button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="写法名称（如：古龙风格）"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3 focus:border-slate-400 focus:outline-none" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴范文文本（至少 500 字）" rows={6}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3 resize-none focus:border-slate-400 focus:outline-none" />
          <div className="flex gap-2">
            <button onClick={() => { createProfile.mutate({ name, sourceText: text || undefined }); setName(""); setText(""); setShowCreate(false); }}
              disabled={!name.trim()} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">保存</button>
            <button onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">取消</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {(!profiles || profiles.length === 0) ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
            <FileText size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-500">暂无写法配置</p>
            <p className="text-xs text-slate-400 mt-1">上传范文让 AI 学习你的写作风格，然后在小说中绑定</p>
          </div>
        ) : profiles.map((p) => {
          const features = (() => { try { return p.extractedFeatures ? JSON.parse(p.extractedFeatures) : null; } catch { return null; } })();
          const isExpanded = expandedId === p.id;
          return (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setExpandedId(isExpanded ? null : p.id)} className="text-slate-400 hover:text-slate-600">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {editNameId === p.id ? (
                    <input autoFocus className="text-sm font-semibold text-slate-800 border-b border-indigo-300 px-1 py-0 outline-none"
                      value={editNameVal} onChange={e => setEditNameVal(e.target.value)}
                      onBlur={async () => { if (editNameVal.trim() && editNameVal !== p.name) { await api.patch(`/styles/${p.id}`, { name: editNameVal.trim() }); qc.invalidateQueries({ queryKey: ["styles"] }); } setEditNameId(null); }}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditNameId(null); }} />
                  ) : (
                    <span className="text-sm font-semibold text-slate-800 cursor-pointer hover:text-indigo-600"
                      onClick={() => { setEditNameId(p.id); setEditNameVal(p.name); }}>
                      {p.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {p.sourceText && !p.extractedFeatures && (
                    <button onClick={() => extractStyle.mutate(p.id)} disabled={extractStyle.isPending}
                      className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100">
                      {extractStyle.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}提取特征
                    </button>
                  )}
                  <button onClick={() => handleDelete(p.id)} className="rounded p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>
              {features?.overallDescription && <p className="text-xs text-slate-500 mb-2">{features.overallDescription}</p>}
              {!isExpanded && features && (
                <div className="flex flex-wrap gap-1">
                  {[...(features.narrativeRules ?? []), ...(features.languageRules ?? []), ...(features.characterRules ?? [])].slice(0, 6).map((r: string, i: number) => (
                    <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{r}</span>
                  ))}
                </div>
              )}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  {FIELD_ORDER.map(field => {
                    const rules = parseRules(p, field);
                    return (
                      <div key={field}>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-xs font-medium text-slate-500 w-8">{FIELD_LABELS[field]}</span>
                          <button onClick={() => { setAddField(field); setAddVal(""); }}
                            className="text-slate-300 hover:text-indigo-500"><Plus size={10} /></button>
                        </div>
                        {rules.length > 0 ? (
                          <div className="space-y-1 ml-8">
                            {rules.map((r: string, i: number) => (
                              <div key={i} className="flex items-start gap-1 group">
                                {editKey === `${field}:${i}` ? (
                                  <input autoFocus className="flex-1 rounded border border-indigo-200 px-1.5 py-0.5 text-xs"
                                    value={editVal} onChange={e => setEditVal(e.target.value)}
                                    onBlur={() => handleSaveRule(p.id, field, i, editVal)}
                                    onKeyDown={e => { if (e.key === "Enter") handleSaveRule(p.id, field, i, editVal); if (e.key === "Escape") setEditKey(null); }} />
                                ) : (
                                  <>
                                    <span className="flex-1 text-xs text-slate-600">{r}</span>
                                    <button onClick={() => { setEditKey(`${field}:${i}`); setEditVal(r); }}
                                      className="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 shrink-0"><Pencil size={10} /></button>
                                    <button onClick={() => handleDeleteRule(p.id, field, i)}
                                      className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0"><X size={10} /></button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-xs text-slate-300 italic ml-8">暂无</p>}
                        {addField === field && (
                          <div className="flex gap-1 ml-8 mt-1">
                            <input autoFocus className="flex-1 rounded border border-indigo-200 px-1.5 py-0.5 text-xs"
                              value={addVal} onChange={e => setAddVal(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") handleAddRule(p.id, field); if (e.key === "Escape") setAddField(null); }}
                              placeholder="新规则" />
                            <button onClick={() => handleAddRule(p.id, field)} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">添加</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
