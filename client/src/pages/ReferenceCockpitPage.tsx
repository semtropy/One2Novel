/**
 * ReferenceCockpitPage — 参考书驾驶舱，独立页面，通过 profileId 访问
 * /reference-profiles/new → 上传+分析
 * /reference-profiles/:id → 查看已有档案
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Upload, Sparkles, Check, RefreshCw, Zap, GitBranch, BookOpen, TrendingUp, Eye, FileText, X, ArrowLeft } from "lucide-react";
import { useNovels } from "../api/novel";
import { api } from "../app/api";
import { cn } from "../lib/cn";
import JSZip from "jszip";

interface AnalysisState {
  loops?: boolean; coolpoints?: boolean; architecture?: boolean;
  hooks?: boolean; goldenFinger?: boolean; timeline?: boolean;
  writing?: boolean; contentBeats?: boolean;
}

const HOOK_LABELS: Record<string, string> = { suspense:"悬念型", reversal:"反转型", preview:"预告型", emotional:"情绪型" };

function StatusLine({ label }: { label?: string }) {
  return <span className="text-sm text-slate-500">{label || "分析完成"}</span>;
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">{label}</div><div className="font-bold text-slate-700">{value}</div></div>;
}

// ═══ Detail Components (modals) ═══

function HookDetail({ data }: { data: { distribution: Record<string,number>; avgHookStrength: number; typicalHookStyle: string } }) {
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">{(Object.entries(data.distribution ?? {}) as [string,number][]).map(([k,v]) => <div key={k} className="rounded-lg border border-slate-200 p-3 text-center"><div className="text-2xl font-bold text-slate-700">{v}</div><div className="text-xs text-slate-400">{HOOK_LABELS[k]??k}</div></div>)}</div>
    <div className="text-sm text-slate-600">平均钩力 <b className="text-slate-800">{(data.avgHookStrength*100).toFixed(0)}%</b> · {data.typicalHookStyle}</div>
  </div>;
}

function GFDetail({ data }: { data: { abilities: string[]; limits: string[] } }) {
  return <div className="grid grid-cols-2 gap-4 text-sm">
    <div><p className="font-semibold text-slate-700 mb-2">能力 ({data.abilities.length})</p><div className="space-y-1">{data.abilities.map((a,i) => <div key={i} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">{a}</div>)}</div></div>
    <div><p className="font-semibold text-slate-700 mb-2">限制 ({data.limits.length})</p><div className="space-y-1">{data.limits.map((l,i) => <div key={i} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{l}</div>)}</div></div>
  </div>;
}

function BeatDetail({ data, onApply, disabled }: { data: { beatTypes: string[]; overallDistribution: Record<string,number>; totalChapters: number }; onApply: () => void; disabled: boolean }) {
  return <div className="space-y-3">
    <div className="grid grid-cols-3 gap-2">{data.beatTypes.map(bt => { const c = data.overallDistribution[bt] ?? 0; return <div key={bt} className="rounded-lg border border-slate-200 p-3 text-center"><div className="text-2xl font-bold text-slate-700">{c}</div><div className="text-xs text-slate-400">{bt}章</div><div className="text-[10px] text-slate-300">{(c/data.totalChapters*100).toFixed(0)}%</div></div>; })}</div>
    <button onClick={onApply} disabled={disabled} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40">应用</button>
  </div>;
}

function CoolPointDetail({ high, low }: { high: number[]; low: number[] }) {
  return <div className="space-y-4">
    <div className="flex items-center gap-4 text-sm"><span>高爽点 <b className="text-green-600">{high.length}章</b></span><span>低爽点 <b className="text-red-400">{low.length}章</b></span></div>
    <div className="flex flex-wrap gap-1 text-xs">{high.map(ch => <span key={ch} className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">第{ch}章</span>)}</div>
    {low.length > 0 && <div className="flex flex-wrap gap-1 text-xs">{low.map(ch => <span key={ch} className="rounded bg-red-50 px-1.5 py-0.5 text-red-400">第{ch}章</span>)}</div>}
  </div>;
}

function TimelineDetail({ data }: { data: Array<{ chapterIndex: number; settingName: string }> }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">{data.map((s,i) => <div key={i} className="flex items-center gap-2"><span className="text-slate-400 w-14 shrink-0">第{s.chapterIndex}章</span><span className="text-slate-600">{s.settingName}</span></div>)}</div>;
}

type Technique = { category: string; observation: string; rule: string; confidence: number };
type WritingAssets = { overallStyleDescription?: string; narrativeAssets?: Technique[]; languageAssets?: Technique[]; characterAssets?: Technique[]; rhythmAssets?: Technique[]; antiAiAssets?: Technique[]; };

function WritingDetail({ data, onApply, applied, disabled }: { data: WritingAssets; onApply: () => void; applied: boolean; disabled: boolean }) {
  const cats = [{k:"narrativeAssets" as const,l:"叙事技法"},{k:"languageAssets" as const,l:"语言风格"},{k:"characterAssets" as const,l:"角色塑造"},{k:"rhythmAssets" as const,l:"节奏控制"},{k:"antiAiAssets" as const,l:"反AI特征"}];
  return <div className="space-y-5">
    {data.overallStyleDescription && <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium text-slate-600 mb-1">整体风格</p><p className="text-sm text-slate-700 leading-relaxed">{data.overallStyleDescription}</p></div>}
    {cats.map(({k,l}) => { const ts = data[k]??[]; if(!ts.length) return null; return <div key={k}><p className="text-sm font-semibold text-slate-700 mb-2">{l} ({ts.length}条)</p><div className="space-y-2">{ts.map((t,i) => <div key={i} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between mb-1.5"><span className="text-xs font-medium text-slate-500">{t.category}</span><span className={cn("text-[10px] px-1.5 py-0.5 rounded-full",t.confidence>=0.9?"bg-green-100 text-green-700":t.confidence>=0.8?"bg-accent-100 text-accent-700":"bg-slate-100 text-slate-500")}>置信度 {(t.confidence*100).toFixed(0)}%</span></div><p className="text-xs text-slate-400 mb-1">对标书做法：</p><p className="text-sm text-slate-600 mb-2 leading-relaxed">{t.observation}</p><p className="text-xs text-slate-400 mb-1">可模仿规则：</p><p className="text-sm text-slate-800 leading-relaxed">{t.rule}</p></div>)}</div></div>; })}
    <button onClick={onApply} disabled={applied || disabled} className={cn("rounded-lg px-4 py-1.5 text-xs font-medium",applied?"bg-green-100 text-green-700":"bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40")}>{applied?"已应用":"应用"}</button>
  </div>;
}

function LoopDetail({ boundaries, total }: { boundaries: Array<{chapterIndex:number;type:string}>; total: number }) {
  const starts = boundaries.filter(b => b.type === "start");
  const ends = boundaries.filter(b => b.type === "end");
  const loops = starts.map((s,i) => ({ start: s.chapterIndex, end: ends[i]?.chapterIndex ?? "?" }));
  return <div className="space-y-3">
    <div className="text-sm text-slate-500">共 <b className="text-slate-700">{loops.length}轮回环</b>，平均 {loops.length>0?Math.round(total/loops.length):"?"} 章/轮</div>
    <div className="flex flex-wrap gap-1 text-xs">{loops.map((l,i) => <span key={i} className="rounded bg-brand-50 border border-brand-100 px-2 py-1 text-slate-600">第{i+1}轮: 第{l.start}-{l.end}章</span>)}</div>
  </div>;
}
export function ReferenceCockpitPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const isNew = profileId === "new";

  const { data: novelsList } = useNovels();
  const novels = (novelsList ?? []) as Array<{ id: string; title: string }>;
  const [name, setName] = useState("");
  const [profId, setProfId] = useState<string | null>(isNew ? null : profileId ?? null);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [done, setDone] = useState<AnalysisState>({});
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepProgress, setDeepProgress] = useState<{phase:string;detail:string;pct:number}|null>(null);
  const [runError, setRunError] = useState("");
  const [annotData, setAnnotData] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<{ totalChapters: number; totalLoops: number } | null>(null);
  const [archProfile, setArchProfile] = useState<any>(null);
  const [profileCreated, setProfileCreated] = useState(false);
  const [applyTargetId, setApplyTargetId] = useState<string>("");
  const doneCount = Object.values(done).filter(Boolean).length;

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
      // Array fields: parse JSON string → array (NOT Object.assign which corrupts arrays)
      if (p.loopBoundaries) {
        try { const arr = JSON.parse(p.loopBoundaries); annot.loopBoundaries = Array.isArray(arr) ? arr : []; } catch { annot.loopBoundaries = []; }
      }
      if (p.coolPointDensity) {
        try { const cp = JSON.parse(p.coolPointDensity); annot.highCoolChapters = cp.highCoolChapters ?? []; annot.lowCoolChapters = cp.lowCoolChapters ?? []; } catch {}
      }
      if (p.hookPatterns) {
        try { annot.hookPatterns = JSON.parse(p.hookPatterns); } catch {}
      }
      if (p.goldenFingerBounds) {
        try { annot.goldenFingerBounds = JSON.parse(p.goldenFingerBounds); } catch {}
      }
      if (p.contentBeatPatterns) {
        try { annot.contentBeatPatterns = JSON.parse(p.contentBeatPatterns); } catch {}
      }
      if (p.settingTimeline) {
        try { annot.keySettings = JSON.parse(p.settingTimeline); } catch {}
      }
      if (p.architectureType) {
        annot.detectedArchitecture = { type: p.architectureType };
      }
      if (p.writingAssets) {
        try { annot.writingAssets = JSON.parse(p.writingAssets); } catch {}
      }
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
      // Load ArchitectureProfile from deep analysis
      if (p.architectureProfile) {
        try { setArchProfile(JSON.parse(p.architectureProfile)); } catch { setArchProfile(null); }
      } else { setArchProfile(null); }
    } catch { setRunError("加载档案失败"); }
  }

  async function handleUpload(text: string, fname: string) {
    setUploading(true); setUploadMsg("上传中...");
    try {
      const cleanName = fname.replace(/\.(txt|epub)$/i, "");
      const { data } = await api.post("/profiles", { name: cleanName, content: text });
      const pid = data.data?.id;
      if (pid) { setProfId(pid); setFileName(fname); setName(cleanName); navigate(`/reference-profiles/${pid}`, { replace: true }); setUploadMsg(""); }
    } catch (e: any) { setUploadMsg(e?.response?.data?.error?.message || "上传失败"); }
    finally { setUploading(false); }
  }

  async function handleFile(file: File) {
    const fname = file.name;
    if (fname.endsWith(".epub")) {
      setUploading(true); setUploadMsg("解析 epub...");
      try {
        const zip = await JSZip.loadAsync(file);
        // Find all HTML/XHTML files in the epub, sorted by spine order
        const textFiles: string[] = [];
        // Try reading the OPF file for spine order first
        const opfFile = Object.keys(zip.files).find(k => k.endsWith(".opf"));
        let spineOrder: string[] = [];
        if (opfFile) {
          const opfContent = await zip.files[opfFile].async("text");
          const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
          if (spineMatch) {
            const idrefs = spineMatch[1].match(/idref="([^"]+)"/g);
            if (idrefs) {
              const ids = idrefs.map(r => r.match(/idref="([^"]+)"/)![1]);
              const manifest = opfContent.match(/<manifest>([\s\S]*?)<\/manifest>/i);
              if (manifest) {
                const hrefs = manifest[1].match(/<item[^>]*>/g);
                if (hrefs) {
                  const idToHref: Record<string, string> = {};
                  for (const h of hrefs) {
                    const idM = h.match(/id="([^"]+)"/);
                    const hrefM = h.match(/href="([^"]+)"/);
                    if (idM && hrefM) idToHref[idM[1]] = hrefM[1];
                  }
                  spineOrder = ids.map(id => idToHref[id]).filter(Boolean);
                }
              }
            }
          }
        }
        // Extract text from HTML files in spine order
        const htmlFiles = spineOrder.length > 0 ? spineOrder : Object.keys(zip.files).filter(k => /\.x?html?$/i.test(k));
        for (const path of htmlFiles) {
          if (zip.files[path]) {
            const html = await zip.files[path].async("text");
            // Strip HTML tags
            const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<[^>]+>/g, "\n")
              .replace(/&nbsp;/g, " ")
              .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
              .replace(/\n{3,}/g, "\n\n").trim();
            if (text.length > 100) textFiles.push(text);
          }
        }
        const fullText = textFiles.join("\n\n");
        setUploadMsg(`解析完成，${(fullText.length / 10000).toFixed(1)}万字`);
        await handleUpload(fullText, fname);
      } catch { setUploadMsg("epub 解析失败"); setUploading(false); }
    } else {
      // .txt or other: read as plain text
      const r = new FileReader();
      r.onload = ev => handleUpload(ev.target?.result as string, fname);
      r.onerror = () => { setUploadMsg("文件读取失败"); setUploading(false); };
      r.readAsText(file);
    }
  }

  async function handleDeepAnalyze() {
    if (!profId) return;
    setDeepRunning(true); setRunError(""); setDeepProgress(null);
    // Poll progress while analysis runs
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await api.get(`/profiles/${profId}`);
        const prog = data?.data?.deepAnalysisProgress;
        if (prog) {
          try { setDeepProgress(JSON.parse(prog)); } catch {}
        }
      } catch {}
    }, 2000);
    try {
      await api.post(`/profiles/${profId}/deep-analyze`);
      clearInterval(pollInterval);
      await loadProfile(profId);
      setDeepProgress(null);
    } catch (e: any) { clearInterval(pollInterval); setDeepProgress(null); setRunError(e?.response?.data?.error?.message || "深度分析失败"); }
    finally { setDeepRunning(false); }
  }

  async function handleApplyContentBeats() {
    if (!applyTargetId || !annotData.contentBeatPatterns?.overallDistribution) return;
    try {
      await api.put(`/novels/${applyTargetId}/architecture`, { contentBeatProfile: JSON.stringify(annotData.contentBeatPatterns.overallDistribution) });
    } catch { setRunError("应用内容节拍失败"); }
  }

  async function handleApplyStyle() {
    if (!applyTargetId) return;
    try {
      await api.post(`/novels/${applyTargetId}/reference-book/create-style-profile`);
      setProfileCreated(true);
      setTimeout(() => setProfileCreated(false), 3000);
    } catch { setRunError("应用风格失败"); }
  }

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
            <p className="text-sm text-slate-600">上传对标网络小说 (epub / txt)</p>
            <p className="text-xs text-slate-400">支持 .epub / .txt，百万字以上，AI 将分析架构类型、钩子风格、金手指等维度</p>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-medium text-white">
              <Upload size={12} />{uploading ? "上传中..." : "选择文件"}
              <input type="file" accept=".txt,.epub" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }} />
            </label>
            {uploadMsg && <p className={cn("text-xs", uploadMsg.includes("失败") ? "text-red-500" : "text-green-600")}>{uploadMsg}</p>}
          </div>
        )}

        {/* Actions */}
        {profId && (
          <div className="flex items-center gap-2">
            <button onClick={handleDeepAnalyze} disabled={deepRunning} className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white", deepRunning ? "bg-slate-400" : "bg-slate-800 hover:bg-slate-700")}>
              {deepRunning ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}{deepRunning ? "深度分析中..." : "全量深度分析"}
            </button>
            {deepProgress && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${deepProgress.pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-500">{deepProgress.detail}</span>
              </div>
            )}
            {!deepProgress && <span className="text-[10px] text-slate-400">全章统计 · 回环检测 · 技法提取</span>}
            {archProfile && (
              <button onClick={() => {
                if (window.confirm("分析结果已保存。删除上传的原始文本可释放存储空间，确认删除？")) {
                  api.delete(`/profiles/${profId}/content`).then(() => loadProfile(profId!)).catch(() => {});
                }
              }} className="text-[10px] text-slate-400 hover:text-red-500 underline">
                清理原文
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">总章数</div><div className="text-lg font-bold text-slate-700">{stats?.totalChapters ?? "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">回环数</div><div className="text-lg font-bold text-slate-700">{stats?.totalLoops || "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">已完成</div><div className="text-lg font-bold text-slate-700">{doneCount}/8</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">档案</div><div className="text-lg font-bold text-slate-700">{profId ? "已保存" : "新建"}</div></div>
        </div>

        {/* Architecture Profile (deep analysis result) */}
        {archProfile && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">深度分析结果</h3>
              <span className="text-[10px] text-brand-500 font-medium">{archProfile.totalChapters ?? stats?.totalChapters}章 · {archProfile.loops?.length ?? stats?.totalLoops}轮回环</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <StatBadge label="推进章" value={`${archProfile.chapterTypeDistribution?.advance ?? 0}%`} />
              <StatBadge label="过渡章" value={`${archProfile.chapterTypeDistribution?.transition ?? 0}%`} />
              <StatBadge label="冷却章" value={`${archProfile.chapterTypeDistribution?.cooldown ?? 0}%`} />
              <StatBadge label="高潮章" value={`${archProfile.chapterTypeDistribution?.climax ?? 0}%`} />
            </div>
            {archProfile.coolPointRecipe && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">爽点配方</p>
                <div className="flex gap-1 h-4 rounded-full overflow-hidden bg-slate-200">
                  {Object.entries(archProfile.coolPointRecipe as Record<string,number>).filter(([,v]) => v > 0).map(([k, v]) => (
                    <div key={k} title={`${k}: ${v}%`} className="h-full" style={{ width: `${v}%`, backgroundColor: { collect: "#059669", strategy: "#2563eb", verify: "#7c3aed", reveal: "#ea580c", upgrade: "#e11d48", faceSlap: "#ca8a04" }[k] || "#94a3b8" }} />
                  ))}
                </div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {Object.entries(archProfile.coolPointRecipe as Record<string,number>).filter(([,v]) => v > 0).map(([k, v]) => (
                    <span key={k} className="text-[10px] text-slate-500">{({collect:"收集",strategy:"策略",verify:"验证",reveal:"揭示",upgrade:"升级",faceSlap:"打脸"} as Record<string,string>)[k]??k} {v}%</span>
                  ))}
                </div>
              </div>
            )}
            {archProfile.hookProfile && (
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded bg-white p-2">
                  <span className="text-slate-400">钩子密度</span>
                  <p className="font-semibold text-slate-700">每章 {archProfile.hookProfile.shortTermPerChapter} · 每卷 {archProfile.hookProfile.mediumTermPerVolume} · {archProfile.hookProfile.longTermLines}条长线</p>
                </div>
                <div className="rounded bg-white p-2">
                  <span className="text-slate-400">伏笔窗口</span>
                  <p className="font-semibold text-slate-700">约 {archProfile.payoffPatterns?.typicalPayoffWindow ?? "?"} 章</p>
                </div>
              </div>
            )}
            {archProfile.contentBeatProfile && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1">内容节拍</p>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(archProfile.contentBeatProfile as Record<string,number>).sort(([,a],[,b])=>b-a).slice(0,6).map(([k, v]) => (
                    <span key={k} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600">{k} {v}%</span>
                  ))}
                </div>
              </div>
            )}
            {archProfile.avgChapterWordCount && (
              <div className="text-[10px] text-slate-400">平均章节 {archProfile.avgChapterWordCount.avg} 字 ({archProfile.avgChapterWordCount.min}-{archProfile.avgChapterWordCount.max}) · 平均每回环 {archProfile.avgChaptersPerLoop?.avg} 章</div>
            )}
          </div>
        )}

        {/* Analysis Results */}
        <div className="space-y-3">
          <Section title="钩子模式" icon={Eye} done={done.hooks}
            detailContent={hookData ? <HookDetail data={hookData} /> : null}>
            {done.hooks && <StatusLine label={`${Object.values(hookData?.distribution ?? {}).reduce((a:number,b:number)=>a+b,0)}章 · 平均钩力${((hookData?.avgHookStrength??0)*100).toFixed(0)}%`} />}
          </Section>

          <Section title="金手指" icon={Sparkles} done={done.goldenFinger} 
            detailContent={gfData ? <GFDetail data={gfData} /> : null}>
            {done.goldenFinger && <StatusLine label={`${gfData?.abilities?.length??0}项能力 · ${gfData?.limits?.length??0}条限制`} />}
          </Section>

          <Section title="内容节拍DNA" icon={BookOpen} done={done.contentBeats} 
            detailContent={beatData ? <BeatDetail data={beatData} onApply={handleApplyContentBeats} disabled={!applyTargetId} /> : null}>
            {done.contentBeats && <StatusLine label={`${beatData?.beatTypes?.length??0}种节拍 · ${beatData?.totalChapters??0}章`} />}
          </Section>

          <Section title="爽点分布" icon={TrendingUp} done={done.coolpoints} 
            detailContent={done.coolpoints ? <CoolPointDetail high={(annotData.highCoolChapters as number[])??[]} low={(annotData.lowCoolChapters as number[])??[]} /> : null}>
            {done.coolpoints && <StatusLine label={`高爽点${(annotData.highCoolChapters as any[])?.length??0}章 · 低爽点${(annotData.lowCoolChapters as any[])?.length??0}章`} />}
          </Section>

          <Section title="设定释放时间线" icon={FileText} done={done.timeline} 
            detailContent={timelineData ? <TimelineDetail data={timelineData} /> : null}>
            {done.timeline && <StatusLine label={`${timelineData?.length??0}条设定`} />}
          </Section>

          <Section title="写法技法" icon={BookOpen} done={done.writing} 
            detailContent={writingData ? <WritingDetail data={writingData} onApply={handleApplyStyle} applied={profileCreated} disabled={!applyTargetId} /> : null}>
            {done.writing && <StatusLine label={`${(writingData?.narrativeAssets?.length??0)+(writingData?.languageAssets?.length??0)+(writingData?.characterAssets?.length??0)+(writingData?.rhythmAssets?.length??0)+(writingData?.antiAiAssets?.length??0)}条技法`} />}
          </Section>

          <Section title="回环推断" icon={GitBranch} done={done.loops} 
            detailContent={done.loops ? <LoopDetail boundaries={(annotData.loopBoundaries as Array<{chapterIndex:number;type:string}>)??[]} total={stats?.totalChapters??0} /> : null}>
            {done.loops && <StatusLine label={`${((annotData.loopBoundaries as any[])??[]).filter((b:any)=>b.type==="start").length}轮回环`} />}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, done, children, detailContent }: {
  title: string; icon: any; done?: boolean; children?: React.ReactNode;
  detailContent?: React.ReactNode;
}) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className={cn("rounded-xl border p-4", done ? "border-green-200 bg-green-50/20" : "border-slate-200 bg-white")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn("p-1 rounded", done ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400")}><Icon size={14} /></span>
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          {done && <Check size={14} className="text-green-500" />}
        </div>
        <div className="flex items-center gap-1.5">
          {done && detailContent && (
            <button onClick={() => setShowDetail(true)}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50">
              查看详情
            </button>
          )}
        </div>
      </div>
      {children ?? (!done && <p className="text-sm text-slate-300 italic">深度分析后可查看</p>)}

      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDetail(false)}>
          <div className="w-[48rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">{title} · 完整数据</h3>
              <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            {detailContent}
          </div>
        </div>
      )}
    </div>
  );
}
