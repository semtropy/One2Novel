/**
 * PlanningHubPage — 创作决策中枢 (6-Step Linear Pipeline)
 *
 * Steps: 创作起点 → 架构选择 → 角色阵容 → 章节蓝图 → 发布定位 → 进入写作
 *
 * 单流水线设计：域名组件持有步骤完成权，导航只负责页面切换。
 * 每步的域名组件内部提供「确认」按钮，调用后端 /pipeline/step/:stepName 持久化状态，
 * 成功后回调 onComplete() 标记步骤完成，用户再点击「下一步」切换页面。
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  BookOpen, GitBranch, Users, Map, Target,
  PenLine, ChevronRight, ChevronLeft,
  CheckCircle, ChevronDown, ChevronUp, FileSearch,
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
  { id: "input",        label: "创作起点", icon: BookOpen,    hint: "输入灵感 · 生成故事核心 · 上传参考书（可选）· 确定创作参数" },
  { id: "architecture", label: "架构选择", icon: GitBranch,   hint: "选择架构模板 · 设定金手指 · 世界规则 · 终局悬念" },
  { id: "characters",   label: "角色阵容", icon: Users,       hint: "AI 生成角色 · 设置功能标签 · 编辑关系网络" },
  { id: "blueprint",    label: "章节蓝图", icon: Map,         hint: "生成回环骨架 · 逐卷展开 · 章节分配" },
  { id: "calibration",  label: "发布定位", icon: Target,      hint: "商业定位 · 爽点配方 · 期待管理 · 设定释放计划" },
  { id: "writing",      label: "进入写作", icon: PenLine,     hint: "确认所有规划，进入写作工作台" },
];

export function PlanningHubPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const { data: novel, isLoading, error } = useNovel(novelId);

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set([0]));
  const [stepCompleting, setStepCompleting] = useState(false);

  // Step1 sub-panel toggle: 参考书分析（可选）
  const [showReference, setShowReference] = useState(false);

  // Step2 sub-tab: 架构选择 / 世界规则
  const [archSubTab, setArchSubTab] = useState<"arch" | "world">("arch");

  // Load persisted pipeline state on mount
  useEffect(() => {
    if (!novelId) return;
    api.get(`/novels/${novelId}/pipeline/state`).then(({ data }) => {
      const state = data?.data;
      if (state?.steps) {
        const completed = new Set<number>();
        const stepOrder = STEPS.map(s => s.id);
        stepOrder.forEach((id, idx) => {
          if (state.steps[id]?.status === "completed" || state.steps[id]?.status === "skipped") {
            completed.add(idx);
          }
        });
        setCompletedSteps(completed);
        // Set current to the first incomplete step
        const nextIncomplete = stepOrder.findIndex((_id, idx) => !completed.has(idx));
        setCurrentStep(nextIncomplete >= 0 ? nextIncomplete : 0);
      }
    }).catch(() => {});
  }, [novelId]);

  // Callback: domain component calls this after its step action succeeds
  const onStepComplete = useCallback((stepIdx: number) => {
    setCompletedSteps(prev => { const next = new Set(prev); next.add(stepIdx); return next; });
  }, []);

  const goToNext = () => {
    if (!completedSteps.has(currentStep)) return; // 当前步骤尚未完成
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goToPrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const goToStep = (idx: number) => {
    if (completedSteps.has(idx)) setCurrentStep(idx);
  };

  const handleEnterWriting = () => {
    if (novelId) navigate(`/novels/${novelId}/write`);
  };

  if (isLoading) return <Loading text="加载中..." />;
  if (error || !novel) return (
    <div className="flex flex-col items-center py-20">
      <p className="text-sm text-red-500">加载失败</p>
      <button onClick={() => navigate("/")} className="mt-4 text-xs text-slate-500 underline">返回首页</button>
    </div>
  );

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="h-full flex flex-col max-h-full">
      {/* Top bar */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TitleEditor novelId={novel.id} currentTitle={novel.title} />
          {novel.genre && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{novel.genre}</span>}
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-600 font-medium">长篇</span>
        </div>
        <button
          onClick={handleEnterWriting}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700 transition-colors"
        >
          <PenLine size={13} />进入写作
        </button>
      </div>

      {/* Manual step-by-step pipeline */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Step Progress Indicator */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-6 py-3">
          <div className="flex items-center justify-center gap-0.5 max-w-4xl mx-auto flex-wrap">
            {STEPS.map((step, idx) => {
              const isActive = idx === currentStep;
              const isDone = completedSteps.has(idx) && !isActive;
              const isClickable = completedSteps.has(idx) || isActive;

              return (
                <div key={step.id} className="flex items-center gap-0.5">
                  <button
                    onClick={() => goToStep(idx)}
                    disabled={!isClickable}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                      isActive && "bg-indigo-600 text-white shadow-sm",
                      isDone && "bg-green-50 text-green-700 border border-green-200",
                      !isActive && !isDone && isClickable && "bg-white text-slate-500 border border-slate-200 hover:border-slate-300",
                      !isClickable && "bg-white text-slate-300 border border-slate-100 cursor-not-allowed",
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
              {/* Step 0: 创作起点 — 故事核心 + 参考书分析（可选） */}
              {currentStep === 0 && (
                <div className="space-y-6">
                  <StoryCoreDomain
                    novelId={novel.id}
                    onComplete={() => onStepComplete(0)}
                  />

                  {/* Reference Book (optional, collapsible) */}
                  <div className="border-t border-slate-100 pt-4">
                    <button
                      onClick={() => setShowReference(!showReference)}
                      className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                    >
                      <FileSearch size={14} />
                      参考书分析（可选）
                      {showReference ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <p className="text-xs text-slate-400 mt-1 mb-2">
                      上传对标小说的 .txt 文件，AI 将分析其回环结构、爽点分布和写作技法，为后续架构选择提供参考
                    </p>
                    {showReference && (
                      <div className="mt-3">
                        <ReferenceDomain novelId={novel.id} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 1: 架构选择 — 架构模板 + 世界规则子标签 */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  {/* Sub-tab bar */}
                  <div className="flex gap-1 border-b border-slate-100 pb-2">
                    <button
                      onClick={() => setArchSubTab("arch")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        archSubTab === "arch"
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                      )}
                    >
                      <GitBranch size={12} />
                      架构与金手指
                    </button>
                    <button
                      onClick={() => setArchSubTab("world")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        archSubTab === "world"
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                      )}
                    >
                      <Target size={12} />
                      世界规则
                    </button>
                  </div>

                  {archSubTab === "arch" ? (
                    <ArchitectureDomain
                      novelId={novel.id}
                      onComplete={() => onStepComplete(1)}
                    />
                  ) : (
                    <WorldPanel novelId={novel.id} />
                  )}
                </div>
              )}

              {/* Step 2: 角色阵容 */}
              {currentStep === 2 && (
                <CharactersDomain
                  novelId={novel.id}
                  onComplete={() => onStepComplete(2)}
                />
              )}

              {/* Step 3: 章节蓝图 */}
              {currentStep === 3 && (
                <BlueprintDomain
                  novelId={novel.id}
                  onComplete={() => onStepComplete(3)}
                />
              )}

              {/* Step 4: 发布定位 */}
              {currentStep === 4 && (
                <PositioningDomain
                  novelId={novel.id}
                  onComplete={() => onStepComplete(4)}
                />
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
                    className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm transition-colors"
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
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                <ChevronLeft size={14} />
                上一步
              </button>

              <span className="text-xs text-slate-400">
                {currentStep + 1} / {STEPS.length}
              </span>

              {!isLastStep ? (
                <button
                  onClick={goToNext}
                  disabled={!completedSteps.has(currentStep)}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-medium transition-colors",
                    completedSteps.has(currentStep)
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed",
                  )}
                >
                  {completedSteps.has(currentStep) ? (
                    <>下一步<ChevronRight size={14} /></>
                  ) : (
                    <>请先完成当前步骤</>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleEnterWriting}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                >
                  开始写作
                  <PenLine size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
