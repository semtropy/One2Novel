import { useState, useEffect, useCallback, useRef } from "react";
import { Play, Square, X, CheckCircle, AlertTriangle, XCircle, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props {
  novelId: string;
  onClose: () => void;
}

interface DirectorProgress {
  stage: string;
  currentChapter: number;
  totalChapters: number;
  message: string;
  results: Array<{ chapter: number; status: string; score?: number }>;
}

export default function AutoWriteModal({ novelId, onClose }: Props) {
  const [chCount, setChCount] = useState(3);
  const [phase, setPhase] = useState<"config" | "running">("config");
  const [progress, setProgress] = useState<DirectorProgress | null>(null);
  const [resuming, setResuming] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const start = useCallback(async () => {
    setPhase("running");
    setProgress(null);
    try {
      await api.post(`/novels/${novelId}/director/run`, { maxChapters: chCount });
    } catch { /* will show in poll */ }

    const poll = async () => {
      try {
        const { data } = await api.get(`/novels/${novelId}/director/progress`);
        if (data.data) setProgress(data.data);
      } catch {}
    };
    poll();
    intervalRef.current = setInterval(poll, 2000);
  }, [novelId, chCount]);

  const stop = useCallback(async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    try { await api.post(`/novels/${novelId}/director/stop`); } catch {}
    setPhase("config");
  }, [novelId]);

  const resume = useCallback(async () => {
    setResuming(true);
    try {
      await api.post(`/novels/${novelId}/director/resume`);
      start();
    } catch { /* will show in poll */ }
    finally { setResuming(false); }
  }, [novelId, start]);

  const handleClose = () => {
    if (phase === "running") stop();
    onClose();
  };

  const isBlocked = progress?.stage === "blocked";
  const isRunning = progress?.stage === "running";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose}>
      <div className="w-96 rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">自动写作</h3>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {phase === "config" && (
          <>
            {isBlocked && (
              <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                ⚠ 检测到在第{progress?.currentChapter}章中断
                <button onClick={resume} disabled={resuming}
                  className="ml-2 text-amber-800 font-medium underline">
                  {resuming ? "恢复中..." : "恢复"}
                </button>
              </div>
            )}
            <p className="text-xs text-slate-600 mb-4">
              AI 将从当前章节开始自动连续写作（含审查+修复）。
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-slate-600">写</span>
              <input type="number" min={1} max={50} value={chCount} onFocus={e => e.target.select()}
                onChange={e => setChCount(parseInt(e.target.value) || 1)}
                className="w-20 text-center rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none" />
              <span className="text-sm text-slate-600">章</span>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={start} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">开始</button>
            </div>
          </>
        )}

        {phase === "running" && progress && (
          <>
            <div className="mb-3 rounded-lg bg-blue-50 p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className={cn("font-medium", progress.stage === "completed" ? "text-green-700" : progress.stage === "blocked" ? "text-red-700" : "text-blue-700")}>
                  {progress.message}
                </span>
                <span className="text-blue-500">{progress.currentChapter}/{progress.totalChapters}</span>
              </div>
              {progress.totalChapters > 0 && (
                <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", progress.stage === "completed" ? "bg-green-500" : progress.stage === "blocked" ? "bg-red-500" : "bg-blue-500")}
                    style={{ width: `${(progress.currentChapter / progress.totalChapters) * 100}%` }} />
                </div>
              )}
            </div>

            {progress.results.length > 0 && (
              <div className="mb-3 max-h-40 overflow-y-auto space-y-1">
                {progress.results.map(r => (
                  <div key={r.chapter} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-slate-50">
                    <span className={r.status === "completed" ? "text-green-500" : r.status === "needs_repair" ? "text-amber-500" : r.status === "blocked" ? "text-red-500" : "text-blue-500"}>
                      {r.status === "completed" ? <CheckCircle size={12} /> : r.status === "needs_repair" ? <AlertTriangle size={12} /> : r.status === "blocked" ? <XCircle size={12} /> : <RefreshCw size={12} className="animate-spin" />}
                    </span>
                    <span className="text-slate-600">第{r.chapter}章</span>
                    <span className={cn("text-xs", r.status === "completed" ? "text-green-600" : r.status === "needs_repair" ? "text-amber-600" : r.status === "blocked" ? "text-red-500" : "text-blue-500")}>
                      {r.status === "completed" ? "通过" : r.status === "needs_repair" ? "需修复" : r.status === "blocked" ? "阻塞" : "写作中..."}
                    </span>
                    {r.score != null && <span className="text-slate-400 ml-auto">{r.score}分</span>}
                  </div>
                ))}
              </div>
            )}

            <button onClick={stop} className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100">
              <Square size={12} />停止
            </button>
          </>
        )}
      </div>
    </div>
  );
}
