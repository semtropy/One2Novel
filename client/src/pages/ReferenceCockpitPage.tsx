/**
 * ReferenceCockpitPage — 参考书驾驶舱 V2
 * /reference-profiles/new → 上传+分析
 * /reference-profiles/:id → 查看已有档案
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Upload, Sparkles, Check, RefreshCw, Zap, GitBranch, BookOpen, TrendingUp, X, ArrowLeft } from "lucide-react";
import { useNovels } from "../api/novel";
import { api } from "../app/api";
import { cn } from "../lib/cn";
import JSZip from "jszip";

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
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepProgress, setDeepProgress] = useState<{phase:string;detail:string;pct:number}|null>(null);
  const [runError, setRunError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
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
