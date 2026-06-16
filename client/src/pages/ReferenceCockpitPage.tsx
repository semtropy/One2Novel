/**
 * ReferenceCockpitPage — 参考书驾驶舱，独立页面，通过 profileId 访问
 * /reference-profiles/new → 上传+分析
 * /reference-profiles/:id → 查看已有档案
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Upload, Sparkles, Check, RefreshCw, Target, BookOpen, Zap, GitBranch, TrendingUp, Eye, FileText, X, ArrowLeft } from "lucide-react";
import { useNovels, useExtractWritingAssets, useCreateStyleProfileFromAssets } from "../api/novel";
import { api } from "../app/api";
import { cn } from "../lib/cn";

interface AnalysisState {
  loops?: boolean; coolpoints?: boolean; architecture?: boolean;
  hooks?: boolean; goldenFinger?: boolean; timeline?: boolean;
  writing?: boolean; contentBeats?: boolean;
}

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};
const HOOK_LABELS: Record<string, string> = { suspense:"悬念型", reversal:"反转型", preview:"预告型", emotional:"情绪型" };
const KEYS = ["loops","coolpoints","architecture","hooks","goldenFinger","timeline","writing","contentBeats"];

export function ReferenceCockpitPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const isNew = profileId === "new";

  const { data: novelsList } = useNovels();
  const novels = (novelsList ?? []) as Array<{ id: string; title: string }>;
  const extractWriting = useExtractWritingAssets();
  const createProfile = useCreateStyleProfileFromAssets();

  const [name, setName] = useState("");
  const [profId, setProfId] = useState<string | null>(isNew ? null : profileId ?? null);
  const [hostNovelId, setHostNovelId] = useState<string>(""); // 承载上传分析的小说
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [done, setDone] = useState<AnalysisState>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);
  const [annotData, setAnnotData] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<{ totalChapters: number; totalLoops: number } | null>(null);
  const [appliedArch, setAppliedArch] = useState(false);
  const [profileCreated, setProfileCreated] = useState(false);
  const [applyTargetId, setApplyTargetId] = useState<string>("");
  const doneCount = KEYS.filter(k => done[k as keyof AnalysisState]).length;

  useEffect(() => {
    if (profId) loadProfile(profId);
  }, [profId]);

  async function loadProfile(pid: string) {
    try {
      const { data } = await api.get(`/profiles/${pid}`);
      const p = data.data;
      if (!p) return;
      setName(p.name ?? "");
      const annot: Record<string, any> = {};
      if (p.loopBoundaries) Object.assign(annot, JSON.parse(p.loopBoundaries));
      if (p.coolPointDensity) { const cp = JSON.parse(p.coolPointDensity); annot.highCoolChapters = cp.highCoolChapters ?? []; annot.lowCoolChapters = cp.lowCoolChapters ?? []; }
      if (p.hookPatterns) annot.hookPatterns = typeof p.hookPatterns === "string" ? JSON.parse(p.hookPatterns) : p.hookPatterns;
      if (p.goldenFingerBounds) annot.goldenFingerBounds = typeof p.goldenFingerBounds === "string" ? JSON.parse(p.goldenFingerBounds) : p.goldenFingerBounds;
      if (p.contentBeatPatterns) annot.contentBeatPatterns = typeof p.contentBeatPatterns === "string" ? JSON.parse(p.contentBeatPatterns) : p.contentBeatPatterns;
      if (p.settingTimeline) annot.keySettings = typeof p.settingTimeline === "string" ? JSON.parse(p.settingTimeline) : p.settingTimeline;
      if (p.architectureType) annot.detectedArchitecture = { type: p.architectureType };
      if (p.writingAssets) annot.writingAssets = typeof p.writingAssets === "string" ? JSON.parse(p.writingAssets) : p.writingAssets;
      const nd: AnalysisState = {};
      if (annot.loopBoundaries) nd.loops = true;
      if ((annot.highCoolChapters ?? []).length > 0 || (annot.lowCoolChapters ?? []).length > 0) nd.coolpoints = true;
      if (annot.detectedArchitecture) nd.architecture = true;
      if (annot.hookPatterns) nd.hooks = true;
      if (annot.goldenFingerBounds) nd.goldenFinger = true;
      if (annot.keySettings) nd.timeline = true;
      if (annot.writingAssets) nd.writing = true;
      if (annot.contentBeatPatterns) nd.contentBeats = true;
      setDone(nd);
      setAnnotData(annot);
      setStats({ totalChapters: p.totalChapters ?? 0, totalLoops: (annot.loopBoundaries as any[])?.filter((b: any) => b.type === "start").length ?? 0 });
      setFileName(p.name ?? "");
    } catch {}
  }

  async function handleUpload(text: string, fname: string) {
    setUploading(true); setUploadMsg("上传中...");
    try {
      // Create a temporary novel context for upload (we need a novelId for reference book)
      // For now, use the first novel or create one
      const targetNovelId = novels[0]?.id;
      if (!targetNovelId) { setUploadMsg("请先创建一本小说"); return; }
      await api.post(`/novels/${targetNovelId}/reference-book`, { fileName: fname, content: text });
      setFileName(fname); setName(fname.replace(/\.txt$/i, ""));
      setHostNovelId(targetNovelId);
      setUploadMsg("");
    } catch { setUploadMsg("上传失败"); }
    finally { setUploading(false); }
  }

  async function run(k: string) {
    const nid = hostNovelId;
    if (!nid) return;
    setRunning(k);
    try {
      if (k === "loops") await api.post(`/novels/${nid}/reference-book/infer-loops`);
      else if (k === "coolpoints") await api.post(`/novels/${nid}/reference-book/infer-coolpoints`);
      else if (k === "architecture") await api.post(`/novels/${nid}/reference-book/detect-architecture`);
      else if (k === "hooks") await api.post(`/novels/${nid}/reference-book/extract-hook-patterns`);
      else if (k === "goldenFinger") await api.post(`/novels/${nid}/reference-book/extract-golden-finger`);
      else if (k === "timeline") await api.post(`/novels/${nid}/reference-book/extract-setting-timeline`);
      else if (k === "writing") await extractWriting.mutateAsync(nid);
      else if (k === "contentBeats") await api.post(`/novels/${nid}/reference-book/extract-content-beats`);
    } catch {} finally { setRunning(null); }
    // Reload profile if it exists, otherwise check the reference book
    if (profId) { await loadProfile(profId); }
    else {
      const nid2 = hostNovelId;
      if (nid2) {
        const { data } = await api.get(`/novels/${nid2}/reference-book`);
        if (data.data?.profileId) { setProfId(data.data.profileId); navigate(`/reference-profiles/${data.data.profileId}`, { replace: true }); }
      }
    }
  }

  async function handleRunAll() {
    setRunAll(true);
    for (const k of KEYS) { if (!done[k as keyof AnalysisState]) await run(k); }
    setRunAll(false);
  }

  async function handleApplyArchitecture() {
    const arch = annotData.detectedArchitecture as { type: string } | undefined;
    if (!arch || !applyTargetId) return;
    try {
      await api.post(`/novels/${applyTargetId}/pipeline/step/architecture`, {
        architectureType: arch.type,
        goldenFinger: annotData.goldenFingerBounds,
      });
      setAppliedArch(true);
      setTimeout(() => setAppliedArch(false), 3000);
    } catch {}
  }

  async function handleApplyContentBeats() {
    if (!applyTargetId || !annotData.contentBeatPatterns?.overallDistribution) return;
    try {
      await api.put(`/novels/${applyTargetId}/architecture`, { contentBeatProfile: JSON.stringify(annotData.contentBeatPatterns.overallDistribution) });
    } catch {}
  }

  async function handleApplyStyle() {
    if (!applyTargetId) return;
    try {
      await api.post(`/novels/${applyTargetId}/reference-book/create-style-profile`);
      setProfileCreated(true);
      setTimeout(() => setProfileCreated(false), 3000);
    } catch {}
  }

  const archData = annotData.detectedArchitecture as { type: string; confidence: number; reasoning: string; observedPatterns: string[] } | undefined;
  const hookData = annotData.hookPatterns as { distribution: Record<string,number>; avgHookStrength: number; typicalHookStyle: string } | undefined;
  const gfData = annotData.goldenFingerBounds as { abilities: string[]; limits: string[] } | undefined;
  const beatData = annotData.contentBeatPatterns as { beatTypes: string[]; overallDistribution: Record<string,number>; totalChapters: number } | undefined;
  const timelineData = annotData.keySettings as Array<{ chapterIndex: number; settingName: string }> | undefined;
  const writingData = annotData.writingAssets as { overallStyleDescription?: string; narrativeAssets?: Array<{category:string;observation:string;rule:string;confidence:number}>; languageAssets?: Array<{category:string;observation:string;rule:string;confidence:number}>; characterAssets?: Array<{category:string;observation:string;rule:string;confidence:number}>; rhythmAssets?: Array<{category:string;observation:string;rule:string;confidence:number}>; antiAiAssets?: Array<{category:string;observation:string;rule:string;confidence:number}> } | undefined;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/reference-profiles" className="text-slate-400 hover:text-slate-600"><ArrowLeft size={18} /></Link>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{profId ? name || "参考书档案" : "新建参考书档案"}</h2>
              <p className="text-xs text-slate-400">{profId ? "分析结果" : "上传参考书并分析其结构DNA"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {doneCount > 0 && (
              <select value={applyTargetId} onChange={e => setApplyTargetId(e.target.value)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none">
                <option value="">目标小说</option>
                {novels.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Upload area (new profile only) */}
        {!profId && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-8 text-center space-y-3">
            <Upload size={32} className="mx-auto text-slate-300" />
            <p className="text-sm text-slate-600">上传对标网络小说 .txt 文件</p>
            <p className="text-xs text-slate-400">支持百万字以上，AI 将分析回环结构、爽点分布、写作技法等 8 个维度</p>
            {novels.length > 0 && (
              <select value={hostNovelId} onChange={e => setHostNovelId(e.target.value)}
                className="mx-auto block rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none">
                <option value="">选择承载小说</option>
                {novels.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
              </select>
            )}
            <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white", hostNovelId ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-300 cursor-not-allowed")}>
              <Upload size={12} />{uploading ? "上传中..." : "选择文件"}
              {hostNovelId && <input type="file" accept=".txt" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) { const r = new FileReader(); r.onload = ev => handleUpload(ev.target?.result as string, file.name); r.readAsText(file); }
              }} />}
            </label>
            {uploadMsg && <p className={cn("text-xs", uploadMsg.includes("失败") ? "text-red-500" : "text-green-600")}>{uploadMsg}</p>}
          </div>
        )}

        {/* Actions */}
        {((profId && doneCount < 8) || fileName) && (
          <div className="flex items-center gap-2">
            {doneCount < 8 && (
              <button onClick={handleRunAll} disabled={runAll} className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white", runAll ? "bg-slate-400" : "bg-slate-800 hover:bg-slate-700")}>
                {runAll ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}{runAll ? "分析中..." : "一键全部分析"}
              </button>
            )}
            <span className="text-xs text-slate-400">{doneCount}/8 项完成</span>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">总章数</div><div className="text-lg font-bold text-slate-700">{stats?.totalChapters ?? "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">回环数</div><div className="text-lg font-bold text-slate-700">{stats?.totalLoops || "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">已完成</div><div className="text-lg font-bold text-slate-700">{doneCount}/8</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">档案</div><div className="text-lg font-bold text-slate-700">{profId ? "已保存" : "新建"}</div></div>
        </div>

        {/* Analysis Results */}
        <div className="space-y-4">
          <Section title="架构判定" icon={GitBranch} done={done.architecture} running={running === "architecture"} onRun={() => run("architecture")} hasFile={!!fileName || !!profId}>
            {archData && <>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-base font-bold text-slate-800">{ARCH_LABELS[archData.type] ?? archData.type}</span>
                {archData.confidence && <span className="text-xs text-slate-400">置信度 {(archData.confidence*100).toFixed(0)}%</span>}
              </div>
              {archData.reasoning && <p className="text-sm text-slate-600 mb-2">{archData.reasoning}</p>}
              {archData.observedPatterns?.length > 0 && <div className="flex flex-wrap gap-1 mb-3">{archData.observedPatterns.map((p,i) => <span key={i} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{p}</span>)}</div>}
              <button onClick={handleApplyArchitecture} disabled={appliedArch || !applyTargetId} className={cn("rounded-lg px-4 py-1.5 text-xs font-medium", appliedArch ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40")}>{appliedArch ? <><Check size={10} className="inline mr-1"/>已应用</> : "应用"}</button>
            </>}
          </Section>

          <Section title="钩子模式" icon={Eye} done={done.hooks} running={running === "hooks"} onRun={() => run("hooks")} hasFile={!!fileName || !!profId}>
            {hookData && <div className="flex items-center gap-4 text-sm">
              {Object.entries(hookData.distribution ?? {}).map(([k,v]) => <div key={k} className="flex items-center gap-1"><span className="text-slate-500">{HOOK_LABELS[k]??k}</span><span className="font-bold text-slate-700">{v as number}章</span></div>)}
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">平均钩力 <b className="text-slate-700">{(hookData.avgHookStrength*100).toFixed(0)}%</b></span>
              <span className="text-slate-500">· {hookData.typicalHookStyle}</span>
            </div>}
          </Section>

          <Section title="金手指" icon={Sparkles} done={done.goldenFinger} running={running === "goldenFinger"} onRun={() => run("goldenFinger")} hasFile={!!fileName || !!profId}>
            {gfData && <div className="space-y-2 text-sm">
              <div><span className="font-medium text-slate-600">能力</span><div className="flex flex-wrap gap-1 mt-1">{gfData.abilities.map((a,i) => <span key={i} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">{a}</span>)}</div></div>
              <div><span className="font-medium text-slate-600">限制</span><div className="flex flex-wrap gap-1 mt-1">{gfData.limits.map((l,i) => <span key={i} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{l}</span>)}</div></div>
            </div>}
          </Section>

          <Section title="内容节拍DNA" icon={BookOpen} done={done.contentBeats} running={running === "contentBeats"} onRun={() => run("contentBeats")} hasFile={!!fileName || !!profId}>
            {beatData && <div className="space-y-2">
              <div className="flex flex-wrap gap-1 text-xs">{beatData.beatTypes.map(bt => { const c = beatData.overallDistribution[bt] ?? 0; const t = beatData.totalChapters; return <span key={bt} className="rounded bg-slate-100 px-2 py-1" title={`${c}章 (${t>0?(c/t*100).toFixed(0):0}%)`}>{bt} <b className="text-slate-700">{c}章</b></span>; })}</div>
              <button onClick={handleApplyContentBeats} disabled={!applyTargetId} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40">应用</button>
            </div>}
          </Section>

          <Section title="爽点分布" icon={TrendingUp} done={done.coolpoints} running={running === "coolpoints"} onRun={() => run("coolpoints")} hasFile={!!fileName || !!profId}>
            {done.coolpoints && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-500">高爽点 <b className="text-green-600">{(annotData.highCoolChapters as any[])?.length ?? 0}章</b></span>
                  <span className="text-slate-500">低爽点 <b className="text-red-400">{(annotData.lowCoolChapters as any[])?.length ?? 0}章</b></span>
                </div>
                {(annotData.highCoolChapters as number[])?.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-xs">
                    {(annotData.highCoolChapters as number[]).map(ch => <span key={ch} className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">第{ch}章</span>)}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="设定释放时间线" icon={FileText} done={done.timeline} running={running === "timeline"} onRun={() => run("timeline")} hasFile={!!fileName || !!profId}>
            {timelineData && <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">{timelineData.map((s,i) => <div key={i} className="flex items-center gap-2"><span className="text-slate-400 text-xs w-14 shrink-0">第{s.chapterIndex}章</span><span className="text-slate-600">{s.settingName}</span></div>)}</div>}
          </Section>

          <Section title="写法技法" icon={BookOpen} done={done.writing} running={running === "writing"} onRun={() => run("writing")} hasFile={!!fileName || !!profId}>
            {writingData && <div className="space-y-2">
              {writingData.overallStyleDescription && <p className="text-sm text-slate-600">{writingData.overallStyleDescription}</p>}
              <div className="grid grid-cols-5 gap-3 text-sm">{[{label:"叙事技法",n:writingData.narrativeAssets?.length??0},{label:"语言风格",n:writingData.languageAssets?.length??0},{label:"角色塑造",n:writingData.characterAssets?.length??0},{label:"节奏控制",n:writingData.rhythmAssets?.length??0},{label:"反AI特征",n:writingData.antiAiAssets?.length??0}].map(c => <div key={c.label} className="rounded-lg border border-slate-200 p-3 text-center"><div className="text-2xl font-bold text-slate-700">{c.n}</div><div className="text-xs text-slate-400 mt-1">{c.label}</div></div>)}</div>
              <button onClick={handleApplyStyle} disabled={profileCreated || !applyTargetId} className={cn("rounded-lg px-4 py-1.5 text-xs font-medium", profileCreated ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40")}>{profileCreated ? <><Check size={10} className="inline mr-1"/>已应用</> : "应用"}</button>
            </div>}
          </Section>

          <Section title="回环推断" icon={GitBranch} done={done.loops} running={running === "loops"} onRun={() => run("loops")} hasFile={!!fileName || !!profId}>
            {done.loops && (() => {
              const boundaries = (annotData.loopBoundaries as Array<{chapterIndex: number; type: string}>) ?? [];
              const starts = boundaries.filter(b => b.type === "start");
              const ends = boundaries.filter(b => b.type === "end");
              const loops = starts.map((s, i) => ({ start: s.chapterIndex, end: ends[i]?.chapterIndex ?? "?" }));
              return (
                <div className="space-y-2">
                  <div className="text-sm text-slate-500">共 <b className="text-slate-700">{loops.length}轮回环</b>，平均每轮 {stats?.totalChapters && loops.length > 0 ? Math.round(stats!.totalChapters / loops.length) : "?"} 章</div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {loops.map((l, i) => (
                      <span key={i} className="rounded bg-brand-50 border border-brand-100 px-2 py-1 text-slate-600">第{i+1}轮: 第{l.start}-{l.end}章</span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, done, running, onRun, children, hasFile }: {
  title: string; icon: any; done?: boolean; running?: boolean; onRun: () => void; children?: React.ReactNode; hasFile: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-4", done ? "border-green-200 bg-green-50/20" : "border-slate-200 bg-white")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn("p-1 rounded", done ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400")}><Icon size={14} /></span>
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          {done && <Check size={14} className="text-green-500" />}
        </div>
        {!done && (
          <button onClick={onRun} disabled={!!running || !hasFile}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
            {running ? <RefreshCw size={12} className="animate-spin"/> : <Sparkles size={12} />}{running ? "分析中..." : "分析"}
          </button>
        )}
      </div>
      {children ?? (!hasFile && <p className="text-sm text-slate-300 italic">上传参考书后可分析</p>)}
    </div>
  );
}
