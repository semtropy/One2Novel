/**
 * ReferenceDomain — 档案选择器，嵌入在规划页面 Step 1
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ArrowRight } from "lucide-react";
import { useNovel } from "../../api/novel";
import { api } from "../../app/api";

interface Props { novelId: string }
interface ProfileItem { id: string; name: string; architectureType?: string | null; totalChapters?: number | null; createdAt: string; }

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};

export function ReferenceDomain({ novelId }: Props) {
  const navigate = useNavigate();
  const { data: novel } = useNovel(novelId);
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedId, setSelectedId] = useState(novel?.activeProfileId ?? "");

  useEffect(() => {
    api.get("/profiles").then(({ data }) => setProfiles(data.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (novel?.activeProfileId) setSelectedId(novel.activeProfileId);
  }, [novel?.activeProfileId]);

  async function handleSelect(id: string) {
    setSelectedId(id);
    if (id) {
      await api.put(`/novels/${novelId}/active-profile`, { profileId: id });
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        选择已保存的参考书档案，将其架构、钩子、内容节拍等配方应用到当前小说。
      </p>

      <div className="flex items-center gap-2">
        <select value={selectedId} onChange={e => handleSelect(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none">
          <option value="">-- 选择档案（{profiles.length}个） --</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.architectureType ? ` · ${ARCH_LABELS[p.architectureType] ?? p.architectureType}` : ""}{p.totalChapters ? ` · ${p.totalChapters}章` : ""}</option>
          ))}
        </select>
        <button onClick={() => navigate("/reference-profiles")}
          className="flex items-center gap-1 shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
          <BookOpen size={12} />打开驾驶舱 <ArrowRight size={10} />
        </button>
      </div>
    </div>
  );
}