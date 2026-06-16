import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useNovel } from "../api/novel";
import { api } from "../app/api";
import { useQueryClient } from "@tanstack/react-query";
import { NextChapterPreview } from "../components/workspace/NextChapterPreview";
import { PlanningQuickDrawer } from "../components/workspace/PlanningQuickDrawer";
import { ChapterWritePanel } from "../components/workspace/ChapterWritePanel";
import { ContextPanel } from "../components/workspace/ContextPanel";
import { type WorkspaceDiagnosis } from "../api/revision";
import { ProgressBar } from "../components/novel/ProgressBar";
import { DirectorPanel } from "../components/workspace/DirectorPanel";
import { TitleEditor } from "../components/novel/TitleEditor";
import { Loading } from "../components/common/Loading";
import { AlertTriangle, PenLine, Download, Trash2, Plus, ShieldCheck } from "lucide-react";
import { useCompletionReadiness } from "../api/novel";
import ExportDialog from "../components/workspace/ExportDialog";
import { cn } from "../lib/cn";

export function NovelWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const { data: novel, isLoading, error } = useNovel(novelId);
  const qc = useQueryClient();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  // ─── Review + Diagnosis state (lifted from ChapterWritePanel) ───
  const [quality, setQuality] = useState<Record<string, unknown> | null>(null);
  const [diagnosis, setDiagnosis] = useState<WorkspaceDiagnosis | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Clear review data when switching chapters
  useEffect(() => {
    setQuality(null);
    setDiagnosis(null);
  }, [selectedChapterId]);


  async function handleDeleteChapter() {
    if (!deleteChapterId) return;
    try { await api.delete(`/novels/${novelId}/chapters/${deleteChapterId}`); qc.invalidateQueries({ queryKey: ["novel", novelId] }); setSelectedChapterId(null); } catch {}
    setDeleteChapterId(null);
  }

  // ─── Review + Diagnose (one-click from toolbar) ───
  async function handleReview() {
    if (!novelId || !selectedChapterId || reviewing) return;
    setReviewing(true); setQuality(null); setDiagnosis(null);
    try {
      const { data: r } = await api.post(`/novels/${novelId}/chapters/${selectedChapterId}/review`);
      setQuality(r.data as Record<string, unknown>);
    } catch (e) { console.error("Review failed:", e); setReviewing(false); return; }
    try {
      const { data: d } = await api.post(`/novels/${novelId}/chapters/${selectedChapterId}/diagnose`);
      setDiagnosis(d.data as WorkspaceDiagnosis);
    } catch (e) { console.error("Diagnose failed:", e); }
    finally { setReviewing(false); qc.invalidateQueries({ queryKey: ["novel", novelId] }); }
  }

  // ALL hooks MUST be before any conditional returns (React rule)
  const { data: completionReadiness } = useCompletionReadiness(novelId);
  const allChapters = novel?.chapters ?? [];

  type ChapterWithVol = { id: string; order: number; title: string; content?: string | null; chapterStatus: string; chapterOrder: number };
  const volumeGroups = useMemo(() => {
    if (!novel) return [];
    const vols = novel.volumes?.filter(v => v.chapterPlans.some(p => p.chapterId));
    if (!vols || vols.length === 0) return [{ sortOrder: 1, title: "章节", chapters: allChapters.map(c => ({ ...c, chapterOrder: c.order })) }];

    const groups: Array<{ sortOrder: number; title: string; chapters: ChapterWithVol[] }> = [];
    const assigned = new Set<string>();
    for (const v of vols) {
      const chs = v.chapterPlans
        .filter(p => p.chapterId)
        .map(p => {
          const ch = allChapters.find(c => c.id === p.chapterId);
          return ch ? { ...ch, chapterOrder: p.chapterOrder } : null;
        })
        .filter(Boolean) as ChapterWithVol[];
      chs.forEach(c => assigned.add(c.id));
      groups.push({ sortOrder: v.sortOrder, title: v.title, chapters: chs });
    }
    // Leftover chapters — append to last volume, assign sequential chapterOrders
    const leftovers = allChapters.filter(c => !assigned.has(c.id));
    if (leftovers.length > 0 && groups.length > 0) {
      const last = groups[groups.length - 1];
      const startOrder = (last.chapters[last.chapters.length - 1]?.chapterOrder ?? 0) + 1;
      leftovers.forEach((c, i) => last.chapters.push({ ...c, chapterOrder: startOrder + i }));
    } else if (leftovers.length > 0) {
      groups.push({ sortOrder: 1, title: "章节", chapters: leftovers.map((c, i) => ({ ...c, chapterOrder: i + 1 })) });
    }
    if (groups.length === 0) groups.push({ sortOrder: 1, title: "章节", chapters: allChapters.map((c, i) => ({ ...c, chapterOrder: i + 1 })) });
    return groups;
  }, [novel, allChapters]);


  const selectedChapter = allChapters.find((c) => c.id === selectedChapterId);

  const totalWords = useMemo(() => {
    return allChapters.reduce((sum, c) => sum + (c.content ? c.content.replace(/<[^>]*>/g, "").length : 0), 0);
  }, [allChapters]);

  // Early returns AFTER all hooks
  if (isLoading) return <Loading text="加载中..." />;
  if (error || !novel) return (
    <div className="flex flex-col items-center py-20"><AlertTriangle size={40} className="mb-4 text-accent-500" /><p className="text-sm text-red-500">加载失败</p></div>
  );

  return (
    <div className="flex flex-col h-full max-h-full">
      {/* Dialogs */}
      {showExport && <ExportDialog novelId={novel.id} onClose={() => setShowExport(false)} />}

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <TitleEditor novelId={novel.id} currentTitle={novel.title} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            {novel.genre && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{novel.genre}</span>}
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-600 font-medium">长篇</span>
            <span className="text-xs text-slate-400">全书 {totalWords.toLocaleString()} 字</span>
            <span className="text-xs text-slate-300">|</span>
            <span className="text-xs text-slate-400">{allChapters.filter(c => c.chapterStatus === "completed").length}/{allChapters.length} 章</span>
            {completionReadiness && (
              <>
                <span className="text-xs text-slate-300">|</span>
                <span className={cn(
                  "text-xs font-medium",
                  completionReadiness.readyToComplete ? "text-green-500" :
                  (completionReadiness.progressPercent ?? 0) >= 80 ? "text-accent-500" :
                  "text-slate-400",
                )} title={`待回收伏笔: ${completionReadiness.unresolvedCount} · ${completionReadiness.recommendations?.join("；") ?? ""}`}>
                  {completionReadiness.readyToComplete ? "可完本" :
                   (completionReadiness.progressPercent ?? 0) >= 80 ? "接近完本" :
                   `${completionReadiness.totalChapters}章已完成`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <ProgressBar steps={(() => {
            const hasCore = !!(novel.storySummary || novel.centralQuestion);
            const hasChars = (novel.characters?.length ?? 0) > 0;
            const hasOutline = !!novel.structuredOutline;
            const hasWritten = allChapters.some(c => c.chapterStatus === "completed");
            const allDone = allChapters.length > 0 && allChapters.every(c => c.chapterStatus === "completed");
            return [
              { key: "core", label: "核心", done: hasCore, current: !hasCore },
              { key: "chars", label: "角色", done: hasChars, current: hasCore && !hasChars },
              { key: "outline", label: "大纲", done: hasOutline, current: hasChars && !hasOutline },
              { key: "writing", label: "写作", done: hasWritten, current: hasOutline && !hasWritten },
              { key: "done", label: "完本", done: allDone, current: false },
            ];
          })()} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExport(true)} className="flex items-center gap-1 rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-700"><Download size={13} />导出</button>
        </div>
      </div>

      {/* Writing workspace */}
      <div className="flex-1 flex gap-4 min-h-0">
          {/* Left: Chapter list with volume word counts */}
          <div className="w-48 shrink-0 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 rounded-xl border border-slate-200 bg-white flex flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase">章节</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
              {volumeGroups.length === 0 || volumeGroups.every(v => v.chapters.length === 0) ? (
                <p className="px-2 py-8 text-xs text-slate-400 text-center">暂无章节</p>
              ) : (<>
                {volumeGroups.map((vol) => (
                <div key={vol.sortOrder}>
                  <div className="px-2 py-0.5 text-xs font-medium text-slate-400 flex justify-between group/volh">
                    <span className="truncate">{vol.title}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        try { await api.post(`/novels/${novelId}/volumes/${vol.sortOrder}/chapters`); qc.invalidateQueries({ queryKey: ["novel", novelId] }); } catch {}
                      }}
                        className="text-slate-400 hover:text-blue-500 opacity-60 hover:opacity-100 transition-opacity" title="新增章节">
                        <Plus size={12} />
                      </button>
                      <button onClick={async () => {
                        if (window.confirm(`删除"${vol.title}"及其所有章节？`)) {
                          try { await api.delete(`/novels/${novelId}/volumes/${vol.sortOrder}`); qc.invalidateQueries({ queryKey: ["novel", novelId] }); } catch {}
                        }
                      }} className="text-slate-300 hover:text-red-500 opacity-60 hover:opacity-100 transition-opacity"><Trash2 size={11} /></button>
                    </div>
                  </div>
                  {vol.chapters.map((ch) => (
                    <button key={ch.id} onClick={() => setSelectedChapterId(ch.id)}
                      className={cn("group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm", selectedChapterId === ch.id ? "bg-slate-200 text-slate-800 font-medium" : "text-slate-600 hover:bg-slate-50")}>
                      <span className="shrink-0 w-5 text-center text-xs opacity-60">{ch.chapterOrder}</span>
                      <span className="truncate flex-1">{ch.title || "无标题"}</span>
                      {ch.chapterStatus === "completed" && <span className="shrink-0 w-4 h-4 rounded-full bg-green-100 text-green-600 text-xs flex items-center justify-center">✓</span>}
                      {ch.chapterStatus === "drafted" && <span className="shrink-0 w-4 h-4 rounded-full bg-yellow-100 text-yellow-600 text-xs flex items-center justify-center">○</span>}
                      {ch.chapterStatus === "needs_repair" && <span className="shrink-0 w-4 h-4 rounded-full bg-red-100 text-red-600 text-xs flex items-center justify-center">×</span>}
                      <button onClick={(e) => {
                        e.stopPropagation();
                        if (ch.content && ch.content.replace(/<[^>]*>/g, "").trim().length > 50) {
                          setDeleteChapterId(ch.id);
                        } else {
                          api.delete(`/novels/${novelId}/chapters/${ch.id}`).then(() => qc.invalidateQueries({ queryKey: ["novel", novelId] })).catch(() => {});
                        }
                      }}
                        className="shrink-0 text-slate-400 hover:text-red-500 opacity-60 hover:opacity-100 transition-opacity ml-1"
                        title={ch.content && ch.content.replace(/<[^>]*>/g, "").trim().length > 50 ? "删除（有内容，需确认）" : "删除空章节"}>
                        <Trash2 size={12} />
                      </button>
                    </button>
                  ))}
                </div>
              ))}
              <div className="pt-1 border-t border-slate-100">
                <button onClick={async () => {
                  try { await api.post(`/novels/${novelId}/volumes/active`); qc.invalidateQueries({ queryKey: ["novel", novelId] }); } catch {}
                }}
                  className="w-full rounded-md border border-dashed border-slate-200 px-2 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-500">+ 新增卷</button>
              </div>
            </>)}
            </div>
          </div>
          </div>

          {/* Center: Editor + Bottom Panel */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-3">
            {/* Editor */}
            <div className="flex-1 min-h-0 flex flex-col">
              {selectedChapterId ? (
                <ChapterWritePanel novelId={novel.id} chapterId={selectedChapterId} reviewing={reviewing} onReview={handleReview} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 gap-4">
                  <PenLine size={32} className="text-slate-300" />
                  <p className="text-sm text-slate-500">选择左侧章节开始写作</p>
                  <DirectorPanel novelId={novel.id} compact />
                </div>
              )}
            </div>
            {/* Next Chapter Preview (when chapter is selected) */}
            {selectedChapterId && (
              <div className="shrink-0">
                <NextChapterPreview novelId={novel.id} chapterId={selectedChapterId} />
              </div>
            )}
          </div>

          {/* Right: Context Panel — toolbox grid */}
          <div className="w-56 shrink-0 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 rounded-xl border border-slate-200 bg-white overflow-y-auto p-3">
              <ContextPanel
                novelId={novel.id}
                chapterId={selectedChapterId ?? null}
                chapterTitle={selectedChapter?.title}
                chapterOrder={selectedChapter?.order}
                quality={quality as Record<string, number | string | Array<Record<string, string>>> | null}
                diagnosis={diagnosis}
                reviewing={reviewing}
                onReview={handleReview}
              />
            </div>
          </div>
        </div>

      {/* Planning quick-access drawer */}
      <PlanningQuickDrawer novelId={novel.id} onSwitchToPlanning={() => navigate(`/novels/${novel.id}/plan`)} />

      {/* Delete chapter confirmation */}
      {deleteChapterId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteChapterId(null)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">删除章节</h3>
            <p className="text-xs text-slate-500 mb-4">此操作不可撤销。删除后章节将从列表中移除。</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteChapterId(null)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">取消</button>
              <button onClick={handleDeleteChapter} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


