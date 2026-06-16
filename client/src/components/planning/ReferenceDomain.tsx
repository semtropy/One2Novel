/**
 * ReferenceDomain — 参考书上传 + 8维分析驾驶舱，内嵌在规划页面中
 */
import { useState, useEffect } from "react";
import { Upload, Sparkles, Check, RefreshCw, Target, BookOpen, Zap, GitBranch, TrendingUp, Eye, FileText, X, Trash2 } from "lucide-react";
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

interface ProfileItem { id: string; name: string; architectureType?: string | null; totalChapters?: number | null; createdAt: string; }

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

  // Profile selector
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

  const KEYS = ["loops","coolpoints","architecture","hooks","goldenFinger","timeline","writing","contentBeats"];
  const doneCount = KEYS.filter(k => done[k as keyof AnalysisState]).length;

  useEffect(() => { loadProfiles(); loadState(); }, [novelId]);

  async function loadProfiles() {
    try { const { data } = await api.get("/profiles"); setProfiles(data.data ?? []); } catch {}
  }

  async function loadState() {
    try {
      const { data } = await api.get(`/novels/${novelId}/reference-book`);
      if (data.data) {
        setFileName(data.data.fileName ?? "");
        // If a profile is linked, load canonical data from profile
        if (data.data.profileId) {
          const profileRes = await api.get(`/profiles/${data.data.profileId}`);
          if (profileRes.data.data) setProfileData(profileRes.data.data);
        } else {
          // Fallback: parse annotations JSON
          const annot = typeof data.data.annotations === "string" ? JSON.parse(data.data.annotations) : (data.data.annotations ?? {});
          applyAnnotations(annot, data.data);
        }
      }
    } catch {}
  }

  function setProfileData(p: any) {
    const annot: Record<string, any> = {};
    if (p.loopBoundaries) Object.assign(annot, JSON.parse(p.loopBoundaries));
    if (p.coolPointDensity) { const cp = JSON.parse(p.coolPointDensity); annot.highCoolChapters = cp.highCoolChapters; annot.lowCoolChapters = cp.lowCoolChapters; }
    if (p.hookPatterns) annot.hookPatterns = JSON.parse(p.hookPatterns);
    if (p.goldenFingerBounds) annot.goldenFingerBounds = JSON.parse(p.goldenFingerBounds);
    if (p.contentBeatPatterns) annot.contentBeatPatterns = JSON.parse(p.contentBeatPatterns);
    if (p.settingTimeline) annot.keySettings = JSON.parse(p.settingTimeline);
    if (p.architectureType) annot.detectedArchitecture = { type: p.architectureType };
    applyAnnotations(annot, { writingAssets: p.writingAssets, totalChapters: p.totalChapters });
  }

  function applyAnnotations(annot: Record<string, any>, raw?: Record<string, any>) {
    const nd: AnalysisState = {};
    const lb = annot.loopBoundaries as any[];
    if (lb?.length > 0) nd.loops = true;
    const hc = annot.highCoolChapters as any[];
    const lc = annot.lowCoolChapters as any[];
    if (hc?.length > 0 || lc?.length > 0) nd.coolpoints = true;
    if (annot.detectedArchitecture) nd.architecture = true;
    if (annot.hookPatterns) nd.hooks = true;
    if (annot.goldenFingerBounds) nd.goldenFinger = true;
    const ks = annot.keySettings as any[];
    if (ks?.length > 0) nd.timeline = true;
    if (raw?.writingAssets) nd.writing = true;
    if (annot.contentBeatPatterns) nd.contentBeats = true;
    setDone(nd);
    setAnnotData(annot as DataMap);
    setStats({ totalChapters: (raw?.totalChapters as number) ?? 0, totalLoops: lb?.filter((b: any) => b.type === "start").length ?? 0 });
  }

  async function selectProfile(id: string) {
    setSelectedProfileId(id);
    if (!id) { setDone({}); setAnnotData({}); setStats(null); return; }
    try {
      const { data } = await api.get(`/profiles/${id}`);
      const p = data.data;
      const annot: DataMap = {};
      if (p.loopBoundaries) Object.assign(annot, JSON.parse(p.loopBoundaries));
      if (p.coolPointDensity) { const cp = JSON.parse(p.coolPointDensity); annot.highCoolChapters = cp.highCoolChapters; annot.lowCoolChapters = cp.lowCoolChapters; }
      if (p.hookPatterns) annot.hookPatterns = JSON.parse(p.hookPatterns);
      if (p.goldenFingerBounds) annot.goldenFingerBounds = JSON.parse(p.goldenFingerBounds);
      if (p.contentBeatPatterns) annot.contentBeatPatterns = JSON.parse(p.contentBeatPatterns);
      if (p.settingTimeline) annot.keySettings = JSON.parse(p.settingTimeline);
      if (p.architectureType) annot.detectedArchitecture = { type: p.architectureType };
      applyAnnotations(annot, { writingAssets: p.writingAssets, totalChapters: p.totalChapters });
      // Set as active profile for this novel
      await api.put(`/novels/${novelId}/active-profile`, { profileId: id });
    } catch {}
  }

  async function handleDeleteProfile(id: string) {
    if (!window.confirm("删除此档案？分析结果将永久丢失。")) return;
    try { await api.delete(`/profiles/${id}`); if (selectedProfileId === id) { setSelectedProfileId(""); setDone({}); setAnnotData({}); setStats(null); } loadProfiles(); } catch {}
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
    if (!window.confirm("移除参考书文本？分析结果将保留。")) return;
    try {
      await api.patch(`/novels/${novelId}/reference-book`, { clearContent: true });
      setFileName("");
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    } catch {}
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
      {/* Profile selector */}
      <div className="flex items-center gap-2">
        <select value={selectedProfileId} onChange={e => selectProfile(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none">
          <option value="">-- 选择参考书档案（{profiles.length}个） --</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.architectureType ? ` · ${ARCH_LABELS[p.architectureType] ?? p.architectureType}` : ""}</option>)}
        </select>
        {selectedProfileId && (
          <button onClick={() => handleDeleteProfile(selectedProfileId)} className="shrink-0 rounded p-1 text-slate-300 hover:text-red-500" title="删除档案"><Trash2 size={12} /></button>
        )}
      </div>

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

      {/* Analysis Results — full width vertical sections */}
      <div className="space-y-4">
        {/* Architecture */}
        <Section title="架构判定" icon={GitBranch} done={done.architecture} running={running === "architecture"} onRun={() => run("architecture")} hasFile={!!fileName}>
          {archData && <>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-base font-bold text-slate-800">{ARCH_LABELS[archData.type] ?? archData.type}</span>
              <span className="text-xs text-slate-400">置信度 {(archData.confidence*100).toFixed(0)}%</span>
            </div>
            <p className="text-sm text-slate-600 mb-2">{archData.reasoning}</p>
            {archData.observedPatterns?.length > 0 && <div className="flex flex-wrap gap-1 mb-3">{archData.observedPatterns.map((p,i) => <span key={i} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{p}</span>)}</div>}
            <button onClick={handleApplyArchitecture} disabled={appliedArch} className={cn("rounded-lg px-4 py-1.5 text-xs font-medium", appliedArch ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700")}>{appliedArch ? <><Check size={10} className="inline mr-1"/>已应用</> : "应用到当前小说"}</button>
          </>}
        </Section>

        {/* Hook Patterns */}
        <Section title="钩子模式" icon={Eye} done={done.hooks} running={running === "hooks"} onRun={() => run("hooks")} hasFile={!!fileName}>
          {hookData && <div className="flex items-center gap-4 text-sm">
            {Object.entries(hookData.distribution ?? {}).map(([k,v]) => <div key={k} className="flex items-center gap-1"><span className="text-slate-500">{HOOK_LABELS[k]??k}</span><span className="font-bold text-slate-700">{v as number}章</span></div>)}
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">平均钩力 <b className="text-slate-700">{(hookData.avgHookStrength*100).toFixed(0)}%</b></span>
            <span className="text-slate-500">· {hookData.typicalHookStyle}</span>
          </div>}
        </Section>

        {/* Golden Finger */}
        <Section title="金手指" icon={Sparkles} done={done.goldenFinger} running={running === "goldenFinger"} onRun={() => run("goldenFinger")} hasFile={!!fileName}>
          {gfData && <div className="space-y-2 text-sm">
            <div><span className="font-medium text-slate-600">能力</span><div className="flex flex-wrap gap-1 mt-1">{gfData.abilities.map((a,i) => <span key={i} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">{a}</span>)}</div></div>
            <div><span className="font-medium text-slate-600">限制</span><div className="flex flex-wrap gap-1 mt-1">{gfData.limits.map((l,i) => <span key={i} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{l}</span>)}</div></div>
          </div>}
        </Section>

        {/* Content Beats */}
        <Section title="内容节拍DNA" icon={BookOpen} done={done.contentBeats} running={running === "contentBeats"} onRun={() => run("contentBeats")} hasFile={!!fileName}>
          {beatData && <div className="space-y-2">
            <div className="flex flex-wrap gap-1 text-xs">{beatData.beatTypes.map(bt => { const c = beatData.overallDistribution[bt] ?? 0; const t = beatData.totalChapters; return <span key={bt} className="rounded bg-slate-100 px-2 py-1" title={`${c}章 (${t>0?(c/t*100).toFixed(0):0}%)`}>{bt} <b className="text-slate-700">{c}章</b></span>; })}</div>
            <button onClick={async () => { try { await api.put(`/novels/${novelId}/architecture`, { contentBeatProfile: JSON.stringify(beatData.overallDistribution) }); } catch {} }} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">应用内容节拍配方</button>
          </div>}
        </Section>

        {/* Cool Points */}
        <Section title="爽点分布" icon={TrendingUp} done={done.coolpoints} running={running === "coolpoints"} onRun={() => run("coolpoints")} hasFile={!!fileName}>
          {done.coolpoints && (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-500">高爽点 <b className="text-green-600">{((annotData.highCoolChapters as any[])?.length ?? 0)}章</b></span>
                <span className="text-slate-500">低爽点 <b className="text-red-400">{((annotData.lowCoolChapters as any[])?.length ?? 0)}章</b></span>
                <span className="text-slate-500">中性 {(stats?.totalChapters ?? 0) - ((annotData.highCoolChapters as any[])?.length ?? 0) - ((annotData.lowCoolChapters as any[])?.length ?? 0)}章</span>
              </div>
              {(annotData.highCoolChapters as number[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 text-xs">
                  {(annotData.highCoolChapters as number[]).slice(0, 30).map(ch => <span key={ch} className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">第{ch}章</span>)}
                  {(annotData.highCoolChapters as number[])?.length > 30 && <span className="text-slate-400">...共{(annotData.highCoolChapters as number[]).length}章</span>}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Setting Timeline */}
        <Section title="设定释放时间线" icon={FileText} done={done.timeline} running={running === "timeline"} onRun={() => run("timeline")} hasFile={!!fileName}>
          {timelineData && <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">{timelineData.slice(0, 20).map((s,i) => <div key={i} className="flex items-center gap-2"><span className="text-slate-400 text-xs w-14 shrink-0">第{s.chapterIndex}章</span><span className="text-slate-600">{s.settingName}</span></div>)}</div>}
        </Section>

        {/* Writing Assets */}
        <Section title="写法技法" icon={BookOpen} done={done.writing} running={running === "writing"} onRun={() => run("writing")} hasFile={!!fileName}>
          {writingData && <div className="space-y-2">
            {writingData.overallStyleDescription && <p className="text-sm text-slate-600">{writingData.overallStyleDescription}</p>}
            <div className="grid grid-cols-5 gap-3 text-sm">{[{label:"叙事技法",n:writingData.narrativeAssets?.length??0},{label:"语言风格",n:writingData.languageAssets?.length??0},{label:"角色塑造",n:writingData.characterAssets?.length??0},{label:"节奏控制",n:writingData.rhythmAssets?.length??0},{label:"反AI特征",n:writingData.antiAiAssets?.length??0}].map(c => <div key={c.label} className="rounded-lg border border-slate-200 p-3 text-center"><div className="text-2xl font-bold text-slate-700">{c.n}</div><div className="text-xs text-slate-400 mt-1">{c.label}</div></div>)}</div>
            <button onClick={handleCreateProfile} disabled={profileCreated || createProfile.isPending} className={cn("rounded-lg px-4 py-1.5 text-xs font-medium", profileCreated ? "bg-green-100 text-green-700" : "bg-slate-800 text-white hover:bg-slate-700")}>{profileCreated ? <><Check size={10} className="inline mr-1"/>已创建</> : "创建风格配置"}</button>
          </div>}
        </Section>

        {/* Loop Boundaries */}
        <Section title="回环推断" icon={GitBranch} done={done.loops} running={running === "loops"} onRun={() => run("loops")} hasFile={!!fileName}>
          {done.loops && (() => {
            const boundaries = (annotData.loopBoundaries as Array<{chapterIndex: number; type: string}>) ?? [];
            const starts = boundaries.filter(b => b.type === "start");
            const ends = boundaries.filter(b => b.type === "end");
            const loops = starts.map((s, i) => ({ start: s.chapterIndex, end: ends[i]?.chapterIndex ?? "?" }));
            return (
              <div className="space-y-2">
                <div className="text-sm text-slate-500">共 <b className="text-slate-700">{loops.length}轮回环</b>，总 {stats?.totalChapters ?? "?"} 章，平均每轮 {stats?.totalChapters && loops.length > 0 ? Math.round(stats.totalChapters / loops.length) : "?"} 章</div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {loops.slice(0, 30).map((l, i) => (
                    <span key={i} className="rounded bg-brand-50 border border-brand-100 px-2 py-1 text-slate-600">
                      第{i+1}轮: 第{l.start}-{l.end}章
                    </span>
                  ))}
                  {loops.length > 30 && <span className="text-slate-400 text-xs">...共{loops.length}轮</span>}
                </div>
              </div>
            );
          })()}
        </Section>
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
      {children ?? (!hasFile && <p className="text-sm text-slate-300 italic">上传参考书或选择档案后可分析</p>)}
    </div>
  );
}

const ARCH_LABELS: Record<string, string> = {
  skill_slot:"技能栏搭配", sequence_promotion:"序列晋升", case_driven:"超凡办案",
  cultivation_planning:"修真规划", hexagon_godhood:"六边形成神", historical_transmigration:"穿越历史",
};
const HOOK_LABELS: Record<string, string> = { suspense:"悬念型", reversal:"反转型", preview:"预告型", emotional:"情绪型" };
