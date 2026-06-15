import { useState, useEffect } from "react";
import { Clock, X } from "lucide-react";
import { api } from "../../app/api";

interface Props { novelId: string; chapterId: string; onClose: () => void }

interface EditRecord { id: string; content: string; createdAt: string }

export function ChapterDiffModal({ novelId, chapterId, onClose }: Props) {
  const [history, setHistory] = useState<EditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/novels/${novelId}/chapters/${chapterId}/edit-history`)
      .then(r => setHistory(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [novelId, chapterId]);

  const plainText = (html: string) => html.replace(/<[^>]*>/g, "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[48rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Clock size={14} />编辑历史</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        {loading ? (
          <p className="text-xs text-slate-400 py-8 text-center">加载中...</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">暂无编辑记录</p>
        ) : (
          <div className="space-y-4">
            {history.map((rec, i) => (
              <div key={rec.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-600">
                    版本 #{history.length - i} — {new Date(rec.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <span className="text-xs text-slate-400">{plainText(rec.content).length} 字符</span>
                </div>
                <div className="rounded bg-slate-50 p-3 max-h-48 overflow-y-auto text-xs text-slate-600 whitespace-pre-wrap font-mono">
                  {plainText(rec.content).slice(0, 2000)}
                  {plainText(rec.content).length > 2000 && <span className="text-slate-400">...（截断前2000字符）</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
