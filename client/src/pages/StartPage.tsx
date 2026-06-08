import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, PenLine, Sparkles, Check } from "lucide-react";
import { useCreateNovel, useQuickStart } from "../api/novel";
import { FakeProgress } from "../components/common/FakeProgress";

export function StartPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=灵感, 1=生成中, 2=完成
  const [inspiration, setInspiration] = useState("");
  const [novelId, setNovelId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const createNovel = useCreateNovel();
  const quickStart = useQuickStart();

  const handleStart = async () => {
    if (!inspiration.trim()) return;
    setGenerating(true);
    setStep(1);
    try {
      const novel = await createNovel.mutateAsync({
        title: "未命名小说",
        description: inspiration,
      });
      setNovelId(novel.id);
      // Batch generate: story core → characters + blueprint + editorial info
      await quickStart.mutateAsync(novel.id);
      setStep(2);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "生成失败，请重试");
      setStep(0);
    }
    finally { setGenerating(false); }
  };

  const handleEnter = () => {
    if (novelId) navigate(`/novels/${novelId}`);
    else navigate("/novels");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4">
      {/* Step indicator: 2 dots (灵感 → 完成) */}
      <div className="flex items-center gap-2 mb-8">
        {[0, 1].map(i => (
          <div key={i} className={`w-8 h-1 rounded-full transition-colors ${i <= step ? (step === 2 ? "bg-green-400" : "bg-slate-800") : "bg-slate-200"}`} />
        ))}
      </div>

      {/* Step 0: Inspiration */}
      {step === 0 && (
        <div className="w-full max-w-md text-center">
          <BookOpen size={40} className="mx-auto mb-4 text-slate-800" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">从一句灵感开始</h1>
          <p className="text-sm text-slate-500 mb-6">只需一句话，AI 自动推断题材并生成完整的故事框架</p>
          <textarea
            value={inspiration}
            onChange={e => setInspiration(e.target.value)}
            placeholder="请用至少一句话描述你的作品，可以是核心设定，可以是场景片段，甚至只是一个标题。例如：地球上最后一个人独自坐在房间里，这时，忽然响起了敲门声……"
            className="w-full h-28 rounded-xl border border-slate-200 p-4 text-sm resize-none focus:outline-none focus:border-slate-400 placeholder:text-slate-300"
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && inspiration.trim()) {
                e.preventDefault();
                handleStart();
              }
            }}
          />
          <button onClick={() => { setGenError(""); handleStart(); }} disabled={!inspiration.trim()}
            className="w-full mt-4 flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 transition-all">
            <Sparkles size={15} /> 开始创作
          </button>
          {genError && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600 text-left">
              {genError.length > 200 ? "AI 生成遇到问题，请返回重试。如果持续失败，请检查 API Key 配置。" : genError}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            已有小说？
            <button onClick={() => navigate("/novels")} className="text-slate-600 hover:text-slate-800 underline ml-1">进入我的小说</button>
          </p>
        </div>
      )}

      {/* Step 1: Generating */}
      {step === 1 && (
        <div className="w-full max-w-md text-center">
          <div className="mb-6">
            <div className="animate-spin w-10 h-10 border-2 border-slate-800 border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-slate-900 mb-1">AI 正在创作中...</h2>
            <p className="text-sm text-slate-500">分析灵感 → 故事核心 → 角色阵容 → 章节蓝图 → 编辑向信息</p>
          </div>
          <FakeProgress running={generating} />
        </div>
      )}

      {/* Step 2: Done */}
      {step === 2 && (
        <div className="w-full max-w-md text-center">
          <Check size={48} className="mx-auto mb-4 text-green-500" />
          <h2 className="text-lg font-bold text-slate-900 mb-1">故事核心已就绪</h2>
          <p className="text-sm text-slate-500 mb-6">AI 已为你生成故事框架，接下来在写作工作台中规划大纲和角色</p>
          <button onClick={handleEnter}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-6 py-3 text-sm font-medium text-white hover:bg-slate-700 transition-all">
            <PenLine size={15} /> 进入创作工作台
          </button>
          <button onClick={() => navigate("/novels")}
            className="w-full mt-2 text-xs text-slate-400 hover:text-slate-600 py-2">
            查看我的小说列表
          </button>
        </div>
      )}
    </div>
  );
}
