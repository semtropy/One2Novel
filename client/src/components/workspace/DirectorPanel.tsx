import { useState, useCallback, useEffect } from "react";
import { Play, RefreshCw, CheckCircle, AlertTriangle, XCircle, RotateCcw } from "lucide-react";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";
import { AutoWriteModal } from "./AutoWriteModal";

interface Props { novelId: string; compact?: boolean }

interface DirectorProgress {
  stage: string; currentChapter: number; totalChapters: number; message: string;
  results: Array<{ chapter: number; status: string; score?: number; error?: string }>;
}

export function DirectorPanel({ novelId, compact }: Props) {
  const [progress, setProgress] = useState<DirectorProgress | null>(null);
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [showAutoWrite, setShowAutoWrite] = useState(false);

  useEffect(() => { pollProgress(); }, [novelId]);

  const handleResume = useCallback(async () => {
    setResuming(true); setError("");
    try { await api.post(`/novels/${novelId}/director/resume`); pollProgress(); }
    catch (e) { setError(e instanceof Error ? e.message : "恢复失败"); }
    finally { setResuming(false); }
  }, [novelId]);

  const pollProgress = useCallback(async () => {
    try { const { data } = await api.get(`/novels/${novelId}/director/progress`); if (data.data) setProgress(data.data); } catch {}
  }, [novelId]);

  const isBlocked = progress?.stage === "blocked";
  const isRunning = progress?.stage === "running";

  if (compact) {
    return (
      <>
        <button onClick={() => setShowAutoWrite(true)}
          className="flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-6 py-3 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
          <Play size={18} />一键自动写作
        </button>
        {isBlocked && (
          <div className="space-y-1">
            <button onClick={handleResume} disabled={resuming}
              className="flex items-center gap-1.5 text-xs text-accent-600 hover:text-accent-700 font-medium">
              <RotateCcw size={14} className={resuming ? "animate-spin" : ""} />
              {resuming ? "恢复中..." : `⚠ 在第${progress.currentChapter}章中断，点击恢复`}
            </button>
            {progress.message && (
              <p className="text-xs text-accent-500">{progress.message}</p>
            )}
          </div>
        )}
        {showAutoWrite && <AutoWriteModal novelId={novelId} onClose={() => setShowAutoWrite(false)} />}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">自动写作</h3>
        <div className="flex items-center gap-2">
          {isRunning && <button onClick={pollProgress} className="text-xs text-slate-500"><RefreshCw size={12} className="inline mr-1" />刷新</button>}
          {isBlocked && (
            <button onClick={handleResume} disabled={resuming}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200">
              <RotateCcw size={12} className={resuming ? "animate-spin" : ""} /> 恢复
            </button>
          )}
          <button onClick={() => setShowAutoWrite(true)} disabled={isRunning} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium", isRunning ? "bg-slate-100 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800")}>
            {isRunning ? <><RefreshCw size={12} className="animate-spin" /> 运行中...</> : <><Play size={12} /> 启动</>}
          </button>
          {showAutoWrite && <AutoWriteModal novelId={novelId} onClose={() => setShowAutoWrite(false)} />}
        </div>
      </div>
      {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600">{error}</div>}
      {progress && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className={cn("font-medium", progress.stage === "completed" ? "text-green-600" : progress.stage === "blocked" ? "text-red-600" : "text-blue-600")}>{progress.message}</span>
              <span className="text-slate-400">{progress.currentChapter}/{progress.totalChapters}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", progress.stage === "completed" ? "bg-green-500" : progress.stage === "blocked" ? "bg-red-500" : "bg-blue-500")}
                style={{ width: `${progress.totalChapters > 0 ? (progress.currentChapter / progress.totalChapters) * 100 : 0}%` }} />
            </div>
          </div>
          {progress.results.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white max-h-60 overflow-y-auto divide-y divide-slate-50">
              {progress.results.map((r) => (
                <div key={r.chapter} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className={r.status === "completed" ? "text-green-500" : r.status === "needs_repair" ? "text-accent-500" : "text-red-500"}>
                    {r.status === "completed" ? <CheckCircle size={14} /> : r.status === "needs_repair" ? <AlertTriangle size={14} /> : <XCircle size={14} />}
                  </span>
                  <span className="text-slate-600">第{r.chapter}章</span>
                  {r.score && <span className="text-slate-400">{r.score}分</span>}
                  <span>{r.status === "completed" ? "通过" : r.status === "needs_repair" ? "需修复" : "阻塞"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
