/**
 * ReferenceDomain — simplified entry point to the reference book analysis cockpit.
 * All analysis functionality has moved to ReferenceCockpitPage.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { api } from "../../app/api";

interface Props { novelId: string }

export function ReferenceDomain({ novelId }: Props) {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    api.get(`/novels/${novelId}/reference-book`).then(({ data }) => {
      if (data.data?.fileName) setFileName(data.data.fileName);
    }).catch(() => {});
  }, [novelId]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        上传对标网络小说.txt，AI 将分析其回环结构、爽点分布、钩子模式、金手指设定等 8 个维度，为你的创作提供精准参考。
      </p>

      <button onClick={() => navigate(`/novels/${novelId}/reference`)}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-700">
        <FileText size={14} />
        {fileName ? `参考书：${fileName} — 打开分析驾驶舱` : "打开参考书分析驾驶舱"}
        <ArrowRight size={12} />
      </button>
    </div>
  );
}
