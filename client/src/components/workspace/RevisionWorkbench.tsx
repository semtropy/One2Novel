import { useState, useEffect, useRef, useCallback } from "react";
import { X, RefreshCw, AlertTriangle, Play, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../../app/api";
import { OPERATION_LABELS, type RevisionOperation, type RewriteCandidate } from "../../api/revision";
import { escapeHtml } from "../../lib/html";
import { cn } from "../../lib/cn";

interface Props {
  novelId: string;
  chapterId: string;
  initialOperation: RevisionOperation;
  selectedParagraphs: string[];
  onApply: (paragraphs: string[], replacement: string) => Promise<void>;
  onClose: () => void;
}

const ALL_OPS: RevisionOperation[] = ["polish", "expand", "compress", "rewrite_perspective", "adjust_tone", "fix_ai_traces"];

type Phase = "ready" | "loading" | "done" | "error";

export function RevisionWorkbench({ novelId, chapterId, initialOperation, selectedParagraphs, onApply, onClose }: Props) {
  const [operation, setOperation] = useState<RevisionOperation>(initialOperation);
  const [customInstruction, setCustomInstruction] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [candidates, setCandidates] = useState<RewriteCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const opConfig = OPERATION_LABELS[operation];
  const originalText = selectedParagraphs.join("\n\n");
  const candidate = candidates[selectedIdx];

  const run = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setPhase("loading");
    setError("");
    setCandidates([]);
    setSelectedIdx(0);
    const body: Record<string, unknown> = { operation, selectedParagraphs };
    if (customInstruction.trim()) body.customInstruction = customInstruction.trim();
    api.post(`/novels/${novelId}/chapters/${chapterId}/revision/candidates`, body, { timeout: 120_000 }).then(({ data }) => {
      if (abortRef.current?.signal.aborted) return;
      setCandidates(data.data as RewriteCandidate[]);
      setPhase("done");
    }).catch((e) => {
      if (abortRef.current?.signal.aborted) return;
      setError(e instanceof Error ? e.message : "改写失败，请重试");
      setPhase("error");
    });
  }, [novelId, chapterId, operation, selectedParagraphs, customInstruction]);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const switchOp = (op: RevisionOperation) => {
    if (op === operation) return;
    setOperation(op);
    setCustomInstruction("");
    setShowCustomInput(false);
    setPhase("ready");
    setCandidates([]);
    setSelectedIdx(0);
    setError("");
  };

  const handleApply = async () => {
    if (!candidate) return;
    setApplying(true);
    try { await onApply(selectedParagraphs, candidate.content); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "应用失败"); setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-1">
            {ALL_OPS.map(op => (
              <button key={op} onClick={() => switchOp(op)}
                className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  op === operation ? "bg-accent-100 text-accent-800" : "text-slate-500 hover:bg-slate-100")}>
                {OPERATION_LABELS[op].emoji} {OPERATION_LABELS[op].label}
              </button>
            ))}
            <span className="w-px h-4 bg-slate-200 mx-0.5" />
            <button onClick={() => { switchOp("polish"); setShowCustomInput(true); setCustomInstruction(""); }}
              className={cn("px-2.5 py-1 rounded text-xs font-medium transition-colors",
                showCustomInput ? "bg-brand-100 text-brand-800" : "text-slate-500 hover:bg-slate-100")}>
              💬 自定义
            </button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X size={18} /></button>
        </div>

        {/* Custom instruction input */}
        {showCustomInput && (
          <div className="shrink-0 px-5 py-2 border-b border-brand-100 bg-brand-50/30">
            <textarea value={customInstruction} onChange={e => setCustomInstruction(e.target.value)}
              placeholder="描述你想要的改写效果，例如：用更口语化的方式改写、加入一个反转、加快节奏..."
              className="w-full h-14 text-xs border border-brand-200 rounded-lg p-2 resize-none focus:outline-none focus:border-brand-400"
              autoFocus />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Side-by-side: left=original, right=result */}
          <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">
            {/* Original */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200">
              <div className="shrink-0 px-4 py-2 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-medium text-slate-500">选中原文（{selectedParagraphs.length}段）</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-600 font-serif">
                  {originalText}
                </div>
              </div>
            </div>

            {/* Result / Placeholder / Loading / Error */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="shrink-0 px-4 py-2 border-b border-slate-100 bg-accent-50">
                <span className="text-xs font-medium text-accent-700">
                  {phase === "loading" ? `正在${opConfig.label}...` :
                   phase === "done" ? "改写结果" :
                   phase === "error" ? "生成失败" :
                   "点击执行开始改写"}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {phase === "ready" && (
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                    确认左侧原文无误后，点击下方「执行」按钮
                  </div>
                )}
                {phase === "loading" && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                    <RefreshCw size={24} className="animate-spin text-accent-500" />
                    <p className="text-sm">AI 正在生成{opConfig.label}版本...</p>
                    <p className="text-xs">保留原文核心信息，优化表达方式</p>
                  </div>
                )}
                {phase === "error" && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 px-5">
                    <AlertTriangle size={24} className="text-red-400" />
                    <p className="text-sm text-red-600 text-center">{error}</p>
                  </div>
                )}
                {phase === "done" && candidate && (
                  <div className="p-4">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap font-serif">
                      {candidate.diffChunks.map((chunk, i) => {
                        const safe = escapeHtml(chunk.text);
                        if (chunk.type === "equal") return <span key={i} className="text-slate-500">{safe}</span>;
                        if (chunk.type === "insert") return <span key={i} className="bg-green-50 text-green-800 underline decoration-green-400 decoration-dotted">{safe}</span>;
                        return <span key={i} className="bg-red-50 text-red-400 line-through decoration-red-300">{safe}</span>;
                      })}
                    </div>
                    {/* Candidate meta */}
                    <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-0.5">
                      <div><span className="font-medium text-slate-600">摘要：</span>{candidate.summary}</div>
                      <div><span className="font-medium text-slate-600">理由：</span>{candidate.rationale}</div>
                      {candidate.riskNotes.length > 0 && (
                        <div className="text-accent-600"><span className="font-medium">注意：</span>{candidate.riskNotes.join("；")}</div>
                      )}
                      <div className="text-slate-400">
                        变化：<span className="text-green-600">+{candidate.diffStats.added}</span> / <span className="text-red-500">-{candidate.diffStats.removed}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions / Status bar */}
          <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-t">
            {phase === "ready" && (
              <>
                <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
                <button onClick={run} className="flex-1 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 flex items-center justify-center gap-1.5">
                  <Play size={14} />执行{showCustomInput ? "自定义" : opConfig.label}
                </button>
              </>
            )}
            {phase === "loading" && (
              <button onClick={() => { abortRef.current?.abort(); setPhase("ready"); }}
                className="flex-1 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">取消生成</button>
            )}
            {phase === "error" && (
              <>
                <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
                <button onClick={run} className="flex-1 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">重试</button>
              </>
            )}
            {phase === "done" && (
              <>
                <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
                <button onClick={run} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">重新生成</button>
                <button onClick={handleApply} disabled={applying}
                  className="flex-1 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50">
                  {applying ? "应用中..." : "应用此版本"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
