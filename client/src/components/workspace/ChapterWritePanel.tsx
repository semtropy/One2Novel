import { useState, useRef, useCallback, useEffect } from "react";
import { RefreshCw, XCircle, Play, Save, X, ChevronDown, Lightbulb } from "lucide-react";
import { api } from "../../app/api";
import { useNovel } from "../../api/novel";
import { type RevisionOperation } from "../../api/revision";
import { ChapterEditor } from "./ChapterEditor";
import { RevisionToolbar } from "./RevisionToolbar";
import { RevisionWorkbench } from "./RevisionWorkbench";
import { AutoWriteModal } from "./AutoWriteModal";
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
  const [aiDetection, setAiDetection] = useState<AiDetectionResult | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showGenerateMenu, setShowGenerateMenu] = useState(false);

  // ─── Revision state ──────────────────────────────────
  const [selectedParagraphs, setSelectedParagraphs] = useState<string[]>([]);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [revisionOp, setRevisionOp] = useState<RevisionOperation | null>(null);
  const [inlineSuggestion, setInlineSuggestion] = useState<{ suggestion: string; severity: string; focus: string } | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestPos, setSuggestPos] = useState<{ top: number; left: number } | null>(null);

  async function handleInlineSuggest(paragraphs: string[], pos: { top: number; left: number }) {
    if (!paragraphs.length) return;
    setSuggestLoading(true);
    setSuggestPos({ top: Math.max(60, pos.top + 20), left: Math.max(10, pos.left) });
    try {
      const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/inline-suggest`, { selectedText: paragraphs.join("\n") });
      setInlineSuggestion(data.data);
    } catch {} finally { setSuggestLoading(false); }
  }

  const handleParagraphSelect = useCallback((paras: string[], pos?: { top: number; left: number }) => {
    setSelectedParagraphs(paras);
    if (paras.length > 0 && pos) {
      setToolbarPos({ top: Math.max(60, pos.top - 260), left: Math.max(10, Math.min(pos.left, window.innerWidth - 300)) });
      setShowToolbar(true);
    } else {
      setShowToolbar(false);
    }
  }, []);

  const handleRevisionApply = useCallback(async (paragraphs: string[], replacement: string) => {
    await api.post(`/novels/${novelId}/chapters/${chapterId}/revision/apply`, {
      selectedParagraphs: paragraphs,
      replacementText: replacement,
    });
    setRevisionOp(null);
    refetch();
  }, [novelId, chapterId, refetch]);

  const chapters = novel?.chapters ?? [];
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

  const handleRevisionOperation = useCallback((op: RevisionOperation) => {
    if (!selectedParagraphs.length) return;
    setShowToolbar(false);
    setRevisionOp(op);
  }, [selectedParagraphs]);

  const displayTitle = title || chapter?.title || "";
  const wordCount = displayContent.replace(/<[^>]*>/g, "").length;
  const isDirty = displayContent !== savedContent;

  // Phase 6: Auto-save draft to localStorage
  const draftKey = `chapter-draft-${chapterId}`;

  // Restore draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved && !chapter?.content) {
        const draft = JSON.parse(saved);
        if (draft.content && draft.content.length > 50) {
          setContent(draft.content);
          if (draft.title) setTitle(draft.title);
          setSaved(true);
        }
      }
    } catch {}
  }, [chapterId]);

  // Auto-save every 30s when dirty
  useEffect(() => {
    if (!isDirty || !displayContent) return;
    const interval = setInterval(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ content: displayContent, title: displayTitle, ts: Date.now() }));
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [isDirty, displayContent, displayTitle, draftKey]);

  // Save on page unload
  useEffect(() => {
    const handler = () => {
      if (isDirty && displayContent) {
        try { localStorage.setItem(draftKey, JSON.stringify({ content: displayContent, title: displayTitle, ts: Date.now() })); } catch {}
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, displayContent, displayTitle, draftKey]);

  // Clear draft when content matches savedContent (i.e., saved to server)
  useEffect(() => {
    if (!isDirty && savedContent) {
      try { localStorage.removeItem(draftKey); } catch {}
    }
  }, [isDirty, savedContent, draftKey]);

  useEffect(() => {
    if (!generating && displayContent) {
      const t = setTimeout(async () => {
        try { await api.patch(`/novels/${novelId}/chapters/${chapterId}`, { content: displayContent }); setSaved(true); setTimeout(() => setSaved(false), 1500); } catch {}
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [displayContent]);

  // H5: Cleanup streaming on unmount
  useEffect(() => () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  async function handleGenerate() {
    setGenerating(true); setStage(""); setError(""); setContent(""); setAiGenerated(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/novels/${novelId}/chapters/${chapterId}/write`, {
        method: "POST",
        headers: { "Accept": "text/event-stream" },
        signal: controller.signal,
      });

      if (!response.ok) {
        setError(`请求失败 (${response.status})`);
        setGenerating(false);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); }
          else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            switch (currentEvent) {
              case "stage": setStage(data.stage); break;
              case "token": setContent(p => p + data.text); break;
              case "complete":
                setGenerating(false); setAiGenerated(true); refetch();
                break;
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  const handleSave = useCallback(async () => {
    try {
      const { data } = await api.put(`/novels/${novelId}/chapters/${chapterId}/content`, { content: displayContent });
      setSavedContent(displayContent);
      if (data?.data?.score != null) {
        const qs = Math.round(data.data.score);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
      refetch();
    } catch {}
  }, [novelId, chapterId, displayContent, refetch]);

  const handleSaveTitle = useCallback(async () => {
    try { await api.patch(`/novels/${novelId}/chapters/${chapterId}`, { title: displayTitle }); refetch(); } catch {}
  }, [novelId, chapterId, displayTitle, refetch]);

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
            <div className="flex rounded-md border border-brand-300 bg-brand-50 overflow-hidden">
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">{generating ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}生成本章</button>
              <span className="w-px bg-brand-200" />
              <button onClick={() => setShowGenerateMenu(!showGenerateMenu)} className="px-1.5 py-1.5 text-brand-500 hover:bg-brand-100"><ChevronDown size={10} /></button>
            </div>
            {showGenerateMenu && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20" onMouseLeave={() => setShowGenerateMenu(false)}>
                <button onClick={() => { setShowGenerateMenu(false); setShowAutoWrite(true); }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">连续生成多章...</button>
              </div>
            )}
          </div>
          <button onClick={onReview} disabled={!hasContent || generating || reviewing} className={cn("flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium", hasContent && !generating ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-slate-50 text-slate-300")}>{reviewing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}审查</button>
          <button onClick={handleSave} disabled={generating || !isDirty} className={cn("flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium", !isDirty ? "border-slate-200 bg-slate-50 text-slate-400" : "border-green-300 bg-green-50 text-green-700 hover:bg-green-100")}><Save size={12} />保存</button>
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
      {error && <div className="mt-2 shrink-0 rounded-lg bg-red-50 p-2 flex items-center gap-2 text-xs text-red-600"><XCircle size={12} />{error}</div>}

      {/* Inline Suggestion Floating Card */}
      {(inlineSuggestion || suggestLoading) && suggestPos && (
        <div className="fixed z-50 rounded-xl border border-brand-200 bg-white shadow-lg p-3" style={{ top: suggestPos.top, left: suggestPos.left, maxWidth: 280 }}>
          {suggestLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400"><RefreshCw size={11} className="animate-spin" />分析中...</div>
          ) : inlineSuggestion ? (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <span className={`text-[10px] rounded px-1 py-0 ${inlineSuggestion.severity === "medium" ? "bg-accent-50 text-accent-600" : "bg-slate-100 text-slate-500"}`}>
                  {inlineSuggestion.focus === "pass" ? "✓" : inlineSuggestion.focus}
                </span>
              </div>
              <p className="text-xs text-slate-600 mb-2">{inlineSuggestion.suggestion}</p>
              <button onClick={() => { setInlineSuggestion(null); setSuggestPos(null); }} className="text-[10px] text-slate-400 hover:text-slate-600">关闭</button>
            </div>
          ) : null}
        </div>
      )}

      {/* Add inline suggest to paragraph selection handler */}
      {showToolbar && !generating && (
        <div className="fixed z-40" style={{ top: (toolbarPos?.top ?? 100) - 20, left: toolbarPos?.left ?? 100 }}>
          <button onClick={() => { handleInlineSuggest(selectedParagraphs, toolbarPos!); setShowToolbar(false); }}
            className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs text-brand-600 hover:bg-brand-100 shadow-sm">
            <Lightbulb size={11} className="inline mr-0.5" />AI建议
          </button>
        </div>
      )}

      {showAutoWrite && <AutoWriteModal novelId={novelId} onClose={() => setShowAutoWrite(false)} />}

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
