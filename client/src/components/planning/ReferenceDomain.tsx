/**
 * ReferenceDomain — simplified entry point to the reference book analysis cockpit.
 * All analysis functionality has moved to ReferenceCockpitPage.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, ArrowRight, FileText } from "lucide-react";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string }

export function ReferenceDomain({ novelId }: Props) {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  useEffect(() => {
    api.get(`/novels/${novelId}/reference-book`).then(({ data }) => {
      if (data.data?.fileName) setFileName(data.data.fileName);
    }).catch(() => {});
  }, [novelId]);

  async function handleUpload(text: string, name: string) {
    setUploading(true); setUploadMsg("上传中...");
    try {
      await api.post(`/novels/${novelId}/reference-book`, { fileName: name, content: text });
      setFileName(name); setUploadMsg("上传成功");
    } catch { setUploadMsg("上传失败"); }
    finally { setUploading(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        上传对标网络小说.txt，AI 将分析其回环结构、爽点分布、钩子模式、金手指设定等 7 个维度，为你的创作提供精准参考。
      </p>

      {fileName ? (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50/30 px-4 py-3">
          <FileText size={18} className="text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 truncate">{fileName}</p>
            <p className="text-xs text-green-600">已上传</p>
          </div>
          <button onClick={() => navigate(`/novels/${novelId}/reference`)}
            className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
            打开分析驾驶舱 <ArrowRight size={11} />
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-6 text-center">
          <Upload size={24} className="mx-auto mb-2 text-slate-300" />
          <p className="text-xs text-slate-500 mb-2">拖拽或选择 .txt 文件</p>
          {uploadMsg && <p className={cn("text-xs mb-2", uploadMsg.includes("失败") ? "text-red-500" : "text-green-600")}>{uploadMsg}</p>}
          <label className="inline-block cursor-pointer rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
            {uploading ? "上传中..." : "选择文件"}
            <input type="file" accept=".txt" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (file) { const r = new FileReader(); r.onload = ev => handleUpload(ev.target?.result as string, file.name); r.readAsText(file); }
            }} />
          </label>
        </div>
      )}
    </div>
  );
}
