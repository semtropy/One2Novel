import { useState, useRef, useCallback, useEffect } from "react";
import { RefreshCw, XCircle, Play, Save, X, Undo2, ChevronDown } from "lucide-react";
import { api } from "../../app/api";
import { useNovel } from "../../api/novel";
import { type RevisionOperation } from "../../api/revision";
import { ChapterEditor } from "./ChapterEditor";
import { FakeProgress } from "../common/FakeProgress";
import { RevisionToolbar } from "./RevisionToolbar";
import { RevisionWorkbench } from "./RevisionWorkbench";
import { cn } from "../../lib/cn";

interface Props { novelId: string; chapterId: string; reviewing: boolean; onReview: () => void }

interface AiDetectionResult {
  hits: Array<{ code: string; category: string; severity: string; description: string; suggestion: string }>;
  score: number;
  summary: string;
}

export function ChapterWritePanel({ novelId, chapterId, reviewing, onReview }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [showAutoWrite, setShowAutoWrite] = useState(false);
  const [autoCount, setAutoCount] = useState(1);
  const [aiDetection, setAiDetection] = useState<AiDetectionResult | null>(null);
  const [autoState, setAutoState] = useState<{ chapter: number; total: number; running: boolean; label: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [showGenerateMenu, setShowGenerateMenu] = useState(false);

  // ─── Revision state ──────────────────────────────────
  const [selectedParagraphs, setSelectedParagraphs] = useState<string[]>([]);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [revisionOp, setRevisionOp] = useState<RevisionOperation | null>(null);

  const handleParagraphSelect = useCallback((paras: string[], pos?: { top: number; left: number }) => {
    setSelectedParagraphs(paras);
    if (paras.length > 0 && pos) {
      // M4: clamp toolbar position to viewport
      setToolbarPos({ top: Math.max(60, pos.top - 260), left: Math.max(10, Math.min(pos.left, window.innerWidth - 300)) });
      setShowToolbar(true);
    } else {
      setShowToolbar(false);
    }
  }, []);

  const handleRevisionOperation = useCallback((op: RevisionOperation) => {
    if (!selectedParagraphs.length) return;
    setShowToolbar(false);
    setRevisionOp(op);
  }, [selectedParagraphs]);

  const handleRevisionApply = useCallback(async (paragraphs: string[], replacement: string) => {
    await api.post(`/novels/${novelId}/chapters/${chapterId}/revision/apply`, {
      selectedParagraphs: paragraphs,
      replacementText: replacement,
    });
    setRevisionOp(null);
    refetch();
  }, [novelId, chapterId, refetch]);

  const chapters: Array<{ id: string; order: number; title: string; content?: string; chapterStatus: string }> =
    ((novel as unknown) as { chapters?: Array<{ id: string; order: number; title: string; content?: string; chapterStatus: string }> }).chapters ?? [];
  const chapter = chapters.find((c) => c.id === chapterId);
  // Reset state when chapter changes
  useEffect(() => {
    setContent("");
    setTitle("");
    setAiGenerated(false);
    setAiDetection(null);
    setError("");
    setSavedContent(chapter?.content ?? "");
  }, [chapterId]);

  const displayContent = content || chapter?.content || "";
  const hasContent = displayContent.replace(/<[^>]*>/g, "").trim().length > 50;

  const displayTitle = title || chapter?.title || "";
  const wordCount = displayContent.replace(/<[^>]*>/g, "").length;
  const isDirty = displayContent !== savedContent;

  useEffect(() => {
    if (!generating && displayContent) {
      const t = setTimeout(async () => {
        try { await api.patch(`/novels/${novelId}/chapters/${chapterId}`, { content: displayContent }); setSaved(true); setTimeout(() => setSaved(false), 1500); } catch {}
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [displayContent]);

  // H5: Cleanup EventSource on unmount
  useEffect(() => () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  function handleGenerate() {
    setGenerating(true); setStage(""); setError(""); setContent(""); setAiGenerated(false);
    api.post(`/novels/${novelId}/director/run`, { maxChapters: 1 }).catch(() => {});
    const es = new EventSource(`/api/novels/${novelId}/director/stream`);
    eventSourceRef.current = es;
    es.addEventListener("token", (e) => {
      const d = JSON.parse(e.data);
      setContent((p) => p + d.text);
    });
    es.addEventListener("done", () => {
      es.close(); eventSourceRef.current = null;
      setGenerating(false); setAiGenerated(true); refetch();
    });
    es.addEventListener("error", (e) => {
      es.close(); eventSourceRef.current = null; setGenerating(false);
      try { const d = JSON.parse((e as MessageEvent).data); setError(d.message); } catch { setError("生成失败"); }
    });
  }

  const handleSave = useCallback(async () => {
    try { await api.patch(`/novels/${novelId}/chapters/${chapterId}`, { content: displayContent, title: displayTitle }); setSavedContent(displayContent); setSaved(true); setTimeout(() => setSaved(false), 1500); refetch(); } catch {}
  }, [novelId, chapterId, displayContent, displayTitle, refetch]);

  const handleSaveTitle = useCallback(async () => {
    try { await api.patch(`/novels/${novelId}/chapters/${chapterId}`, { title: displayTitle }); refetch(); } catch {}
  }, [novelId, chapterId, displayTitle, refetch]);

  const handleAutoWrite = useCallback(async () => {
    setShowAutoWrite(false); setError("");
    setAutoState({ chapter: 1, total: autoCount, running: true, label: `第 1 章 / 共 ${autoCount} 章` });
    await api.post(`/novels/${novelId}/director/run`, { maxChapters: autoCount }).catch(() => {});
    const es = new EventSource(`/api/novels/${novelId}/director/stream`);
    eventSourceRef.current = es;  // H5: track for cleanup
    let ch = 1;
    es.addEventListener("chapter", (e) => {
      const d = JSON.parse(e.data);
      ch++;
      refetch();
      setAutoState(prev => prev ? { ...prev, running: false } : null);
      setTimeout(() => {
        setAutoState(prev => prev ? { chapter: ch, total: d.total, running: true, label: `第 ${ch} 章 / 共 ${d.total} 章` } : null);
      }, 100);
    });
    es.addEventListener("token", (e) => {
      const d = JSON.parse(e.data);
      const chOrder = chapters.find(c => c.id === chapterId)?.order;
      if (chOrder === d.chapterOrder) {
        setContent(prev => prev + d.text);
      }
    });
    es.addEventListener("done", () => {
      es.close(); eventSourceRef.current = null; refetch();
      setAutoState(prev => prev ? { ...prev, running: false } : null);
      setTimeout(() => setAutoState(null), 1500);
    });
    es.addEventListener("error", (e) => {
      es.close(); eventSourceRef.current = null; setAutoState(null);
      try { const d = JSON.parse((e as MessageEvent).data); setError(d.message); } catch {}
    });
  }, [novelId, refetch, autoCount]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">第{chapter?.order ?? "?"}章</span>
          <span className="text-xs text-slate-300">{wordCount}字</span>
          {saved && <span className="text-xs text-green-500">已保存</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Generate dropdown — single chapter (default click) or batch (dropdown) */}
          <div className="relative">
            <div className="flex rounded-md border border-purple-300 bg-purple-50 overflow-hidden">
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50">{generating ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}生成本章</button>
              <span className="w-px bg-purple-200" />
              <button onClick={() => setShowGenerateMenu(!showGenerateMenu)} className="px-1.5 py-1.5 text-purple-500 hover:bg-purple-100"><ChevronDown size={10} /></button>
            </div>
            {showGenerateMenu && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20" onMouseLeave={() => setShowGenerateMenu(false)}>
                <button onClick={() => { setShowGenerateMenu(false); setShowAutoWrite(true); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">连续生成多章...</button>
              </div>
            )}
          </div>
          <button onClick={onReview} disabled={!hasContent || generating || reviewing} className={cn("flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium", hasContent && !generating ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-slate-50 text-slate-300")}>{reviewing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}审查</button>
          <button onClick={handleSave} disabled={generating || !isDirty} className={cn("flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium", !isDirty ? "border-slate-200 bg-slate-50 text-slate-400" : "border-green-300 bg-green-50 text-green-700 hover:bg-green-100")}><Save size={12} />保存</button>
          {/* Auxiliary tools */}
          {!generating && <span className="w-px h-5 bg-slate-200 mx-0.5" />}
          {hasContent && !generating && <button onClick={async () => { try { const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/undo`); if (data.data.restored) { setContent(data.data.content ?? ""); refetch(); } else alert(data.data.message); } catch {} }} className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><Undo2 size={11} />撤销</button>}
        </div>
      </div>

      {/* Title */}
      <input value={displayTitle} onChange={(e) => setTitle(e.target.value)} onBlur={handleSaveTitle} placeholder="无标题"
        className="mb-3 w-full text-xl font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-slate-400 focus:outline-none pb-1" />

      {/* Editor */}
      <div className="flex-1 min-h-0 relative">
        {hasContent && !generating && <div className="absolute top-2 right-4 z-10 text-[11px] text-slate-300 select-none pointer-events-none">选中正文文字可唤起 AI 改写工具</div>}
        <div className="h-full overflow-y-auto rounded-xl border border-slate-200 bg-white">
          <ChapterEditor content={displayContent} onChange={setContent} readOnly={generating} aiGenerated={aiGenerated} onUserEdit={() => setAiGenerated(false)} onParagraphSelect={handleParagraphSelect} />
        </div>
      </div>

      {generating && <div className="mt-2 shrink-0 rounded-lg bg-blue-50 p-2 flex items-center gap-2 text-xs text-blue-600"><RefreshCw size={12} className="animate-spin" />{stage}</div>}
      {autoState && <FakeProgress key={autoState.chapter} running={autoState.running} label={autoState.label} />}
      {error && <div className="mt-2 shrink-0 rounded-lg bg-red-50 p-2 flex items-center gap-2 text-xs text-red-600"><XCircle size={12} />{error}</div>}

      {/* Auto-write popup */}
      {showAutoWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAutoWrite(false)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">自动写作</h3><button onClick={() => setShowAutoWrite(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button></div>
            <p className="text-xs text-slate-600 mb-3">AI 将从当前章节开始自动连续写作（含审查+修复）。遇到硬错误时自动停止。</p>
            <label className="block text-xs font-medium text-slate-600 mb-1">往后写几章？</label>
            <input type="number" min={1} max={50} value={autoCount} onFocus={(e) => e.target.select()} onChange={(e) => setAutoCount(parseInt(e.target.value) || 1)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-4 focus:border-slate-400 focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={() => setShowAutoWrite(false)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleAutoWrite} className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700">写 {autoCount} 章</button>
            </div>
          </div>
        </div>
      )}

      {/* Revision Toolbar */}
      {showToolbar && !generating && (
        <RevisionToolbar
          visible={showToolbar}
          position={toolbarPos}
          onSelectOperation={handleRevisionOperation}
          onClose={() => setShowToolbar(false)}
          loading={false}
        />
      )}

      {/* Phase 10: Revision Workbench */}
      {revisionOp && (
        <RevisionWorkbench
          novelId={novelId}
          chapterId={chapterId}
          initialOperation={revisionOp}
          selectedParagraphs={selectedParagraphs}
          onApply={handleRevisionApply}
          onClose={() => setRevisionOp(null)}
        />
      )}

    </div>
  );
}
