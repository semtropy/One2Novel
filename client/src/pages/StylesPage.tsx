import { useState } from "react";
import { Sparkles, Trash2, Plus, FileText, RefreshCw } from "lucide-react";
import { useStyleProfiles, useCreateStyleProfile, useExtractStyle } from "../api/style";
import { api } from "../app/api";
import { useQueryClient } from "@tanstack/react-query";

export function StylesPage() {
  const { data: profiles } = useStyleProfiles();
  const createProfile = useCreateStyleProfile();
  const extractStyle = useExtractStyle();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  async function handleDelete(id: string) {
    try { await api.delete(`/styles/${id}`); qc.invalidateQueries({ queryKey: ["styles"] }); } catch {}
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
          return (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <div><span className="text-sm font-semibold text-slate-800">{p.name}</span><span className="ml-2 text-xs text-slate-400">{p.category}</span></div>
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
              {features && (
                <div className="flex flex-wrap gap-1">
                  {[...(features.narrativeRules ?? []), ...(features.languageRules ?? []), ...(features.characterRules ?? [])].slice(0, 6).map((r: string, i: number) => (
                    <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{r}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
