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
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [profileCreated, setProfileCreated] = useState(false);
  const [applyTargetId, setApplyTargetId] = useState<string>("");
  useEffect(() => {
    if (profId) loadProfile(profId);
  }, [profId]);

  async function loadProfile(pid: string) {
    try {
      const { data } = await api.get(`/profiles/${pid}`);
      const p = data.data;
      if (!p) return;
      setName(p.name ?? "");
      if (p.analysisResult) {
        try { setAnalysisResult(JSON.parse(p.analysisResult)); } catch {}
      }
      setFileName(p.name ?? "");
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
        // Read the OPF file for spine order
        const opfFile = Object.keys(zip.files).find(k => k.endsWith(".opf"));
        const opfDir = opfFile ? opfFile.replace(/[^/]+$/, "") : "";
        let spineOrder: string[] = [];
        if (opfFile) {
          const opfContent = await zip.files[opfFile].async("text");
          const spineMatch = opfContent.match(/<(?:opf:)?spine[^>]*>([\s\S]*?)<\/(?:opf:)?spine>/i);
          if (spineMatch) {
            const idrefs = spineMatch[1].match(/idref="([^"]+)"/g);
            if (idrefs) {
              const ids = idrefs.map(r => r.match(/idref="([^"]+)"/)![1]);
              const manifest = opfContent.match(/<(?:opf:)?manifest[^>]*>([\s\S]*?)<\/(?:opf:)?manifest>/i);
              if (manifest) {
                const hrefs = manifest[1].match(/<(?:opf:)?item[^>]*>/g);
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
        // Each spine item = one chapter. Keep them as separate entries.
        // Resolve relative hrefs against the OPF directory
        const resolvePath = (href: string) => opfDir ? (opfDir + href).replace(/\/\//g, "/") : href;
        const htmlFiles = spineOrder.length > 0 ? spineOrder.map(resolvePath) : Object.keys(zip.files).filter(k => /\.x?html?$/i.test(k));
        const chapters: { title: string; content: string }[] = [];
        for (let i = 0; i < htmlFiles.length; i++) {
          const path = htmlFiles[i];
          if (zip.files[path]) {
            const html = await zip.files[path].async("text");
            const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<[^>]+>/g, "\n")
              .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
              .replace(/\n{3,}/g, "\n\n").trim();
            if (text.length > 100) {
              // Extract title from first meaningful line
              const lines = text.split("\n").filter(l => l.trim().length > 0);
              const title = lines[0]?.trim().slice(0, 40) || `第${i + 1}章`;
              chapters.push({ title, content: text });
            }
          }
        }
        // Send as structured chapters, not concatenated blob
        const fullText = JSON.stringify(chapters);
        setUploadMsg(`解析完成，${chapters.length}章，${(chapters.reduce((s,c)=>s+c.content.length,0)/10000).toFixed(1)}万字`);
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
    if (!applyTargetId || !r.contentBeatPatterns?.overallDistribution) return;
    try {
      await api.put(`/novels/${applyTargetId}/architecture`, { contentBeatProfile: JSON.stringify(r.contentBeatPatterns.overallDistribution) });
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

  const r = analysisResult;
  const hasResult = !!r;

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
            {r && (
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
            {r && (
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
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">总章数</div><div className="text-lg font-bold text-slate-700">{r?.totalChapters ?? "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">回环数</div><div className="text-lg font-bold text-slate-700">{r?.loopNarratives?.length ?? "—"}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center"><div className="text-slate-400">节奏</div><div className="text-lg font-bold text-slate-700">{r?.rhythmProfile?.rhythmTemplate ?? "—"}</div></div>
        </div>

        {/* Analysis Results V2 */}
        {hasResult ? (
          <div className="space-y-3">
            {/* Loop Narratives */}
            {r.loopNarratives?.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><GitBranch size={14}/>回环叙事分析 ({r.loopNarratives.length}轮)</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {r.loopNarratives.map((l:any, i:number) => (
                    <details key={i} className="rounded-lg border border-slate-100 p-2 text-xs">
                      <summary className="cursor-pointer font-medium text-slate-600">
                        第{l.loopIndex}轮回环 (第{l.startChapter}-{l.endChapter}章) — {l.narrativeFunction}
                      </summary>
                      <div className="mt-2 space-y-1 text-slate-500 pl-2 border-l-2 border-brand-200">
                        <p><b className="text-slate-600">核心冲突：</b>{l.coreConflict}</p>
                        <p><b className="text-slate-600">主角变化：</b>{l.protagonistChange}</p>
                        <p><b className="text-slate-600">关键事件：</b>{l.keyEvents?.join(" · ")}</p>
                        <p><b className="text-slate-600">信息揭示：</b>{l.infoRevealed?.join(" · ")}</p>
                        <p><b className="text-slate-600">结算：</b>{l.settlementContent}</p>
                        <p><b className="text-slate-600">升级方向：</b>{l.progressionFromPrevious}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {/* Rhythm Profile */}
            {r.rhythmProfile && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><TrendingUp size={14}/>节奏曲线</h3>
                <p className="text-xs text-slate-500 mb-2">{r.rhythmProfile.rhythmDescription}</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-slate-50 p-2 text-center"><span className="text-slate-400">高潮间隔</span><p className="font-bold text-slate-700">{r.rhythmProfile.avgClimaxInterval}章</p></div>
                  <div className="rounded bg-slate-50 p-2 text-center"><span className="text-slate-400">冷却段</span><p className="font-bold text-slate-700">{r.rhythmProfile.avgCooldownLength}章</p></div>
                  <div className="rounded bg-slate-50 p-2 text-center"><span className="text-slate-400">节奏模板</span><p className="font-bold text-slate-700">{r.rhythmProfile.rhythmTemplate}</p></div>
                </div>
              </div>
            )}

            {/* Golden Finger Design Pattern */}
            {r.goldenFingerAnalysis && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Sparkles size={14}/>金手指：{r.goldenFingerAnalysis.name}</h3>
                <div className="text-xs text-slate-500 space-y-1">
                  <p><b>能力：</b>{r.goldenFingerAnalysis.abilities?.join(" · ")}</p>
                  <p><b>限制：</b>{r.goldenFingerAnalysis.limits?.join(" · ")}</p>
                  {r.goldenFingerAnalysis.designPattern && (
                    <div className="mt-2 p-2 rounded bg-brand-50 border border-brand-100">
                      <p className="font-medium text-brand-700 mb-1">设计模式：{r.goldenFingerAnalysis.designPattern.type} — {r.goldenFingerAnalysis.designPattern.typeDescription}</p>
                      <p><b>核心机制：</b>{r.goldenFingerAnalysis.designPattern.coreMechanic}</p>
                      <p><b>获取方式：</b>{r.goldenFingerAnalysis.designPattern.acquisitionPattern}</p>
                      <p><b>进化路径：</b>{r.goldenFingerAnalysis.designPattern.evolutionPath?.join(" → ")}</p>
                      <p><b>限制策略：</b>{r.goldenFingerAnalysis.designPattern.limitationStrategy}</p>
                      <p><b>叙事融合：</b>{r.goldenFingerAnalysis.designPattern.narrativeIntegration}</p>
                      <p><b>适用：</b>{r.goldenFingerAnalysis.designPattern.suitability?.genres?.join("、")} · {r.goldenFingerAnalysis.designPattern.suitability?.architectures?.join("、")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Craft Stats */}
            {r.craftStats && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><BookOpen size={14}/>写作手法统计</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-slate-50 p-2">
                    <span className="text-slate-400">开场方式</span>
                    <p className="font-semibold text-slate-700">{r.craftStats.dominantOpening}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {Object.entries(r.craftStats.openingPatterns as Record<string,number>).map(([k,v]) => (
                        <span key={k} className="text-[10px] bg-white rounded px-1 py-0 text-slate-500">{k} {v}章</span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded bg-slate-50 p-2">
                    <span className="text-slate-400">对白密度</span>
                    <p className="font-semibold text-slate-700">约 {r.craftStats.dialogueRatio}%</p>
                    <p className="text-[10px] text-slate-400">每章约 {r.craftStats.avgDialoguePerChapter} 次对话</p>
                  </div>
                </div>
              </div>
            )}

            {/* Writing Techniques */}
            {r.writingTechniques && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><BookOpen size={14}/>写法技法</h3>
                <p className="text-xs text-slate-500 mb-2">{r.writingTechniques.overallStyleDescription}</p>
                {(["narrativeAssets","languageAssets","characterAssets","rhythmAssets","antiAiAssets"] as const).map(cat => {
                  const items = r.writingTechniques[cat] as Array<{category:string;rule:string;confidence:number}> | undefined;
                  if (!items?.length) return null;
                  const label: Record<string,string> = {narrativeAssets:"叙事技法",languageAssets:"语言风格",characterAssets:"角色塑造",rhythmAssets:"节奏控制",antiAiAssets:"反AI特征"};
                  return (
                    <details key={cat} className="mt-1 text-xs">
                      <summary className="cursor-pointer text-slate-600 font-medium">{label[cat]} ({items.length}条)</summary>
                      <div className="mt-1 space-y-1 pl-2 border-l-2 border-slate-200">
                        {items.slice(0,3).map((t,i) => <p key={i} className="text-slate-500">{t.rule} <span className="text-[10px] text-slate-300">({(t.confidence*100).toFixed(0)}%)</span></p>)}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            {/* Architecture Profile summary */}
            {r.architectureProfile && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">架构蓝图</h3>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <span className="text-slate-400">章节分布：</span>
                  <span className="col-span-3 text-slate-600">推进 {r.architectureProfile.chapterTypeDistribution?.advance}% · 过渡 {r.architectureProfile.chapterTypeDistribution?.transition}% · 冷却 {r.architectureProfile.chapterTypeDistribution?.cooldown}% · 高潮 {r.architectureProfile.chapterTypeDistribution?.climax}%</span>
                  <span className="text-slate-400">平均章数：</span>
                  <span className="col-span-3 text-slate-600">{r.architectureProfile.avgChapterWordCount?.avg}字 · 每回环 {r.architectureProfile.avgChaptersPerLoop?.avg}章</span>
                  <span className="text-slate-400">钩子密度：</span>
                  <span className="col-span-3 text-slate-600">短期 {r.architectureProfile.hookProfile?.shortTermPerChapter} · 中期 {r.architectureProfile.hookProfile?.mediumTermPerVolume} · 长线 {r.architectureProfile.hookProfile?.longTermLines}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400">暂无分析结果。上传参考书后点击「全量深度分析」。</div>
        )}
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
