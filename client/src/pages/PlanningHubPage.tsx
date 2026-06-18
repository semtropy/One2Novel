/**
 * PlanningHubPage — 创作决策中枢 (4-Step Pipeline, 自由导航)
 *
 * Steps: 创作起点 → 架构选择 → 角色阵容 → 章节大纲
 * 串行流水线：每步 AI 生成接收前序全部输出作为上下文。
 * 所有步骤可任意点击跳转（开发便利），不强制 UI 锁定。
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  BookOpen, GitBranch, Users, Map,
  PenLine, ChevronRight, ChevronLeft, CheckCircle,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useNovel } from "../api/novel";
import { api } from "../app/api";
import { TitleEditor } from "../components/novel/TitleEditor";
import { Loading } from "../components/common/Loading";
// Domain panels
import { FoundationDomain } from "../components/planning/FoundationDomain";
import { WorldDomain } from "../components/planning/WorldDomain";
import { CharactersDomain } from "../components/planning/CharactersDomain";
import { BlueprintDomain } from "../components/planning/BlueprintDomain";

const STEPS = [
  { id: "foundation",   label: "故事核心", icon: BookOpen,    hint: "灵感 → 故事核心 · 创意参数 · 商业定位" },
  { id: "architecture", label: "世界构建", icon: GitBranch,   hint: "架构选择 · 力量体系树 · 世界规则 · 金手指" },
  { id: "characters",   label: "角色阵容", icon: Users,       hint: "AI 生成角色 · 功能标签 · 关系网络 · 演化轨迹" },
  { id: "outline",      label: "章节大纲", icon: Map,         hint: "回环骨架 → 逐卷展开 · 设定释放计划" },
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

              {/* Step 0: 故事核心 — 灵感输入 + AI 生成 + 创意参数 + 商业定位 */}
              {currentStep === 0 && (
                <FoundationDomain novelId={novel.id} onComplete={() => onStepComplete(0)} />
              )}

              {/* Step 1: 世界构建 — 架构选择 + 力量体系树 + 世界规则 + 金手指 */}
              {currentStep === 1 && (
                <WorldDomain novelId={novel.id} onComplete={() => onStepComplete(1)} />
              )}

              {/* Step 2: 角色阵容 */}
              {currentStep === 2 && (
                <CharactersDomain novelId={novel.id} onComplete={() => onStepComplete(2)} />
              )}

              {/* Step 3: 章节大纲 */}
              {currentStep === 3 && (
                <BlueprintDomain novelId={novel.id} onComplete={() => onStepComplete(3)} />
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

// GoldenFingerPanel removed — now integrated into FoundationDomain
