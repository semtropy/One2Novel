/**
 * FoundationDomain — Step 1: 故事核心
 *
 * Inspiration input → AI unified story-core generation → creative params +
 * commercial positioning. Golden finger moved to WorldDomain (Step 2).
 */
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Sparkles, Globe } from "lucide-react";
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

export function FoundationDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const updateNovel = useUpdateNovel();
  const genStoryCore = useGenerateStoryCore();

  // ── Local state ──
  const [inspiration, setInspiration] = useState("");
  const [genError, setGenError] = useState("");

  // Commercial fields
  const [targetAudience, setTargetAudience] = useState("");
  const [bookSellingPoint, setBookSellingPoint] = useState("");
  const [first30Promise, setFirst30Promise] = useState("");
  const [competingFeel, setCompetingFeel] = useState("");
  const [commercialTags, setCommercialTags] = useState("");

  // ── Load existing data ──
  useEffect(() => {
    setInspiration(novel?.description ?? "");
    setTargetAudience(novel?.targetAudience ?? "");
    setBookSellingPoint(novel?.bookSellingPoint ?? "");
    setFirst30Promise(novel?.first30ChapterPromise ?? "");
    setCompetingFeel(novel?.competingFeel ?? "");
    setCommercialTags(Array.isArray(novel?.commercialTags) ? (novel.commercialTags as string[]).join(", ") : (novel?.commercialTags ?? ""));
  }, [novel?.description, novel?.targetAudience, novel?.bookSellingPoint, novel?.first30ChapterPromise, novel?.competingFeel, novel?.commercialTags]);

  // ── Actions ──
  const handleSaveInspiration = useCallback(() => {
    if (inspiration !== novel?.description) {
      updateNovel.mutate({ id: novelId, description: inspiration });
    }
  }, [inspiration, novel?.description, novelId, updateNovel]);

  const handleGenerateAll = useCallback(async () => {
    setGenError("");
    try {
      await genStoryCore.mutateAsync(novelId);
      refetch();
      onComplete?.();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "生成失败");
    }
  }, [novelId, genStoryCore, refetch, onComplete]);

  const [saveError, setSaveError] = useState("");

  const quickSave = async (field: string, value: string) => {
    try {
      if (field === "commercialTags") {
        const tags = value.split(",").map(s => s.trim()).filter(Boolean);
        await updateNovel.mutateAsync({ id: novelId, commercialTags: tags as unknown as string });
      } else {
        await updateNovel.mutateAsync({ id: novelId, [field]: value });
      }
      refetch();
      setSaveError("");
    } catch {
      setSaveError("保存失败，请重试");
    }
  };

  const hasCore = !!(novel?.storySummary);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const startEdit = (field: string, value: string) => { setEditingField(field); setEditingValue(value); };
  const saveEdit = async (field: string) => {
    if (editingValue !== (novel as unknown as Record<string,unknown>)[field]) {
      await updateNovel.mutateAsync({ id: novelId, [field]: editingValue });
      refetch();
    }
    setEditingField(null);
  };

  return (
    <div className="space-y-5">
      {/* ── AI Generate All ── */}
      <button
        onClick={handleGenerateAll}
        disabled={genStoryCore.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 shadow-sm transition-colors"
      >
        <Sparkles size={16} className={genStoryCore.isPending ? "animate-spin" : ""} />
        {hasCore ? "重新生成全部" : "AI 生成故事核心 · 创意参数 · 商业定位"}
      </button>

      {genError && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{genError}</div>
      )}
      {saveError && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-600">{saveError}</div>
      )}

      {/* ── 1. 灵感输入 ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
          <Sparkles size={14} /> 灵感输入
        </h3>
        <textarea
          value={inspiration}
          onChange={e => setInspiration(e.target.value)}
          onBlur={handleSaveInspiration}
          placeholder="一句灵感，一段构思，一个你脑海中挥之不去的画面……"
          className="w-full min-h-[80px] rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y focus:border-brand-300 focus:outline-none placeholder:text-slate-300"
          maxLength={2000}
        />
        <p className="text-[10px] text-slate-400 mt-1">{inspiration.length}/2000</p>
      </section>

      {/* ── 2. 创意参数 ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3">创意参数</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { key: "genre", label: "题材", opts: GENRE_OPTIONS.map(o => ({ value: o, label: o })) },
            { key: "narrativePov", label: "视角", opts: POV_OPTIONS },
            { key: "pacePreference", label: "节奏", opts: PACE_OPTIONS },
            { key: "emotionIntensity", label: "情感", opts: EMOTION_OPTIONS },
          ] as const).map(({ key, label, opts }) => (
            <div key={key}>
              <label className="text-[10px] text-slate-400 block mb-0.5">{label}</label>
              <select
                value={(novel as unknown as Record<string,string>)[key] ?? ""}
                onChange={e => quickSave(key, e.target.value)}
                className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs focus:border-brand-300 focus:outline-none"
              >
                <option value="">未选择</option>
                {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <label className="text-[10px] text-slate-400 block mb-0.5">语气基调</label>
            <input
              value={(novel as unknown as Record<string,string>)["styleTone"] ?? ""}
              onChange={e => quickSave("styleTone", e.target.value)}
              placeholder="如：冷峻克制，以客观叙述和对话推进，氛围偏阴郁"
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-brand-300 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ── 3. 故事核心 ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3">故事核心</h3>
        {hasCore ? (
          <div className="space-y-2">
            {[
              { key: "storySummary", label: "故事简介" },
              { key: "centralQuestion", label: "核心悬念" },
              { key: "endingDirection", label: "结局方向" },
            ].map(({ key, label }) => (
              <div key={key} className="group">
                <label className="text-[10px] text-slate-400">{label}</label>
                {editingField === key ? (
                  <div className="flex gap-1">
                    <textarea value={editingValue} onChange={e => setEditingValue(e.target.value)}
                      className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={3}
                      onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); saveEdit(key); } }} />
                    <button onClick={() => saveEdit(key)} className="text-[10px] text-brand-600 hover:underline shrink-0">保存</button>
                    <button onClick={() => setEditingField(null)} className="text-[10px] text-slate-400 hover:underline shrink-0">取消</button>
                  </div>
                ) : (
                  <p onClick={() => startEdit(key, (novel as unknown as Record<string,string>)[key] ?? "")}
                    className="text-xs text-slate-600 mt-0.5 cursor-pointer hover:bg-slate-50 rounded px-1 -ml-1 whitespace-pre-wrap">
                    {(novel as unknown as Record<string,string>)[key] || <span className="text-slate-300">点击编辑…</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-4 text-center">点击上方按钮 AI 生成故事核心，或手动填写灵感后生成</p>
        )}
      </section>

      {/* ── 4. 商业定位 ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-1.5">
          <Globe size={14} /> 商业定位
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {[
            { key: "targetAudience", label: "目标读者", value: targetAudience, setter: setTargetAudience, placeholder: "如：25-35岁男性，偏好硬核设定和逻辑推演" },
            { key: "bookSellingPoint", label: "核心卖点", value: bookSellingPoint, setter: setBookSellingPoint, placeholder: "如：克苏鲁序列体系 × 硬核侦探推理" },
            { key: "first30ChapterPromise", label: "前30章承诺", value: first30Promise, setter: setFirst30Promise, placeholder: "前5章… 6-15章… 16-30章…" },
            { key: "competingFeel", label: "差异化感受", value: competingFeel, setter: setCompetingFeel, placeholder: "区别于同类作品的独特阅读余味" },
            { key: "commercialTags", label: "商业标签（逗号分隔）", value: commercialTags, setter: setCommercialTags, placeholder: "如：克苏鲁, 序列晋升, 非爽文向" },
          ].map(({ key, label, value, setter, placeholder }) => (
            <div key={key}>
              <label className="text-[10px] text-slate-400">{label}</label>
              {key === "first30ChapterPromise" || key === "competingFeel" ? (
                <textarea value={value} onChange={e => setter(e.target.value)}
                  onBlur={() => quickSave(key, value)}
                  placeholder={placeholder}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs resize-y focus:border-brand-300 focus:outline-none" rows={2} />
              ) : (
                <input value={value} onChange={e => setter(e.target.value)}
                  onBlur={() => quickSave(key, key === "commercialTags" ? value : value)}
                  placeholder={placeholder}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-brand-300 focus:outline-none" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
