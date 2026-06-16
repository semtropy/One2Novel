/**
 * ReferenceDomain — 参考书上传 + 8维分析驾驶舱，内嵌在规划页面中
 */
import { useState, useEffect } from "react";
import { Upload, Sparkles, Check, RefreshCw, Target, BookOpen, Zap, GitBranch, TrendingUp, Eye, FileText, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovel, useExtractWritingAssets, useCreateStyleProfileFromAssets } from "../../api/novel";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

interface Props { novelId: string }

interface AnalysisState {
  loops?: boolean; coolpoints?: boolean; architecture?: boolean;
  hooks?: boolean; goldenFinger?: boolean; timeline?: boolean;
  writing?: boolean; contentBeats?: boolean;
}

type DataMap = Record<string, unknown>;

export function ReferenceDomain({ novelId }: Props) {
  const qc = useQueryClient();
  const { data: novel } = useNovel(novelId);
  const extractWriting = useExtractWritingAssets();
  const createProfile = useCreateStyleProfileFromAssets();

  const [fileName, setFileName] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<AnalysisState>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);
  const [profileCreated, setProfileCreated] = useState(false);
  const [appliedArch, setAppliedArch] = useState(false);
  const [stats, setStats] = useState<{ totalChapters: number; totalLoops: number } | null>(null);
  const [annotData, setAnnotData] = useState<DataMap>({});

  const KEYS = ["loops","coolpoints","architecture","hooks","goldenFinger","timeline","writing","contentBeats"];
  const doneCount = KEYS.filter(k => done[k as keyof AnalysisState]).length;

  useEffect(() => { loadState(); }, [novelId]);

  async function loadState() {
    try {
      const { data } = await api.get(`/novels/${novelId}/reference-book`);
      if (!data.data?.fileName) return;
      setFileName(data.data.fileName);
      const annot = typeof data.data.annotations === "string" ? JSON.parse(data.data.annotations) : (data.data.annotations ?? {});
      const nd: AnalysisState = {};
      if (annot.loopBoundaries?.length > 0) nd.loops = true;
      if (annot.highCoolChapters?.length > 0 || annot.lowCoolChapters?.length > 0) nd.coolpoints = true;
      if (annot.detectedArchitecture) nd.architecture = true;
      if (annot.hookPatterns) nd.hooks = true;
      if (annot.goldenFingerBounds) nd.goldenFinger = true;
      if (annot.keySettings?.length > 0) nd.timeline = true;
      if (data.data.writingAssets) nd.writing = true;
      if (annot.contentBeatPatterns) nd.contentBeats = true;
      setDone(nd);
      setAnnotData(annot);
      setStats({ totalChapters: data.data.totalChapters ?? 0, totalLoops: annot.loopBoundaries?.filter((b: {type:string}) => b.type === "start").length ?? 0 });
    } catch {}
  }

  async function run(k: string) {
    setRunning(k);
    try {
      if (k === "loops") await api.post(`/novels/${novelId}/reference-book/infer-loops`);
      else if (k === "coolpoints") await api.post(`/novels/${novelId}/reference-book/infer-coolpoints`);
      else if (k === "architecture") await api.post(`/novels/${novelId}/reference-book/detect-architecture`);
      else if (k === "hooks") await api.post(`/novels/${novelId}/reference-book/extract-hook-patterns`);
      else if (k === "goldenFinger") await api.post(`/novels/${novelId}/reference-book/extract-golden-finger`);
      else if (k === "timeline") await api.post(`/novels/${novelId}/reference-book/extract-setting-timeline`);
      else if (k === "writing") await extractWriting.mutateAsync(novelId);
      else if (k === "contentBeats") await api.post(`/novels/${novelId}/reference-book/extract-content-beats`);
    } catch {} finally { setRunning(null); }
    await loadState();
  }

  async function handleRunAll() { setRunAll(true); for (const k of KEYS) { if (!done[k as keyof AnalysisState]) await run(k); } setRunAll(false); }

  async function handleUpload(text: string, name: string) {
    setUploading(true); setUploadMsg("上传中...");
    try { await api.post(`/novels/${novelId}/reference-book`, { fileName: name, content: text }); setFileName(name); setUploadMsg(""); loadState(); } catch { setUploadMsg("上传失败"); }
    finally { setUploading(false); }
  }

  async function handleRemove() {
    try { await api.delete(`/novels/${novelId}/reference-book`); setFileName(""); setDone({}); setStats(null); setAnnotData({}); qc.invalidateQueries({ queryKey: ["novel", novelId] }); } catch {}
  }

  async function handleApplyArchitecture() {
    const arch = annotData.detectedArchitecture as { type: string } | undefined;
    if (!arch) return;
    try {
      await api.post(`/novels/${novelId}/pipeline/step/architecture`, {
        architectureType: arch.type,
        goldenFinger: annotData.goldenFingerBounds,
        centralQuestion: novel?.centralQuestion,
        endingDirection: novel?.endingDirection,
      });
      setAppliedArch(true);
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    } catch {}
  }

  async function handleCreateProfile() { try { await createProfile.mutateAsync(novelId); setProfileCreated(true); } catch {} }

  const archData = annotData.detectedArchitecture as { type: string; confidence: number; reasoning: string; observedPatterns: string[] } | undefined;
  const hookData = annotData.hookPatterns as { distribution: Record<string,number>; avgHookStrength: number; typicalHookStyle: string } | undefined;
  const gfData = annotData.goldenFingerBounds as { abilities: string[]; limits: string[] } | undefined;
  const timelineData = annotData.keySettings as Array<{ chapterIndex: number; settingName: string }> | undefined;
  const beatData = annotData.contentBeatPatterns as { beatTypes: string[]; overallDistribution: Record<string,number>; totalChapters: number } | undefined;
  const writingData = annotData.writingAssets as { overallStyleDescription?: string; narrativeAssets?: unknown[]; languageAssets?: unknown[]; characterAssets?: unknown[]; rhythmAssets?: unknown[]; antiAiAssets?: unknown[] } | undefined;

  return (
    <div className="space-y-4">
      {/* Upload + Actions bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!fileName ? (
          <label className="cursor-pointer rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700 inline-flex items-center gap-1.5">
            <Upload size={12} />{uploading ? "上传中..." : "上传参考书 .txt"}
            <input type="file" accept=".txt" className="hidden" onChange={e => {
              const file = e.target.files?.[0];
              if (file) { const r = new FileReader(); r.onload = ev => handleUpload(ev.target?.result as string, file.name); r.readAsText(file); }
            }} />
          </label>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{fileName}</span>
            <button onClick={handleRemove} className="text-[10px] text-red-400 hover:text-red-600">移除</button>
          </div>
        )}
        {fileName && doneCount < 8 && (
          <button onClick={handleRunAll} disabled={runAll} className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white", runAll ? "bg-slate-400" : "bg-slate-800 hover:bg-slate-700")}>
            {runAll ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}{runAll ? "分析中..." : "一键全部分析"}
          </button>
        )}
        {uploadMsg && <span className={cn("text-xs", uploadMsg.includes("失败") ? "text-red-500" : "text-green-600")}>{uploadMsg}</span>}
        {fileName && <span className="text-xs text-slate-400">{doneCount}/8 项完成</span>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">总章数</div><div className="text-lg font-bold text-slate-700">{stats?.totalChapters ?? "—"}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">回环数</div><div className="text-lg font-bold text-slate-700">{stats?.totalLoops || "—"}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">已完成</div><div className="text-lg font-bold text-slate-700">{doneCount}/8</div></div>
        {fileName ? (
          <div className="rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center"><button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-600">移除参考书</button></div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-2 flex items-center justify-center text-xs text-slate-400">等待上传</div>
        )}
      </div>

      {/* Analysis Cards — always visible */}
      <div className="grid grid-cols-2 gap-3">
          <Card hasFile={!!fileName} title="架构判定" icon={GitBranch} done={done.architecture} running={running === "architecture"} onRun={() => run("architecture")}>
            {archData && <>
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">{ARCH_LABELS[archData.type] ?? archData.type}</span><span className="text-xs text-slate-400">置信度 {(archData.confidence*100).toFixed(0)}%</span></div>
              <p className="text-xs text-slate-500">{archData.reasoning}</p>
              {archData.observedPatterns?.length > 0 && <div className="flex flex-wrap gap-1">{archData.observedPatterns.map((p,i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{p}</span>)}</div>}
              <button onClick={handleApplyArchitecture} disabled={appliedArch} className={cn("w-full rounded-lg px-3 py-1.5 text-xs font-medium", appliedArch ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700")}>{appliedArch ? <><Check size={10} className="inline mr-1"/>已应用</> : "应用到当前小说"}</button>
            </>}
          </Card>

          <Card hasFile={!!fileName} title="钩子模式" icon={Eye} done={done.hooks} running={running === "hooks"} onRun={() => run("hooks")}>
            {hookData && <div className="space-y-1 text-xs">{Object.entries(hookData.distribution ?? {}).map(([k,v]) => <div key={k} className="flex justify-between"><span className="text-slate-500">{HOOK_LABELS[k]??k}</span><span className="font-medium">{v as number}章</span></div>)}<div className="border-t border-slate-100 pt-1 mt-1 text-slate-400">平均钩力 {(hookData.avgHookStrength*100).toFixed(0)}% · {hookData.typicalHookStyle}</div></div>}
          </Card>

          <Card hasFile={!!fileName} title="金手指" icon={Sparkles} done={done.goldenFinger} running={running === "goldenFinger"} onRun={() => run("goldenFinger")}>
            {gfData && <div className="space-y-2 text-xs">
              <div><span className="font-medium">能力：</span><div className="flex flex-wrap gap-1 mt-0.5">{gfData.abilities.map((a,i) => <span key={i} className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">{a}</span>)}</div></div>
              <div><span className="font-medium">限制：</span><div className="flex flex-wrap gap-1 mt-0.5">{gfData.limits.map((l,i) => <span key={i} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">{l}</span>)}</div></div>
            </div>}
          </Card>

          <Card hasFile={!!fileName} title="内容节拍DNA" icon={BookOpen} done={done.contentBeats} running={running === "contentBeats"} onRun={() => run("contentBeats")}>
            {beatData && <div className="space-y-2">
              <div className="flex flex-wrap gap-1 text-[10px]">{beatData.beatTypes.map(bt => { const c = beatData.overallDistribution[bt] ?? 0; const t = beatData.totalChapters; return <span key={bt} className="rounded bg-slate-100 px-1.5 py-0.5" title={`${c}章 (${t>0?(c/t*100).toFixed(0):0}%)`}>{bt} {c}章</span>; })}</div>
              <button onClick={async () => { try { await api.put(`/novels/${novelId}/architecture`, { contentBeatProfile: JSON.stringify(beatData.overallDistribution) }); } catch {} }} className="w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">应用内容节拍配方</button>
            </div>}
          </Card>

          <Card hasFile={!!fileName} title="爽点分布" icon={TrendingUp} done={done.coolpoints} running={running === "coolpoints"} onRun={() => run("coolpoints")}>
            {done.coolpoints && <div className="text-xs text-slate-500">爽点分析已完成</div>}
          </Card>

          <Card hasFile={!!fileName} title="设定时间线" icon={FileText} done={done.timeline} running={running === "timeline"} onRun={() => run("timeline")}>
            {timelineData && <div className="space-y-1 max-h-24 overflow-y-auto text-xs">{timelineData.slice(0,8).map((s,i) => <div key={i} className="flex items-center gap-2"><span className="w-12 text-slate-400 shrink-0">第{s.chapterIndex}章</span><span className="text-slate-600">{s.settingName}</span></div>)}</div>}
          </Card>

          <Card hasFile={!!fileName} title="写法技法" icon={BookOpen} done={done.writing} running={running === "writing"} onRun={() => run("writing")}>
            {writingData && <div className="space-y-2">
              {writingData.overallStyleDescription && <p className="text-xs text-slate-600 leading-relaxed">{writingData.overallStyleDescription}</p>}
              <div className="grid grid-cols-5 gap-1 text-[10px]">{[{label:"叙事",n:writingData.narrativeAssets?.length},{label:"语言",n:writingData.languageAssets?.length},{label:"角色",n:writingData.characterAssets?.length},{label:"节奏",n:writingData.rhythmAssets?.length},{label:"反AI",n:writingData.antiAiAssets?.length}].map(c => <div key={c.label} className="rounded bg-slate-50 px-2 py-1 text-center"><div className="font-bold text-slate-700">{c.n??0}</div><div className="text-slate-400">{c.label}</div></div>)}</div>
              <button onClick={handleCreateProfile} disabled={profileCreated || createProfile.isPending} className={cn("w-full rounded-lg px-3 py-1.5 text-xs font-medium", profileCreated ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700")}>{profileCreated ? <><Check size={10} className="inline mr-1"/>已创建</> : "创建风格配置"}</button>
            </div>}
          </Card>

          <Card hasFile={!!fileName} title="回环推断" icon={GitBranch} done={done.loops} running={running === "loops"} onRun={() => run("loops")}>
            {done.loops && <div className="text-xs text-slate-500">回环边界推断已完成</div>}
          </Card>
        </div>
    </div>
  );
}

function Card({ title, icon: Icon, done, running, onRun, children, hasFile }: {
  title: string; icon: any; done?: boolean; running?: boolean; onRun: () => void; children?: React.ReactNode; hasFile: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3", done ? "border-green-200 bg-green-50/20" : "border-slate-200 bg-white")}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={done ? "text-green-500" : "text-slate-400"}><Icon size={13} /></span>
          <span className="text-xs font-medium text-slate-700">{title}</span>
          {done && <Check size={11} className="text-green-500" />}
        </div>
        {!done && (
          <button onClick={onRun} disabled={!!running || !hasFile}
            className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
            {running ? <RefreshCw size={10} className="animate-spin"/> : <Sparkles size={10} />}分析
          </button>
        )}
      </div>
      {children ?? (!hasFile && <p className="text-[10px] text-slate-300 italic">上传参考书后可分析</p>)}
    </div>
  );
}

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};
const HOOK_LABELS: Record<string, string> = { suspense:"悬念型", reversal:"反转型", preview:"预告型", emotional:"情绪型" };
