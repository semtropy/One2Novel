/**
 * StoryCoreDomain — 故事核心决策域
 * 灵感输入 + AI 生成故事核心 + 编辑题材/视角/节奏/情感强度
 */
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { useNovel, useUpdateNovel, useGenerateStoryCore } from "../../api/novel";
import { cn } from "../../lib/cn";

interface Props {
  novelId: string;
  onComplete?: () => void;
}

const GENRE_OPTIONS = ["悬疑", "言情", "奇幻", "科幻", "历史", "都市", "武侠", "恐怖", "游戏", "其他"];
const POV_OPTIONS = [
  { value: "first_person", label: "第一人称" },
  { value: "third_person", label: "第三人称" },
  { value: "mixed", label: "混合视角" },
];
const PACE_OPTIONS = [
  { value: "slow", label: "舒缓" },
  { value: "balanced", label: "均衡" },
  { value: "fast", label: "快节奏" },
];
const EMOTION_OPTIONS = [
  { value: "low", label: "克制" },
  { value: "medium", label: "适中" },
  { value: "high", label: "强烈" },
];

export function StoryCoreDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
  const genStoryCore = useGenerateStoryCore();

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [inspiration, setInspiration] = useState("");

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditingValue(value);
  };

  const saveEdit = async (field: string) => {
    if (editingValue !== (novel as unknown as Record<string,unknown>)[field]) {
      await updateNovel.mutateAsync({ id: novelId, [field]: editingValue });
      refetch();
    }
    setEditingField(null);
  };
  const [genError, setGenError] = useState("");

  // Load existing data on mount / novel change
  useEffect(() => {
    setInspiration(novel?.description ?? "");
  }, [novel?.description]);

  const handleSaveInspiration = useCallback(() => {
    if (inspiration !== novel?.description) {
      updateNovel.mutate({ id: novelId, description: inspiration });
    }
  }, [inspiration, novel?.description, novelId, updateNovel]);

  const handleGenerateCore = useCallback(async () => {
    setGenError("");
    try {
      await genStoryCore.mutateAsync(novelId);
      refetch();
      onComplete?.();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "生成失败");
    }
  }, [novelId, genStoryCore, refetch, onComplete]);

  const hasCore = !!(novel?.storySummary);

  return (
    <div className="space-y-5">
      {/* 灵感输入 */}
      <section className="rounded-xl border border-amber-200 bg-amber-50/30 p-4">
        <h3 className="text-sm font-medium text-amber-800 mb-2">灵感描述</h3>
        <textarea
          className="w-full bg-white rounded-lg border border-amber-200 p-3 text-sm resize-none focus:outline-none focus:border-amber-400 placeholder:text-slate-300"
          rows={4}
          placeholder="一句话描述你的作品…"
          value={inspiration}
          onChange={(e) => setInspiration(e.target.value)}
          onBlur={handleSaveInspiration}
        />
      </section>

      {/* 故事核心 */}
      {hasCore && (
        <section className="rounded-xl border border-green-200 bg-green-50/30 p-4 space-y-3">
          <h3 className="text-sm font-medium text-green-800">故事核心</h3>

          <div className="space-y-2 text-sm">
            {([
              ["storySummary", "故事简介", "故事的核心叙事线"],
              ["centralQuestion", "核心悬念", "最关键但暂时无法揭晓的未知"],
              ["endingDirection", "结局方向", "结局气质与情感落点"],
            ] as const).map(([field, label, hint]) => {
              const value = (novel as unknown as Record<string,unknown>)[field] as string;
              if (!value && field !== "storySummary") return null;
              return (
                <div key={field as string}>
                  <span className="font-medium text-slate-500">{label as string}：</span>
                  {editingField === field ? (
                    <div className="mt-0.5">
                      <textarea
                        autoFocus
                        className="w-full rounded border border-indigo-300 p-2 text-sm resize-none focus:outline-none"
                        rows={3}
                        value={editingValue}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={() => saveEdit(field as string)}
                        onKeyDown={e => {
                          if (e.key === "Escape") setEditingField(null);
                          if ((e.key === "Enter" && (e.ctrlKey || e.metaKey))) saveEdit(field as string);
                        }}
                      />
                      <p className="text-xs text-slate-400 mt-0.5">{hint as string}。Ctrl+Enter 保存，Esc 取消。</p>
                    </div>
                  ) : (
                    <p className="text-slate-700 mt-0.5 leading-relaxed cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1"
                      onClick={() => startEdit(field as string, value ?? "")}
                      title={`${hint}。点击编辑。`}>
                      {value || "点击编辑..."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 创意参数 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3">创意参数</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">题材</label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              value={novel?.genre ?? ""}
              onChange={(e) => updateNovel.mutate({ id: novelId, genre: e.target.value || undefined })}
            >
              <option value="">未选择</option>
              {GENRE_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">视角</label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              value={novel?.narrativePov ?? ""}
              onChange={(e) => updateNovel.mutate({ id: novelId, narrativePov: e.target.value || undefined })}
            >
              <option value="">未选择</option>
              {POV_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">节奏</label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              value={novel?.pacePreference ?? ""}
              onChange={(e) => updateNovel.mutate({ id: novelId, pacePreference: e.target.value || undefined })}
            >
              <option value="">未选择</option>
              {PACE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">情感强度</label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              value={novel?.emotionIntensity ?? ""}
              onChange={(e) => updateNovel.mutate({ id: novelId, emotionIntensity: e.target.value || undefined })}
            >
              <option value="">未选择</option>
              {EMOTION_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">创作模式</label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              value={novel?.writingMode ?? "original"}
              onChange={(e) => updateNovel.mutate({ id: novelId, writingMode: e.target.value })}
            >
              <option value="original">原创</option>
              <option value="continuation">续写</option>
            </select>
          </div>
        </div>
      </section>

      {/* 生成按钮 */}
      <button
        onClick={handleGenerateCore}
        disabled={genStoryCore.isPending}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors",
          hasCore
            ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
            : "bg-indigo-600 text-white hover:bg-indigo-700",
        )}
      >
        {genStoryCore.isPending ? (
          <RefreshCw size={14} className="animate-spin" />
        ) : (
          <Sparkles size={14} />
        )}
        {hasCore ? "重新生成故事核心" : "AI 生成故事核心"}
      </button>

      {genError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">{genError}</div>
      )}
    </div>
  );
}
