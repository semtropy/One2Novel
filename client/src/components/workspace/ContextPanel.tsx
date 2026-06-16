/**
 * ContextPanel — 右侧工具箱，九宫格卡片按钮 + 弹窗面板
 */
import { useState, useEffect, useCallback } from "react";
import {
  Users, History, ClipboardList, Eye, Target, FileText, BarChart3,
  RefreshCw, X, AlertTriangle, Gauge, Clock, Sparkles, Plus,
} from "lucide-react";
import { useNovel, useTimelineReminders, useResources as useCharacterResources } from "../../api/novel";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../app/api";
import { type WorkspaceDiagnosis } from "../../api/revision";
import { cn } from "../../lib/cn";
import { StatisticsDashboard } from "./StatisticsDashboard";
import { WritingDashboard } from "./WritingDashboard";
import { ChapterDiffModal } from "./ChapterDiffModal";
import { SceneCardPanel } from "./SceneCardPanel";

interface Props {
  novelId: string; chapterId: string | null;
  chapterTitle?: string; chapterOrder?: number;
  quality: Record<string, unknown> | null;
  diagnosis: WorkspaceDiagnosis | null;
  reviewing: boolean;
  onReview: () => void;
}

type PanelKey = "style" | "payoff" | "scene" | "character" | "timeline" | "review" | "stats" | "dashboard" | "history";

const PANELS: Array<{ key: PanelKey; label: string; icon: any }> = [
  { key: "style",     label: "写法",     icon: Eye },
  { key: "payoff",    label: "伏笔",     icon: Target },
  { key: "scene",     label: "分镜",     icon: FileText },
  { key: "character", label: "角色动态", icon: Users },
  { key: "timeline",  label: "时间线",   icon: History },
  { key: "review",    label: "审查详情", icon: ClipboardList },
  { key: "stats",     label: "统计",     icon: BarChart3 },
  { key: "dashboard", label: "仪表盘",   icon: Gauge },
  { key: "history",   label: "历史",     icon: Clock },
];

export function ContextPanel(p: Props) {
  const [active, setActive] = useState<PanelKey | null>(null);

  return (
    <div className="flex flex-col h-full">
      <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2 px-1">工具箱</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {PANELS.map(panel => (
          <button key={panel.key} onClick={() => setActive(panel.key)} disabled={!p.chapterId}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white p-2.5 transition-all hover:border-slate-400 hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
            <panel.icon size={16} className="text-slate-600" />
            <span className="text-[10px] font-medium text-slate-500">{panel.label}</span>
          </button>
        ))}
      </div>

      {/* Full components (self-contained modals) */}
      {active === "stats" && p.chapterId && <StatisticsDashboard novelId={p.novelId} onClose={() => setActive(null)} />}
      {active === "dashboard" && p.chapterId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActive(null)}>
          <div className="w-[42rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">写作仪表盘</h3><button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button></div>
            <WritingDashboard novelId={p.novelId} chapterId={p.chapterId} />
          </div>
        </div>
      )}
      {active === "history" && p.chapterId && <ChapterDiffModal novelId={p.novelId} chapterId={p.chapterId} onClose={() => setActive(null)} />}

      {/* Generic modal for other panels */}
      {active && p.chapterId && !["stats", "dashboard", "history"].includes(active) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActive(null)}>
          <div className="w-[36rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">{PANELS.find(x => x.key === active)?.label}</h3><button onClick={() => setActive(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button></div>
            {active === "style" && <StylePanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "payoff" && <PayoffPanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "scene" && <SceneCardPanel novelId={p.novelId} chapterId={p.chapterId ?? undefined} />}
            {active === "character" && <CharacterPanel novelId={p.novelId} chapterId={p.chapterId} />}
            {active === "timeline" && <TimelinePanel novelId={p.novelId} chapterId={p.chapterId} chapterOrder={p.chapterOrder} />}
            {active === "review" && <ReviewPanel novelId={p.novelId} chapterId={p.chapterId} quality={p.quality} diagnosis={p.diagnosis} reviewing={p.reviewing} onReview={p.onReview} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Style Panel — 写法配置（风格绑定管理）
// ═══════════════════════════════════════════════════════════

interface ResolvedStyle {
  styleBlock: string; antiAiPrompt: string; rules: string[];
  primaryProfileName: string | null; summary: string;
  bindings: Array<{ id: string; name: string; targetType: string; priority: number }>;
}

function StylePanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const [styleCtx, setStyleCtx] = useState<ResolvedStyle | null>(null);
  const [allProfiles, setAllProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [openDropdown, setOpenDropdown] = useState<"novel" | "chapter" | null>(null);

  const loadStyles = useCallback(async () => {
    try {
      const r = await api.get(`/styles/resolved/${novelId}?chapterId=${chapterId}`);
      setStyleCtx(r.data.data as ResolvedStyle);
    } catch { setStyleCtx(null); }
  }, [novelId, chapterId]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  async function loadProfilesAndOpen(target: "novel" | "chapter") {
    if (openDropdown === target) { setOpenDropdown(null); return; }
    try { const r = await api.get("/styles"); setAllProfiles(r.data.data ?? []); setOpenDropdown(target); } catch {}
  }

  async function handleBind(profileId: string, target: "novel" | "chapter") {
    const targetId = target === "chapter" ? chapterId : novelId;
    if (!targetId) return;
    try { await api.post(`/styles/${profileId}/bind`, { targetType: target, targetId }); setOpenDropdown(null); loadStyles(); } catch {}
  }

  async function handleUnbind(name: string, targetType: string) {
    if (!styleCtx) return;
    try {
      const endpoint = targetType === "chapter" ? `chapter/${chapterId}` : `novel/${novelId}`;
      const r = await api.get(`/styles/bindings/${endpoint}`);
      const bindings = (r.data.data ?? []) as Array<{ id: string; styleProfile?: { name: string } }>;
      const target = bindings.find(b => b.styleProfile?.name === name);
      const profileId = styleCtx.bindings.find(b => b.name === name && b.targetType === targetType)?.id;
      if (profileId && target) { await api.delete(`/styles/${profileId}/bind/${target.id}`); loadStyles(); }
    } catch {}
  }

  const chapterBindings = (styleCtx?.bindings ?? []).filter(b => b.targetType === "chapter");
  const novelBindings = (styleCtx?.bindings ?? []).filter(b => b.targetType === "novel");
  const rulesByField: Record<string, string[]> = {};
  for (const r of (styleCtx?.rules ?? [])) {
    const m = r.match(/^\[(.+?)\]\s/);
    const field = m ? m[1] : ""; const text = m ? r.slice(m[0].length) : r;
    if (!rulesByField[field]) rulesByField[field] = [];
    rulesByField[field].push(text);
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Bindings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between"><span className="font-medium text-slate-600">全书绑定</span><button onClick={() => loadProfilesAndOpen("novel")} className="text-[10px] text-slate-400 hover:text-slate-600"><Plus size={10} className="inline mr-0.5" />添加</button></div>
        {novelBindings.map(b => (
          <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1"><span className="text-slate-700">{b.name}</span><button onClick={() => handleUnbind(b.name, "novel")} className="text-slate-300 hover:text-red-500"><X size={10} /></button></div>
        ))}
        {novelBindings.length === 0 && <p className="text-slate-400 italic">未绑定全书风格</p>}
        {openDropdown === "novel" && <ProfileDropdown profiles={allProfiles} onSelect={id => handleBind(id, "novel")} onClose={() => setOpenDropdown(null)} />}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><span className="font-medium text-slate-600">本章绑定</span><button onClick={() => loadProfilesAndOpen("chapter")} className="text-[10px] text-slate-400 hover:text-slate-600"><Plus size={10} className="inline mr-0.5" />添加</button></div>
        {chapterBindings.map(b => (
          <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1"><span className="text-slate-700">{b.name}</span><button onClick={() => handleUnbind(b.name, "chapter")} className="text-slate-300 hover:text-red-500"><X size={10} /></button></div>
        ))}
        {chapterBindings.length === 0 && <p className="text-slate-400 italic">未绑定本章风格</p>}
        {openDropdown === "chapter" && <ProfileDropdown profiles={allProfiles} onSelect={id => handleBind(id, "chapter")} onClose={() => setOpenDropdown(null)} />}
      </div>
      {/* Rules */}
      {Object.keys(rulesByField).length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium text-slate-600">生效规则 ({(styleCtx?.rules ?? []).length}条)</p>
          {["叙事","语言","角色","节奏","反AI"].filter(f => rulesByField[f]).map(f => (
            <div key={f}><span className="text-[10px] text-slate-400">{f}</span>{rulesByField[f].map((r,i) => <div key={i} className="text-slate-600 ml-2">· {r}</div>)}</div>
          ))}
        </div>
      )}
      {styleCtx?.antiAiPrompt && (
        <div className="rounded bg-red-50 p-2 text-[10px] text-red-600">反AI提示：{styleCtx.antiAiPrompt.slice(0, 200)}</div>
      )}
    </div>
  );
}

function ProfileDropdown({ profiles, onSelect, onClose }: { profiles: Array<{ id: string; name: string }>; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-1.5 space-y-0.5 max-h-32 overflow-y-auto">
      {profiles.map(p => (
        <button key={p.id} onClick={() => onSelect(p.id)} className="w-full text-left px-2 py-1 rounded hover:bg-slate-50 text-xs text-slate-600">{p.name}</button>
      ))}
      <button onClick={onClose} className="w-full text-left px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-600">取消</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Payoff Panel — 伏笔管理（列表+扫描+添加）
// ═══════════════════════════════════════════════════════════

function PayoffPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const [payoffs, setPayoffs] = useState<Array<{ id: string; title: string; summary?: string; scopeType?: string; currentStatus: string; firstSeenOrder?: number; targetStartOrder?: number; targetEndOrder?: number; statusReason?: string }>>([]);
  const [scanning, setScanning] = useState(false);
  const statusMap: Record<string, string> = { setup: "已埋", hinted: "暗示", pending_payoff: "待兑现", overdue: "⚠逾期", failed: "已作废", paid_off: "已兑现" };
  const STATUS_ORDER = ["overdue", "pending_payoff", "hinted", "setup"];
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", scopeType: "volume" });

  useEffect(() => {
    api.get(`/novels/${novelId}/payoffs`).then(r => setPayoffs(r.data.data ?? [])).catch(() => {});
  }, [novelId, chapterId]);

  async function handleScan() {
    if (scanning) return; setScanning(true);
    try { await api.post(`/novels/${novelId}/chapters/${chapterId}/payoffs/scan`); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
    finally { setScanning(false); }
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    try { await api.post(`/novels/${novelId}/payoffs`, form); setShowAdd(false); setForm({ title: "", summary: "", scopeType: "volume" }); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
  }

  async function handleUpdatePayoff(payoffId: string, status: string) {
    try { await api.patch(`/novels/${novelId}/payoffs/${payoffId}`, { currentStatus: status }); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{payoffs.length}条</span>
        <div className="flex gap-1.5">
          <button onClick={handleScan} disabled={scanning} className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"><Sparkles size={10} />{scanning ? "扫描中..." : "AI 扫描"}</button>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"><Plus size={10} />添加</button>
        </div>
      </div>
      {showAdd && (
        <div className="space-y-2 rounded border border-slate-200 p-3">
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="伏笔标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="简要描述" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
          <select className="w-full rounded border border-slate-200 px-2 py-1 text-xs" value={form.scopeType} onChange={e => setForm({ ...form, scopeType: e.target.value })}><option value="book">全书级</option><option value="volume">卷级</option><option value="chapter">章级</option></select>
          <button onClick={handleAdd} className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">确认添加</button>
        </div>
      )}
      <div className="space-y-2">
        {STATUS_ORDER.map(status => {
          const items = payoffs.filter(p => p.currentStatus === status);
          if (!items.length) return null;
          return (
            <div key={status}>
              <p className="text-[10px] font-medium text-slate-500 mb-1">{statusMap[status]}</p>
              {items.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
                  <span className={cn("truncate flex-1", p.currentStatus === "overdue" ? "text-red-500 font-medium" : "text-slate-600")}>{p.title}</span>
                  <select className="text-[10px] border border-slate-100 rounded px-1 py-0 ml-2" value={p.currentStatus} onChange={e => handleUpdatePayoff(p.id, e.target.value)}>
                    {Object.entries(statusMap).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
        {payoffs.length === 0 && <p className="text-slate-400 italic text-center py-4">暂无伏笔，点击「AI 扫描」从正文提取</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Character Panel — 角色动态（含资源详情弹窗）
// ═══════════════════════════════════════════════════════════

function CharacterPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const { data: novel } = useNovel(novelId);
  const chars: Array<{ id: string; name: string; role: string; currentGoal?: string; currentStatus?: string; currentLocation?: string; voiceTexture?: string; identityLabel?: string; factionLabel?: string }> = (novel as any)?.characters ?? [];
  const active = chars.filter(c => c.currentStatus || c.currentGoal);
  const [detailCharId, setDetailCharId] = useState<string | null>(null);
  const { data: resources } = useCharacterResources(novelId, detailCharId ?? undefined);
  const ROLE_LABEL: Record<string, string> = { protagonist: "主角", antagonist: "对手", supporting: "配角", minor: "次要" };

  return (
    <div className="space-y-2 text-xs">
      {active.length > 0 ? (
        <>
          {active.slice(0, 10).map(c => (
            <div key={c.id} className="rounded border border-slate-200 p-2 cursor-pointer hover:bg-slate-50" onClick={() => setDetailCharId(detailCharId === c.id ? null : c.id)}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">{c.name} · {ROLE_LABEL[c.role] ?? c.role}</span>
                {c.currentStatus && <span className="text-[10px] text-slate-400">{c.currentStatus}</span>}
              </div>
              {c.currentGoal && <div className="text-slate-500 mt-0.5">目标：{c.currentGoal}</div>}
              {detailCharId === c.id && (
                <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                  {c.identityLabel && <div className="text-slate-400">身份：{c.identityLabel}{c.factionLabel ? ` · ${c.factionLabel}` : ""}</div>}
                  {c.currentLocation && <div className="text-slate-400">位置：{c.currentLocation}</div>}
                  {c.voiceTexture && <div className="text-slate-400 italic">声线：{c.voiceTexture}</div>}
                  <div className="text-slate-400">
                    资源：{(resources ?? []).length > 0 ? (resources ?? []).map(r => <span key={r.id} className={cn("mr-1 px-1 py-0.5 rounded text-[10px]", r.status === "depleted" ? "bg-slate-100 text-slate-300 line-through" : "bg-slate-100 text-slate-600")}>{r.name}</span>) : <span className="text-slate-300 italic">暂无</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      ) : <p className="text-slate-400 italic">写完章节后自动更新角色状态</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Timeline Panel — 时间线（提醒+冲突+重提）
// ═══════════════════════════════════════════════════════════

function TimelinePanel({ novelId, chapterId, chapterOrder }: { novelId: string; chapterId: string; chapterOrder?: number }) {
  const { data: novel, refetch } = useNovel(novelId);
  const qc = useQueryClient();
  const timelines: Array<{ title: string; category: string; sortOrder: number; status?: string }> = (novel as any)?.timelineItems ?? [];
  const { data: reminders } = useTimelineReminders(novelId, chapterOrder);
  const [conflicts, setConflicts] = useState<Array<{ description: string }>>([]);
  const [checking, setChecking] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const hasContent = !!((novel as any)?.chapters?.find((c: any) => c.id === chapterId)?.content?.length > 100);

  async function handleReExtract() {
    if (reExtracting || !chapterId) return; setReExtracting(true);
    try { await api.post(`/novels/${novelId}/chapters/${chapterId}/timeline/re-extract`); refetch(); qc.invalidateQueries({ queryKey: ["timeline-reminders", novelId, chapterOrder] }); } catch {} finally { setReExtracting(false); }
  }

  return (
    <div className="space-y-3 text-xs">
      {reminders && reminders.reminders.length > 0 && (
        <div className="rounded bg-blue-50 p-2 text-[10px]">
          <p className="font-medium text-blue-700 mb-1">写前提醒</p>
          {reminders.reminders.map((r, i) => <div key={i} className={r.isOverdue ? "text-red-600" : "text-blue-600"}>{r.isOverdue ? "⚠" : "•"} {r.title}</div>)}
        </div>
      )}
      <div className="flex gap-1.5">
        <button onClick={async () => { setChecking(true); try { const r = await api.get(`/novels/${novelId}/timeline/conflicts`); setConflicts(r.data.data ?? []); } catch {} finally { setChecking(false); } }} disabled={checking} className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">{checking ? "检查中..." : "检查冲突"}</button>
        {hasContent && <button onClick={handleReExtract} disabled={reExtracting} className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">{reExtracting ? <RefreshCw size={10} className="animate-spin inline mr-0.5" /> : null}重提</button>}
      </div>
      {conflicts.length > 0 && conflicts.map((c, i) => <div key={i} className="rounded border border-red-200 bg-red-50 p-1.5 text-[10px] text-red-600"><AlertTriangle size={10} className="inline mr-1" />{c.description}</div>)}
      {/* Color legend */}
      {timelines.length > 0 && <div className="flex items-center gap-2 text-[10px] text-slate-400"><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />事件</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-brand-400" />里程碑</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />截止日</span><span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-accent-400" />约束</span></div>}
      {timelines.length > 0 ? (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {timelines.slice(-15).reverse().map((t: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-slate-600">
              <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full", t.status === "violated" ? "bg-red-500" : t.category === "milestone" ? "bg-brand-400" : t.category === "deadline" ? "bg-red-400" : t.category === "constraint" ? "bg-accent-400" : "bg-blue-400")} />
              <span className="truncate">{t.title}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-slate-400 italic">写完章节后自动提取时间线</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Review Panel — 审查详情（质量评分+诊断）
// ═══════════════════════════════════════════════════════════

function ReviewPanel({ novelId, chapterId, quality, diagnosis, reviewing, onReview }: {
  novelId: string; chapterId: string; quality: Record<string, unknown> | null; diagnosis: WorkspaceDiagnosis | null; reviewing: boolean; onReview: () => void;
}) {
  const { data: novel } = useNovel(novelId);
  const chapter = (novel as any)?.chapters?.find((c: any) => c.id === chapterId);
  const scores = quality ?? (chapter?.qualityScore > 0 ? { openingScore: chapter.openingScore, plotScore: chapter.plotScore, characterScore: chapter.characterScore, dialogueScore: chapter.dialogueScore, suspenseScore: chapter.suspenseScore, pacingScore: chapter.pacingScore, showNotTellScore: chapter.showNotTellScore, languageScore: chapter.languageScore, genreScore: chapter.genreScore, coherenceScore: chapter.coherenceScore } : null);
  const total = scores ? Object.values(scores as Record<string,number>).reduce((a,b) => a+(b||0), 0) : 0;
  const displayDiagnosis = diagnosis ?? (() => { try { return chapter?.diagnosis ? JSON.parse(chapter.diagnosis) : null; } catch { return null; } })();

  return (
    <div className="space-y-4 text-xs">
      {reviewing ? <div className="flex items-center gap-2 text-blue-500"><RefreshCw size={12} className="animate-spin" />AI 审查中...</div>
      : !scores ? (
        <div className="space-y-2"><p className="text-slate-400">点击对本章进行AI审查（质量评分+段落诊断）</p><button onClick={onReview} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">开始审查</button></div>
      ) : (
        <>
          <div className="text-slate-600">总分 <span className="font-bold text-slate-800">{total}</span>/100</div>
          <div className="space-y-0.5">
            {[["开头吸引力","openingScore"],["情节推进","plotScore"],["人物塑造","characterScore"],["对话质量","dialogueScore"],["悬念设置","suspenseScore"],["节奏控制","pacingScore"],["展示而非讲述","showNotTellScore"],["语言质量","languageScore"],["题材适应度","genreScore"],["跨章连贯性","coherenceScore"]].map(([l,k]) => (
              <div key={l} className="flex items-center gap-2"><span className="w-16 text-right text-slate-500 shrink-0">{l}</span><div className="flex-1 h-1.5 bg-slate-100 rounded-full"><div className={cn("h-full rounded-full", (scores as any)[k]>=7?"bg-green-400":(scores as any)[k]>=5?"bg-accent-400":"bg-red-400")} style={{width:`${(scores as any)[k]*10}%`}}/></div><span className="w-3 text-right font-medium">{(scores as any)[k]}</span></div>
            ))}
          </div>
          {displayDiagnosis?.cards?.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-slate-600">段落诊断</p>
              {displayDiagnosis.cards.map((card: any, i: number) => (
                <div key={i} className="rounded border border-slate-200 p-1.5"><span className="text-[10px] px-1 py-0 rounded bg-slate-100 text-slate-600">{card.title}</span><div className="text-slate-500 mt-0.5">{card.problemSummary}</div></div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
