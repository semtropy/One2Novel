import { useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { api } from "../../app/api";

interface Props { novelId: string; chapterId: string }

interface NextPreview {
  chapterTitle: string; expectation: string; coreEvent: string;
  endingHook: string; coolPointType?: string; sceneCount?: number;
}

const TYPE_LABELS: Record<string, string> = {
  collect: "收集", strategy: "策略", verify: "验证", reveal: "揭示", upgrade: "升级", face_slap: "打脸",
};

export function NextChapterPreview({ novelId, chapterId }: Props) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<NextPreview | null>(null);

  async function generate() {
    setLoading(true);
    try {
      const { data } = await api.post(`/novels/${novelId}/next-chapter-preview`);
      setPreview(data.data);
    } catch {} finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-indigo-700 flex items-center gap-1"><Sparkles size={11} />下一章预览</h4>
        {!preview && (
          <button onClick={generate} disabled={loading}
            className="rounded border border-indigo-200 px-2 py-0.5 text-xs text-indigo-500 hover:bg-indigo-50">
            {loading ? <RefreshCw size={10} className="animate-spin" /> : "生成"}
          </button>
        )}
      </div>
      {preview && (
        <div className="space-y-1 text-xs">
          <div><span className="text-slate-400">标题：</span><span className="font-medium text-slate-700">{preview.chapterTitle}</span></div>
          <div><span className="text-slate-400">目标：</span><span className="text-slate-600">{preview.expectation}</span></div>
          <div><span className="text-slate-400">核心事件：</span><span className="text-slate-600">{preview.coreEvent}</span></div>
          <div><span className="text-slate-400">钩子：</span><span className="text-slate-600">{preview.endingHook}</span></div>
          {preview.coolPointType && (
            <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
              {TYPE_LABELS[preview.coolPointType] ?? preview.coolPointType}
            </span>
          )}
          {preview.sceneCount && <span className="inline-block ml-1 text-[10px] text-slate-400">{preview.sceneCount}个场景</span>}
          <button onClick={() => setPreview(null)} className="block text-slate-400 hover:text-indigo-500 mt-1">重新生成</button>
        </div>
      )}
    </div>
  );
}
