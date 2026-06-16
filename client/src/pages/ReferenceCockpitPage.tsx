/**
 * ReferenceCockpitPage — 参考书分析驾驶舱
 * 一站式触发7维AI分析，展示结果，一键应用到创作配置。
 */
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Upload, Sparkles, Check, RefreshCw, Target, BookOpen, Zap,
  GitBranch, TrendingUp, Eye, FileText, ArrowLeft,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovel, useExtractWritingAssets, useCreateStyleProfileFromAssets } from "../api/novel";
import { api } from "../app/api";
import { cn } from "../lib/cn";
import { Loading } from "../components/common/Loading";

interface AnalysisState {
  loops?: { done: boolean; data?: unknown };
  coolpoints?: { done: boolean; data?: unknown };
  architecture?: { done: boolean; data?: { type: string; confidence: number; reasoning: string; observedPatterns: string[] } };
  hooks?: { done: boolean; data?: { distribution: Record<string, number>; avgHookStrength: number; typicalHookStyle: string } };
  goldenFinger?: { done: boolean; data?: { abilities: string[]; limits: string[] } };
  timeline?: { done: boolean; data?: Array<{ chapterIndex: number; settingName: string; description: string }> };
  writing?: { done: boolean; data?: unknown };
}

const ANALYSIS_KEYS = ["loops", "coolpoints", "architecture", "hooks", "goldenFinger", "timeline", "writing"] as const;

export function ReferenceCockpitPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const qc = useQueryClient();
  const { data: novel } = useNovel(novelId);
  const extractWriting = useExtractWritingAssets();
  const createProfile = useCreateStyleProfileFromAssets();

  const [fileName, setFileName] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisState>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);
  const [profileCreated, setProfileCreated] = useState(false);
  const [appliedArch, setAppliedArch] = useState(false);
  const [stats, setStats] = useState<{ totalChapters: number; totalLoops: number } | null>(null);

  const nid = novelId!;
  const doneCount = ANALYSIS_KEYS.filter(k => analysis[k]?.done).length;

  useEffect(() => { loadState(); }, [nid]);

  async function loadState() {
    try {
      const { data } = await api.get(`/novels/${nid}/reference-book`);
      if (data.data?.fileName) setFileName(data.data.fileName);
      const annot = data.data?.annotations ? (typeof data.data.annotations === "string" ? JSON.parse(data.data.annotations) : data.data.annotations) : null;
      const newAnalysis: AnalysisState = {};
      if (annot?.loopBoundaries?.length > 0) newAnalysis.loops = { done: true, data: annot };
      if (annot?.highCoolChapters?.length > 0 || annot?.lowCoolChapters?.length > 0) newAnalysis.coolpoints = { done: true, data: annot };
      if (annot?.detectedArchitecture) newAnalysis.architecture = { done: true, data: annot.detectedArchitecture };
      if (annot?.hookPatterns) newAnalysis.hooks = { done: true, data: annot.hookPatterns };
      if (annot?.goldenFingerBounds) newAnalysis.goldenFinger = { done: true, data: annot.goldenFingerBounds };
      if (annot?.keySettings?.length > 0) newAnalysis.timeline = { done: true, data: annot.keySettings };
      if (data.data?.writingAssets) newAnalysis.writing = { done: true, data: JSON.parse(data.data.writingAssets) };
      setAnalysis(newAnalysis);
      if (data.data?.totalChapters) setStats({ totalChapters: data.data.totalChapters, totalLoops: annot?.loopBoundaries?.filter((b: {type:string}) => b.type === "start").length ?? 0 });
    } catch {}
  }

  async function runAnalysis(key: string) {
    setRunning(key);
    try {
      if (key === "loops") await api.post(`/novels/${nid}/reference-book/infer-loops`);
      else if (key === "coolpoints") await api.post(`/novels/${nid}/reference-book/infer-coolpoints`);
      else if (key === "architecture") await api.post(`/novels/${nid}/reference-book/detect-architecture`);
      else if (key === "hooks") await api.post(`/novels/${nid}/reference-book/extract-hook-patterns`);
      else if (key === "goldenFinger") await api.post(`/novels/${nid}/reference-book/extract-golden-finger`);
      else if (key === "timeline") await api.post(`/novels/${nid}/reference-book/extract-setting-timeline`);
      else if (key === "writing") await extractWriting.mutateAsync(nid);
    } catch {} finally { setRunning(null); }
    await loadState();
  }

  async function handleRunAll() {
    setRunAll(true);
    for (const key of ANALYSIS_KEYS) {
      if (!analysis[key]?.done) await runAnalysis(key);
    }
    setRunAll(false);
  }

  async function handleUpload(text: string, name: string) {
    setUploadMsg("上传中...");
    try {
      await api.post(`/novels/${nid}/reference-book`, { fileName: name, content: text });
      setUploadMsg("上传成功"); setFileName(name); loadState();
    } catch { setUploadMsg("上传失败"); }
  }

  async function handleRemove() {
    try { await api.delete(`/novels/${nid}/reference-book`); setFileName(""); setUploadMsg(""); setAnalysis({}); setStats(null); qc.invalidateQueries({ queryKey: ["novel", nid] }); } catch {}
  }

  async function handleApplyArchitecture() {
    if (!analysis.architecture?.data) return;
    const arch = analysis.architecture.data;
    try {
      await api.post(`/novels/${nid}/pipeline/step/architecture`, {
        architectureType: arch.type,
        goldenFinger: analysis.goldenFinger?.data,
        centralQuestion: novel?.centralQuestion,
        endingDirection: novel?.endingDirection,
      });
      setAppliedArch(true);
      qc.invalidateQueries({ queryKey: ["novel", nid] });
    } catch {}
  }

  async function handleCreateProfile() {
    try { await createProfile.mutateAsync(nid); setProfileCreated(true); } catch {}
  }

  if (!novel) return <Loading text="加载中..." />;

  const archData = analysis.architecture?.data;
  const hookData = analysis.hooks?.data;
  const gfData = analysis.goldenFinger?.data;
  const timelineData = analysis.timeline?.data;
  const writingData = analysis.writing?.data as { overallStyleDescription?: string; narrativeAssets?: unknown[]; languageAssets?: unknown[]; characterAssets?: unknown[]; rhythmAssets?: unknown[]; antiAiAssets?: unknown[] } | undefined;

  return (
    <div className="h-full flex flex-col max-h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/novels/${novel.id}/plan`} className="text-slate-400 hover:text-slate-600"><ArrowLeft size={16} /></Link>
          <h2 className="text-sm font-semibold text-slate-800">参考书分析驾驶舱</h2>
          {fileName && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{fileName}</span>}
        </div>
        <div className="flex items-center gap-2">
          {doneCount < 7 && (
            <button onClick={handleRunAll} disabled={runAll || !fileName}
              className={cn("flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors",
                runAll ? "bg-slate-400" : "bg-brand-600 hover:bg-brand-700")}>
              {runAll ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
              {runAll ? "分析中..." : "一键全部分析"}
            </button>
          )}
          <div className="text-xs text-slate-400">{doneCount}/7 项完成</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Upload section */}
          {!fileName && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-12 text-center">
              <Upload size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-600 mb-1">上传对标网络小说的 .txt 文件</p>
              <p className="text-xs text-slate-400 mb-4">支持100万字以上，AI将分析回环结构、爽点分布、写作技法等7个维度</p>
              <label className="inline-block cursor-pointer rounded-lg bg-slate-800 px-5 py-2 text-xs font-medium text-white hover:bg-slate-700">
                选择文件
                <input type="file" accept=".txt" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) { setFileName(file.name); const r = new FileReader(); r.onload = ev => handleUpload(ev.target?.result as string, file.name); r.readAsText(file); }
                }} />
              </label>
              {uploadMsg && <p className={`text-xs mt-2 ${uploadMsg.includes("失败") ? "text-red-500" : "text-green-600"}`}>{uploadMsg}</p>}
            </div>
          )}

          {fileName && stats && (
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
                <div className="text-slate-400">总章数</div>
                <div className="text-lg font-bold text-slate-700">{stats.totalChapters}</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
                <div className="text-slate-400">回环数</div>
                <div className="text-lg font-bold text-slate-700">{stats.totalLoops || "—"}</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3 text-center">
                <div className="text-slate-400">完成分析</div>
                <div className="text-lg font-bold text-brand-600">{doneCount}/7</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 p-3 flex items-center justify-center">
                <button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-600">移除参考书</button>
              </div>
            </div>
          )}

          {/* Analysis Cards Grid */}
          {fileName && (
            <div className="grid grid-cols-2 gap-4">
              {/* Architecture Detection */}
              <AnalysisCard title="架构判定" icon={GitBranch} done={analysis.architecture?.done} running={running === "architecture"} onRun={() => runAnalysis("architecture")}>
                {archData && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">{ARCH_LABELS[archData.type] ?? archData.type}</span>
                      <span className="text-xs text-slate-400">置信度 {(archData.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-slate-500">{archData.reasoning}</p>
                    {archData.observedPatterns?.length > 0 && (
                      <div className="flex flex-wrap gap-1">{archData.observedPatterns.map((p: string, i: number) => <span key={i} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600">{p}</span>)}</div>
                    )}
                    <button onClick={handleApplyArchitecture} disabled={appliedArch}
                      className={cn("w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        appliedArch ? "bg-green-100 text-green-700" : "bg-slate-900 text-white hover:bg-slate-800")}>
                      {appliedArch ? <><Check size={10} className="inline mr-1" />已应用</> : "应用到当前小说"}
                    </button>
                  </div>
                )}
              </AnalysisCard>

              {/* Cool Point Distribution */}
              <AnalysisCard title="爽点分布" icon={TrendingUp} done={analysis.coolpoints?.done} running={running === "coolpoints"} onRun={() => runAnalysis("coolpoints")}>
                {analysis.coolpoints?.done ? (
                  <div className="text-xs text-slate-500">
                    爽点分析已完成。
                  </div>
                ) : null}
              </AnalysisCard>

              {/* Hook Patterns */}
              <AnalysisCard title="钩子模式" icon={Eye} done={analysis.hooks?.done} running={running === "hooks"} onRun={() => runAnalysis("hooks")}>
                {hookData && (
                  <div className="space-y-1 text-xs">
                    {Object.entries(hookData.distribution ?? {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-slate-500">{HOOK_LABELS[k] ?? k}</span><span className="font-medium text-slate-700">{v as number}章</span></div>
                    ))}
                    <div className="border-t border-slate-100 pt-1 mt-1">
                      <span className="text-slate-400">平均钩力 {(hookData.avgHookStrength * 100).toFixed(0)}% · {hookData.typicalHookStyle}</span>
                    </div>
                  </div>
                )}
              </AnalysisCard>

              {/* Golden Finger */}
              <AnalysisCard title="金手指提取" icon={Sparkles} done={analysis.goldenFinger?.done} running={running === "goldenFinger"} onRun={() => runAnalysis("goldenFinger")}>
                {gfData && (
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="font-medium text-slate-600">能力：</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">{gfData.abilities.map((a: string, i: number) => <span key={i} className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">{a}</span>)}</div>
                    </div>
                    <div>
                      <span className="font-medium text-slate-600">限制：</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">{gfData.limits.map((l: string, i: number) => <span key={i} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">{l}</span>)}</div>
                    </div>
                  </div>
                )}
              </AnalysisCard>

              {/* Setting Timeline */}
              <AnalysisCard title="设定释放时间线" icon={FileText} done={analysis.timeline?.done} running={running === "timeline"} onRun={() => runAnalysis("timeline")}>
                {timelineData && (
                  <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                    {(timelineData as Array<{chapterIndex: number; settingName: string}>).slice(0, 10).map((s, i) => (
                      <div key={i} className="flex items-center gap-2"><span className="w-12 text-slate-400 shrink-0">第{s.chapterIndex}章</span><span className="text-slate-600">{s.settingName}</span></div>
                    ))}
                  </div>
                )}
              </AnalysisCard>

              {/* Writing Assets */}
              <AnalysisCard title="写法技法" icon={BookOpen} done={analysis.writing?.done} running={running === "writing"} onRun={() => runAnalysis("writing")}>
                {writingData && (
                  <div className="space-y-2">
                    {writingData.overallStyleDescription && <p className="text-xs text-slate-600 leading-relaxed">{writingData.overallStyleDescription}</p>}
                    <div className="grid grid-cols-5 gap-1 text-[10px]">
                      {[{label:"叙事",n:writingData.narrativeAssets?.length},{label:"语言",n:writingData.languageAssets?.length},{label:"角色",n:writingData.characterAssets?.length},{label:"节奏",n:writingData.rhythmAssets?.length},{label:"反AI",n:writingData.antiAiAssets?.length}].map(c => (
                        <div key={c.label} className="rounded bg-slate-50 px-2 py-1 text-center"><div className="font-bold text-brand-600">{c.n ?? 0}</div><div className="text-slate-400">{c.label}</div></div>
                      ))}
                    </div>
                    <button onClick={handleCreateProfile} disabled={profileCreated || createProfile.isPending}
                      className={cn("w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        profileCreated ? "bg-green-100 text-green-700" : "bg-slate-900 text-white hover:bg-slate-800")}>
                      {profileCreated ? <><Check size={10} className="inline mr-1" />风格配置已创建</> : createProfile.isPending ? "创建中..." : "创建风格配置"}
                    </button>
                  </div>
                )}
              </AnalysisCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function AnalysisCard({ title, icon: Icon, done, running, onRun, children }: {
  title: string; icon: any; done?: boolean; running?: boolean; onRun: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-4", done ? "border-green-200 bg-green-50/20" : "border-slate-200 bg-white")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={done ? "text-green-500" : "text-slate-400"}><Icon size={14} /></span>
          <h3 className="text-sm font-medium text-slate-700">{title}</h3>
          {done && <Check size={12} className="text-green-500" />}
        </div>
        {!done && (
          <button onClick={onRun} disabled={running}
            className="flex items-center gap-1 rounded border bg-slate-800 text-white px-2.5 py-1 text-xs font-medium hover:bg-slate-700 rounded-lg disabled:opacity-50">
            {running ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {running ? "分析中" : "分析"}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const ARCH_LABELS: Record<string, string> = {
  skill_slot: "技能栏搭配", sequence_promotion: "序列晋升", case_driven: "超凡办案",
  cultivation_planning: "修真规划", hexagon_godhood: "六边形成神", historical_transmigration: "穿越历史",
};
const HOOK_LABELS: Record<string, string> = {
  suspense: "悬念型", reversal: "反转型", preview: "预告型", emotional: "情绪型",
};
