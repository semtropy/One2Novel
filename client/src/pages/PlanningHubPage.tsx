/**
 * PlanningHubPage — 创作决策中枢 (6-Step Pipeline, 自由导航)
 *
 * Steps: 创作起点 → 架构选择 → 角色阵容 → 章节蓝图 → 发布定位 → 进入写作
 * 所有步骤可任意点击跳转，不强制线性完成。
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  BookOpen, GitBranch, Users, Map, Target,
  PenLine, ChevronRight, ChevronLeft, CheckCircle, Upload, Sparkles,
} from "lucide-react";
import { useNovel } from "../api/novel";
import { api } from "../app/api";
import { TitleEditor } from "../components/novel/TitleEditor";
import { Loading } from "../components/common/Loading";
import { cn } from "../lib/cn";

// Domain panels
import { StoryCoreDomain } from "../components/planning/StoryCoreDomain";
import { ReferenceDomain } from "../components/planning/ReferenceDomain";
import { ArchitectureDomain } from "../components/planning/ArchitectureDomain";
import { WorldPanel } from "../components/planning/WorldPanel";
import { CharactersDomain } from "../components/planning/CharactersDomain";
import { BlueprintDomain } from "../components/planning/BlueprintDomain";
import { PositioningDomain } from "../components/planning/PositioningDomain";

const STEPS = [
  { id: "input",        label: "创作起点", icon: BookOpen,    hint: "故事核心 · 世界规则 · 金手指设定" },
  { id: "architecture", label: "架构选择", icon: GitBranch,   hint: "内置架构模板 · 参考书分析" },
  { id: "characters",   label: "角色阵容", icon: Users,       hint: "AI 生成角色 · 设置功能标签 · 编辑关系网络" },
  { id: "blueprint",    label: "章节蓝图", icon: Map,         hint: "生成回环骨架 · 逐卷展开 · 章节分配" },
  { id: "calibration",  label: "发布定位", icon: Target,      hint: "商业定位 · 爽点配方 · 期待管理" },
  { id: "writing",      label: "进入写作", icon: PenLine,     hint: "确认所有规划，进入写作工作台" },
];

export function PlanningHubPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const { data: novel, isLoading, error } = useNovel(novelId);

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set([0]));

  // Step sub-tabs: Step0(arch/world/golden) Step1(arch/reference)
  const [subTab, setSubTab] = useState("arch");

  // Load persisted pipeline state on mount
  useEffect(() => {
    if (!novelId) return;
    api.get(`/novels/${novelId}/pipeline/state`).then(({ data }) => {
      const state = data?.data;
      if (state?.steps) {
        const completed = new Set<number>();
        STEPS.forEach((s, idx) => {
          if (state.steps[s.id]?.status === "completed" || state.steps[s.id]?.status === "skipped") {
            completed.add(idx);
          }
        });
        setCompletedSteps(completed);
      }
    }).catch(() => {});
  }, [novelId]);

  const onStepComplete = useCallback((stepIdx: number) => {
    setCompletedSteps(prev => { const next = new Set(prev); next.add(stepIdx); return next; });
  }, []);

  // Free navigation — any step clickable at any time
  const goToStep = (idx: number) => { setCurrentStep(idx); setSubTab("arch"); };

  const goToNext = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const goToPrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleEnterWriting = () => {
    if (novelId) navigate(`/novels/${novelId}/write`);
  };

  if (isLoading) return <Loading text="加载中..." />;
  if (error || !novel) return (
    <div className="flex flex-col items-center py-20">
      <p className="text-sm text-red-500">加载失败</p>
      <button onClick={() => navigate("/")} className="mt-4 text-xs text-slate-700 underline">返回首页</button>
    </div>
  );

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="h-full flex flex-col max-h-full">
      {/* Top bar */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TitleEditor novelId={novel.id} currentTitle={novel.title} />
          {novel.genre && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">{novel.genre}</span>}
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 font-medium">长篇</span>
        </div>
        <button
          onClick={handleEnterWriting}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
        >
          <PenLine size={13} />进入写作
        </button>
      </div>

      {/* Step pipeline */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Step Progress Indicator — all steps clickable */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-6 py-3">
          <div className="flex items-center justify-center gap-0.5 max-w-4xl mx-auto flex-wrap">
            {STEPS.map((step, idx) => {
              const isActive = idx === currentStep;
              const isDone = completedSteps.has(idx) && !isActive;

              return (
                <div key={step.id} className="flex items-center gap-0.5">
                  <button
                    onClick={() => goToStep(idx)}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                      isActive && "bg-slate-900 text-white shadow-sm",
                      isDone && "bg-slate-700 text-white",
                      !isActive && !isDone && "bg-white text-slate-700 border border-slate-300 hover:border-slate-400",
                    )}
                    title={step.hint}
                  >
                    {isDone ? (
                      <CheckCircle size={11} />
                    ) : (
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20">
                        {idx + 1}
                      </span>
                    )}
                    <span className="hidden sm:inline">{step.label}</span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={cn(
                      "w-3 h-px",
                      completedSteps.has(idx) ? "bg-green-300" : "bg-slate-200",
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-4xl mx-auto">
            <div className="rounded-xl border border-slate-200 bg-white p-6 min-h-[400px]">

              {/* Step 0: 创作起点 — 故事核心 + 世界规则 + 金手指 */}
              {currentStep === 0 && (
                <div className="space-y-4">
                  <div className="flex gap-1 border-b border-slate-100 pb-2">
                    <button onClick={() => setSubTab("arch")}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        subTab === "arch" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                      <BookOpen size={12} />故事核心
                    </button>
                    <button onClick={() => setSubTab("world")}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        subTab === "world" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                      <Target size={12} />世界规则
                    </button>
                    <button onClick={() => setSubTab("golden")}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        subTab === "golden" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                      <Sparkles size={12} />金手指
                    </button>
                  </div>
                  {subTab === "arch" ? (
                    <StoryCoreDomain novelId={novel.id} onComplete={() => onStepComplete(0)} />
                  ) : subTab === "world" ? (
                    <WorldPanel novelId={novel.id} />
                  ) : (
                    <GoldenFingerPanel novelId={novel.id} />
                  )}
                </div>
              )}

              {/* Step 1: 架构选择 — 内置架构 | 参考书分析 */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="flex gap-1 border-b border-slate-100 pb-2">
                    <button onClick={() => setSubTab("arch")}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        subTab === "arch" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                      <GitBranch size={12} />内置架构
                    </button>
                    <button onClick={() => setSubTab("reference")}
                      className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        subTab === "reference" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                      <Upload size={12} />参考书分析
                    </button>
                  </div>
                  {subTab === "arch" ? (
                    <ArchitectureDomain novelId={novel.id} onComplete={() => onStepComplete(1)} />
                  ) : (
                    <ReferenceDomain novelId={novel.id} />
                  )}
                </div>
              )}

              {/* Step 2: 角色阵容 */}
              {currentStep === 2 && (
                <CharactersDomain novelId={novel.id} onComplete={() => onStepComplete(2)} />
              )}

              {/* Step 3: 章节蓝图 */}
              {currentStep === 3 && (
                <BlueprintDomain novelId={novel.id} onComplete={() => onStepComplete(3)} />
              )}

              {/* Step 4: 发布定位 */}
              {currentStep === 4 && (
                <PositioningDomain novelId={novel.id} onComplete={() => onStepComplete(4)} />
              )}

              {/* Step 5: 进入写作 */}
              {currentStep === 5 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle size={48} className="mb-4 text-green-400" />
                  <h3 className="text-lg font-bold text-slate-800 mb-2">规划完成</h3>
                  <p className="text-sm text-slate-500 mb-6 max-w-md">
                    你已经完成了所有规划步骤。故事核心、架构、角色、蓝图和发布定位都已就绪。
                  </p>
                  <button
                    onClick={handleEnterWriting}
                    className="rounded-xl bg-slate-900 px-8 py-3 text-sm font-medium text-white hover:bg-slate-800 shadow-sm transition-colors"
                  >
                    <PenLine size={16} className="inline mr-2" />
                    进入写作工作台
                  </button>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={goToPrev}
                disabled={currentStep === 0}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-4 py-2 text-sm transition-colors",
                  currentStep === 0
                    ? "border-slate-100 text-slate-300 cursor-not-allowed"
                    : "border-slate-300 text-slate-700 hover:bg-slate-100",
                )}
              >
                <ChevronLeft size={14} />上一步
              </button>

              <span className="text-xs text-slate-500">{currentStep + 1} / {STEPS.length}</span>

              {!isLastStep ? (
                <button
                  onClick={goToNext}
                  className="flex items-center gap-1 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                >
                  下一步<ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleEnterWriting}
                  className="flex items-center gap-1 rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                >
                  开始写作<PenLine size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoldenFingerPanel({ novelId }: { novelId: string }) {
  const { data: novel } = useNovel(novelId);
  const [abilities, setAbilities] = useState("");
  const [limits, setLimits] = useState("");

  useEffect(() => {
    if (novel?.goldenFinger) {
      try {
        const gf = JSON.parse(novel.goldenFinger);
        if (Array.isArray(gf.abilities)) setAbilities(gf.abilities.join("\n"));
        if (Array.isArray(gf.limits)) setLimits(gf.limits.join("\n"));
      } catch {}
    }
  }, [novel?.goldenFinger]);

  async function handleSave() {
    const abilityList = abilities.split("\n").filter(Boolean);
    const limitList = limits.split("\n").filter(Boolean);
    await api.patch(`/novels/${novelId}`, { goldenFinger: JSON.stringify({ abilities: abilityList, limits: limitList }) });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">设定主角的独特能力及其边界——网文最核心的爽点引擎。能力的稀缺感和代价感比能力本身更重要。</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-xs font-medium text-slate-500">能力清单</span>
          <textarea className="w-full mt-1 rounded-lg border border-slate-200 p-2.5 text-xs resize-none focus:border-slate-400 focus:outline-none" rows={6}
            value={abilities} onChange={e => setAbilities(e.target.value)} placeholder="每行一条能力" />
        </div>
        <div>
          <span className="text-xs font-medium text-slate-500">限制清单</span>
          <textarea className="w-full mt-1 rounded-lg border border-slate-200 p-2.5 text-xs resize-none focus:border-slate-400 focus:outline-none" rows={6}
            value={limits} onChange={e => setLimits(e.target.value)} placeholder="每行一条限制" />
        </div>
      </div>
      <button onClick={handleSave} className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
        保存金手指设定
      </button>
    </div>
  );
}
