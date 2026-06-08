import { useState } from "react";
import { Pencil, Sparkles, RefreshCw, X } from "lucide-react";
import { api } from "../../app/api";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateNovel } from "../../api/novel";

interface Props { novelId: string; currentTitle: string }

export function TitleEditor({ novelId, currentTitle }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [suggestions, setSuggestions] = useState<Array<{ title: string; reason: string }>>([]);
  const [genning, setGennning] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const qc = useQueryClient();
  const update = useUpdateNovel();

  /** Load cached suggestions from React Query cache (no network call, no re-render risk) */
  function loadCached(): boolean {
    const novel = qc.getQueryData(["novel", novelId]) as { titleSuggestions?: string } | undefined;
    const cached = novel?.titleSuggestions;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSuggestions(parsed);
          return true;
        }
      } catch { /* invalid cache */ }
    }
    return false;
  }

  /** Show popup: use cache if available, otherwise generate */
  async function handleGenerate() {
    setShowSuggest(true);
    if (loadCached()) return;
    await doGenerate();
  }

  /** Force regeneration (bypass cache) */
  async function handleRegenerate() {
    await doGenerate();
  }

  async function doGenerate() {
    setGennning(true);
    try {
      const { data } = await api.post(`/novels/${novelId}/titles`);
      const newSuggestions = data.data.titles as Array<{ title: string; reason: string }>;
      setSuggestions(newSuggestions);
      const cacheKey = JSON.stringify(newSuggestions);
      await update.mutateAsync({ id: novelId, titleSuggestions: cacheKey });
      // Update cache in-place instead of invalidating (avoids clearing cache)
      qc.setQueryData(["novel", novelId], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return { ...(old as Record<string, unknown>), titleSuggestions: cacheKey };
      });
    } catch { /* error handled by inline display */ }
    finally { setGennning(false); }
  }

  async function pickTitle(t: string) {
    try { await update.mutateAsync({ id: novelId, title: t }); setTitle(t); setEditing(false); setShowSuggest(false); } catch {}
  }

  function handleSave() {
    if (title.trim() && title.trim() !== currentTitle) {
      try { update.mutate({ id: novelId, title: title.trim() }); } catch {}
    }
    setEditing(false);
  }

  return (
    <div className="relative">
      {editing ? (
        <div className="flex items-center gap-2">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTitle(currentTitle); setEditing(false); } }}
            className="text-lg font-bold text-slate-900 bg-white border border-slate-300 rounded px-2 py-0.5 w-64 focus:border-slate-400 focus:outline-none" />
          <button onMouseDown={(e) => { e.preventDefault(); handleGenerate(); }} disabled={genning}
            className="rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs text-purple-600 hover:bg-purple-100 flex items-center gap-1">
            <Sparkles size={12} />{genning ? "..." : "AI 起名"}
          </button>
        </div>
      ) : (
        <h1 className="text-lg font-bold text-slate-900 group flex items-center gap-2">
          <span className="cursor-pointer" onClick={() => { setTitle(currentTitle); setEditing(true); }}>{currentTitle}</span>
          <button onClick={() => { setTitle(currentTitle); setEditing(true); }}
            className="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
            <Pencil size={12} />
          </button>
          <button onMouseDown={(e) => { e.preventDefault(); handleGenerate(); }} disabled={genning}
            className="rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs text-purple-600 hover:bg-purple-100 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Sparkles size={12} />{genning ? "..." : "AI 起名"}
          </button>
        </h1>
      )}

      {showSuggest && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSuggest(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-500">AI 建议书名</h4>
              <div className="flex items-center gap-1">
                <button onClick={handleRegenerate} disabled={genning}
                  className="rounded border border-purple-200 px-2 py-0.5 text-xs text-purple-600 hover:bg-purple-50 flex items-center gap-1">
                  {genning ? <RefreshCw size={10} className="animate-spin" /> : <RefreshCw size={10} />}重新生成
                </button>
                <button onClick={() => setShowSuggest(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
              </div>
            </div>
            <div className="space-y-1.5">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => pickTitle(s.title)}
                className="w-full text-left rounded-lg border border-slate-100 p-2 hover:border-purple-200 hover:bg-purple-50 transition-colors">
                <div className="text-sm font-medium text-slate-800">{s.title}</div>
                <div className="text-xs text-slate-400">{s.reason}</div>
              </button>
            ))}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
