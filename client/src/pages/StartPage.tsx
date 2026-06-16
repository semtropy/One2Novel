/**
 * StartPage — 创作入口页
 * 输入一句灵感 → 创建小说 → 进入规划流程
 * 参考书上传已移至规划流程的「架构选择」步骤。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Sparkles } from "lucide-react";
import { useCreateNovel } from "../api/novel";
import { cn } from "../lib/cn";

const PLACEHOLDER_EXAMPLES = [
  "一个少年在末世觉醒了吞噬异能…",
  "穿越成反派后，我靠写小说成神…",
  "修仙界最后一个阵法师的逆袭之路…",
];

export function StartPage() {
  const navigate = useNavigate();
  const createNovel = useCreateNovel();

  const [inspiration, setInspiration] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const placeholder = PLACEHOLDER_EXAMPLES[Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length)];

  const handleStart = async () => {
    const desc = inspiration.trim();
    if (!desc) {
      setError("请输入你的灵感描述");
      return;
    }
    setCreating(true);
    setError("");

    try {
      const novel = await createNovel.mutateAsync({
        title: "未命名小说",
        description: desc,
      });
      navigate(`/novels/${novel.id}/plan`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="/icon-bw-512.png" alt="One2Novel" className="mx-auto mb-4 w-10 h-10" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">从一句灵感到百万字大作</h1>
          <p className="text-sm text-slate-500">AI 驱动的长篇小说创作工作台</p>
        </div>

        {/* Inspiration Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">输入你的一句话灵感</label>
          <textarea
            className={cn(
              "w-full rounded-xl border bg-white px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 transition-all",
              inspiration ? "border-slate-300 focus:ring-slate-200" : "border-slate-200 focus:ring-slate-200",
            )}
            rows={4}
            placeholder={placeholder}
            value={inspiration}
            onChange={(e) => { setInspiration(e.target.value); setError(""); }}
            maxLength={2000}
            autoFocus
          />
          <p className="text-xs text-slate-400 mt-1 text-right">{inspiration.length}/2000</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        {/* Action */}
        <button
          onClick={handleStart}
          disabled={creating || !inspiration.trim()}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-medium transition-all",
            inspiration.trim()
              ? "bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
              : "bg-slate-200 text-slate-400 cursor-not-allowed",
            creating && "opacity-60",
          )}
        >
          {creating ? (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Sparkles size={18} />
          )}
          开始创作
        </button>

        <button
          onClick={() => navigate("/novels")}
          className="mt-5 w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <BookOpen size={14} />
          已有项目？进入我的小说
        </button>
      </div>
    </div>
  );
}
