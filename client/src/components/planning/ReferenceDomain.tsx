/**
 * ReferenceDomain — upload a reference novel .txt and run AI analysis.
 * Shows stats grid, loop distribution swimlane, cool point heatmap,
 * setting timeline, and writing-assets summary with "create style profile" action.
 *
 * Props: novelId — not used for the selector itself (the dropdown is internal),
 * but passed through to all API calls so the analysis is scoped to a specific novel.
 */
import { useState, useEffect } from "react";
import {
  Upload, Sparkles, Check, RefreshCw, Target, BookOpen,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovels, useExtractWritingAssets, useCreateStyleProfileFromAssets } from "../../api/novel";
import { api } from "../../app/api";

// ── Types ─────────────────────────────────────────────

interface ReferenceStats {
  totalChapters: number;
  totalLoops: number;
  avgChaptersPerLoop: number | null;
  loopDistribution?: Array<{
    loopIndex: number;
    startChapter: number;
    endChapter: number;
    chapterCount: number;
  }>;
  coolPointDensity?: Array<{
    chapterIndex: number;
    level: string;
  }>;
  settingTimeline?: Array<{
    chapterIndex: number;
    settingName: string;
  }>;
}

interface WritingAsset {
  category: string;
  observation: string;
  rule: string;
  confidence: number;
}

interface WritingAssetCollection {
  extractedAt: string;
  sourceChapterIndices: number[];
  overallStyleDescription: string;
  narrativeAssets: WritingAsset[];
  languageAssets: WritingAsset[];
  characterAssets: WritingAsset[];
  rhythmAssets: WritingAsset[];
  antiAiAssets: WritingAsset[];
}

// ── Component ─────────────────────────────────────────

export function ReferenceDomain({ novelId }: { novelId: string }) {
  const qc = useQueryClient();
  const { data: novels } = useNovels();
  const extractWritingAssets = useExtractWritingAssets();
  const createStyleProfile = useCreateStyleProfileFromAssets();

  const [selectedNovelId, setSelectedNovelId] = useState(novelId || "");
  const [uploadMsg, setUploadMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [stats, setStats] = useState<ReferenceStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [writingAssets, setWritingAssets] = useState<WritingAssetCollection | null>(null);
  const [profileCreated, setProfileCreated] = useState(false);

  // Keep selectedNovelId in sync when parent novelId changes
  useEffect(() => {
    if (novelId) setSelectedNovelId(novelId);
  }, [novelId]);

  // Load stats when selectedNovelId changes and we think there's a reference book
  useEffect(() => {
    if (!selectedNovelId) return;
    loadStats();
  }, [selectedNovelId]);

  const nid = selectedNovelId;

  // ── Upload ──────────────────────────────────────────

  async function handleUpload(text: string, name: string) {
    if (!nid) { setUploadMsg("请先选择小说"); return; }
    setUploadMsg("上传中...");
    try {
      await api.post(`/novels/${nid}/reference-book`, { fileName: name, content: text });
      setUploadMsg("上传成功");
      setFileName(name);
      loadStats();
    } catch { setUploadMsg("上传失败"); }
  }

  // ── Stats ───────────────────────────────────────────

  async function loadStats() {
    if (!nid) return;
    setLoadingStats(true);
    try {
      const { data } = await api.get(`/novels/${nid}/reference-book/statistics`);
      setStats(data.data);
      loadWritingAssets();
    } catch { setStats(null); }
    finally { setLoadingStats(false); }
  }

  async function loadWritingAssets() {
    try {
      const { data } = await api.get(`/novels/${nid}/reference-book`);
      if (data.data?.writingAssets) {
        try { setWritingAssets(JSON.parse(data.data.writingAssets)); } catch {}
      }
    } catch {}
  }

  // ── Analysis Actions ────────────────────────────────

  async function handleInferLoops() {
    if (!nid) return;
    setActiveAction("infer-loops");
    try { await api.post(`/novels/${nid}/reference-book/infer-loops`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleInferCoolpoints() {
    if (!nid) return;
    setActiveAction("infer-coolpoints");
    try { await api.post(`/novels/${nid}/reference-book/infer-coolpoints`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleDetectArchitecture() {
    if (!nid) return;
    setActiveAction("detect-architecture");
    try { await api.post(`/novels/${nid}/reference-book/detect-architecture`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleExtractHookPatterns() {
    if (!nid) return;
    setActiveAction("extract-hooks");
    try { await api.post(`/novels/${nid}/reference-book/extract-hook-patterns`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleExtractGoldenFinger() {
    if (!nid) return;
    setActiveAction("extract-golden-finger");
    try { await api.post(`/novels/${nid}/reference-book/extract-golden-finger`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleExtractSettingTimeline() {
    if (!nid) return;
    setActiveAction("extract-timeline");
    try { await api.post(`/novels/${nid}/reference-book/extract-setting-timeline`); loadStats(); } catch {}
    finally { setActiveAction(null); }
  }

  async function handleExtractWritingAssets() {
    if (!nid) return;
    setActiveAction("extract-writing");
    try {
      const result = await extractWritingAssets.mutateAsync(nid);
      setWritingAssets(result as WritingAssetCollection);
    } catch {} finally { setActiveAction(null); }
  }

  async function handleRemove() {
    if (!nid) return;
    try {
      await api.delete(`/novels/${nid}/reference-book`);
      setStats(null); setUploadMsg(""); setFileName("");
      setWritingAssets(null); setProfileCreated(false);
      qc.invalidateQueries({ queryKey: ["novel", nid] });
    } catch {}
  }

  async function handleCreateStyleProfileFromRef() {
    if (!nid) return;
    try {
      await createStyleProfile.mutateAsync(nid);
      setProfileCreated(true);
    } catch {}
  }

  // ── Render ──────────────────────────────────────────

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        上传一本对标网络小说（如《诡秘之主》《凡人修仙传》等），AI 将分析其章节结构、回环节奏和爽点分布，为你的长篇创作提供参考。
      </p>

      {/* Novel Selector Dropdown */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">选择小说</label>
        <select
          value={selectedNovelId}
          onChange={(e) => {
            setSelectedNovelId(e.target.value);
            setStats(null);
            setWritingAssets(null);
            setFileName("");
            setProfileCreated(false);
          }}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          <option value="">-- 选择小说 --</option>
          {(novels ?? []).map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
      </div>

      {/* Upload / Loading State */}
      {!stats && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-10 text-center">
          {loadingStats ? (
            <>
              <RefreshCw size={32} className="mx-auto mb-3 text-slate-300 animate-spin" />
              <p className="text-sm text-slate-500">正在加载参考书数据...</p>
            </>
          ) : (
            <>
          <Upload size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">拖拽或选择 .txt 文件（支持100万字以上）</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700">
            选择文件
            <input
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setFileName(file.name);
                  const reader = new FileReader();
                  reader.onload = (ev) => handleUpload(ev.target?.result as string, file.name);
                  reader.readAsText(file);
                }
              }}
            />
          </label>
          {uploadMsg && (
            <p className={`text-xs mt-2 ${uploadMsg.includes("失败") ? "text-red-500" : "text-green-600"}`}>
              {uploadMsg}
            </p>
          )}
          </>
          )}
        </div>
      )}

      {/* Reference uploaded — show analysis dashboard */}
      {stats && (
        <div className="space-y-4">
          {/* Header + Stats Grid */}
          <div className="rounded-xl border border-green-200 bg-green-50/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-green-800">
                {fileName || "对标书"}
              </span>
              <button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-600">移除</button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 text-xs mb-3">
              <div className="rounded bg-white p-2 text-center">
                <div className="text-slate-400">总章数</div>
                <div className="text-lg font-bold text-slate-700">{stats.totalChapters}</div>
              </div>
              <div className="rounded bg-white p-2 text-center">
                <div className="text-slate-400">回环数</div>
                <div className="text-lg font-bold text-slate-700">{stats.totalLoops}</div>
              </div>
              <div className="rounded bg-white p-2 text-center">
                <div className="text-slate-400">均章/回环</div>
                <div className="text-lg font-bold text-slate-700">{stats.avgChaptersPerLoop ?? "—"}</div>
              </div>
            </div>

            {/* Analysis Toolbar */}
            <div className="flex gap-2 mb-3 flex-wrap">
              <AnalysisBtn label="推断回环边界" icon={Target} action="infer-loops" activeAction={activeAction} onClick={handleInferLoops} />
              <AnalysisBtn label="推断爽点分布" icon={Sparkles} action="infer-coolpoints" activeAction={activeAction} onClick={handleInferCoolpoints} />
              <AnalysisBtn label="提取写法技法" icon={BookOpen} action="extract-writing" activeAction={activeAction} onClick={handleExtractWritingAssets} />
              <AnalysisBtn label="检测架构" icon={Target} action="detect-architecture" activeAction={activeAction} onClick={handleDetectArchitecture} />
              <AnalysisBtn label="提取钩子模式" icon={Target} action="extract-hooks" activeAction={activeAction} onClick={handleExtractHookPatterns} />
              <AnalysisBtn label="提取金手指" icon={Sparkles} action="extract-golden-finger" activeAction={activeAction} onClick={handleExtractGoldenFinger} />
              <AnalysisBtn label="提取设定时间线" icon={BookOpen} action="extract-timeline" activeAction={activeAction} onClick={handleExtractSettingTimeline} />
            </div>

            {/* Writing Assets Summary */}
            {writingAssets && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 mb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-indigo-800">提取的写法技法</p>
                  <span className="text-[10px] text-indigo-400">
                    采样{writingAssets.sourceChapterIndices?.length ?? 0}章
                    {(() => {
                      const all = [
                        ...(writingAssets.narrativeAssets ?? []),
                        ...(writingAssets.languageAssets ?? []),
                        ...(writingAssets.characterAssets ?? []),
                        ...(writingAssets.rhythmAssets ?? []),
                        ...(writingAssets.antiAiAssets ?? []),
                      ];
                      return all.length > 0
                        ? ` · 均置信度${(all.reduce((s, t) => s + t.confidence, 0) / all.length * 100).toFixed(0)}%`
                        : "";
                    })()}
                  </span>
                </div>
                {writingAssets.overallStyleDescription && (
                  <p className="text-xs text-indigo-700 leading-relaxed">
                    {writingAssets.overallStyleDescription}
                  </p>
                )}
                {/* 5-category breakdown */}
                <div className="grid grid-cols-5 gap-1.5 text-[10px]">
                  {[
                    ["叙事", writingAssets.narrativeAssets?.length ?? 0],
                    ["语言", writingAssets.languageAssets?.length ?? 0],
                    ["角色", writingAssets.characterAssets?.length ?? 0],
                    ["节奏", writingAssets.rhythmAssets?.length ?? 0],
                    ["反AI", writingAssets.antiAiAssets?.length ?? 0],
                  ].map(([label, count]) => (
                    <div key={label as string} className="rounded bg-white px-2 py-1 text-center">
                      <div className="font-bold text-indigo-600">{count as number}</div>
                      <div className="text-slate-400">{label as string}</div>
                    </div>
                  ))}
                </div>
                {!profileCreated && (
                  <button
                    onClick={handleCreateStyleProfileFromRef}
                    disabled={createStyleProfile.isPending}
                    className="flex items-center gap-1 rounded border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-600 hover:bg-green-100 disabled:opacity-50"
                  >
                    <Sparkles size={11} />
                    {createStyleProfile.isPending ? "创建中..." : "创建写法配置"}
                  </button>
                )}
                {profileCreated && (
                  <p className="text-xs text-green-600">✅ 写法配置已创建并绑定到当前小说</p>
                )}
              </div>
            )}

            {/* Loop Distribution Swimlane */}
            {stats.loopDistribution && stats.loopDistribution.length > 0 && (
              <div className="rounded bg-white p-3 mb-3">
                <p className="text-xs font-medium text-slate-600 mb-2">回环分布</p>
                <div className="flex items-end gap-0.5 h-12">
                  {stats.loopDistribution.map((ld) => {
                    const maxCh = Math.max(...stats.loopDistribution!.map((l) => l.chapterCount));
                    const h = Math.max(4, (ld.chapterCount / maxCh) * 48);
                    return (
                      <div
                        key={ld.loopIndex}
                        className="flex-1 flex flex-col items-center justify-end"
                        title={`第${ld.loopIndex}轮回环：第${ld.startChapter}-${ld.endChapter}章（${ld.chapterCount}章）`}
                      >
                        <span className="text-[9px] text-slate-400 mb-0.5">{ld.chapterCount}</span>
                        <div
                          className="w-full rounded-sm bg-purple-400 hover:bg-purple-500 transition-colors"
                          style={{ height: `${h}px` }}
                        />
                        <span className="text-[9px] text-slate-400 mt-0.5">#{ld.loopIndex}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cool Point Density Heatmap */}
            {stats.coolPointDensity && stats.coolPointDensity.length > 0 && (
              <div className="rounded bg-white p-3 mb-3">
                <p className="text-xs font-medium text-slate-600 mb-1.5">爽点密度</p>
                <div className="flex flex-wrap gap-px">
                  {stats.coolPointDensity.map((cp) => (
                    <div
                      key={cp.chapterIndex}
                      className="w-3 h-3 rounded-sm"
                      title={`第${cp.chapterIndex}章：${cp.level === "high" ? "高爽点" : cp.level === "low" ? "低爽点" : "中性"}`}
                      style={{
                        background:
                          cp.level === "high"
                            ? "#10b981"
                            : cp.level === "low"
                            ? "#cbd5e1"
                            : "#f1f5f9",
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                  <span>
                    <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-0.5" />
                    高爽点
                  </span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-sm bg-slate-300 mr-0.5" />
                    低爽点
                  </span>
                </div>
              </div>
            )}

            {/* Setting Timeline */}
            {stats.settingTimeline && stats.settingTimeline.length > 0 && (
              <div className="rounded bg-white p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">设定释放时间线</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {stats.settingTimeline.map((st, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 w-12 text-slate-400">第{st.chapterIndex}章</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-slate-600">{st.settingName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────

function AnalysisBtn({
  label,
  icon: Icon,
  action,
  activeAction,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  action: string;
  activeAction: string | null;
  onClick: () => void;
}) {
  const running = activeAction === action;
  const disabled = activeAction !== null;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
    >
      {running ? (
        <RefreshCw size={12} className="animate-spin" />
      ) : (
        <Icon size={12} />
      )}
      {running ? "分析中..." : label}
    </button>
  );
}
