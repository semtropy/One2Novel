import { useEffect, useState, useCallback } from "react";
import { api } from "../../app/api";
import { Lightbulb, Clock, Plus, X, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { SceneCardPanel } from "./SceneCardPanel";

interface Props { novelId: string; chapterId: string | null }

interface ResolvedStyle {
  styleBlock: string;
  antiAiPrompt: string;
  rules: string[];
  primaryProfileName: string | null;
  summary: string;
  bindings: Array<{ id: string; name: string; targetType: string; priority: number }>;
}

export function BottomPanel({ novelId, chapterId }: Props) {
  const [payoffs, setPayoffs] = useState<Array<{ id: string; title: string; summary?: string; scopeType?: string; currentStatus: string; firstSeenOrder?: number; targetStartOrder?: number; targetEndOrder?: number; statusReason?: string }>>([]);
  const [styleCtx, setStyleCtx] = useState<ResolvedStyle | null>(null);
  const [allProfiles, setAllProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [showStyleDetail, setShowStyleDetail] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"novel" | "chapter" | null>(null);
  const [showPayoffDetail, setShowPayoffDetail] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function handleScanPayoffs() {
    if (!chapterId || scanning) return;
    setScanning(true);
    try {
      await api.post(`/novels/${novelId}/chapters/${chapterId}/payoffs/scan`);
      const r = await api.get(`/novels/${novelId}/payoffs`);
      setPayoffs(r.data.data ?? []);
    } catch (e) { console.error("Payoff scan failed:", e); }
    finally { setScanning(false); }
  }

  const loadStyles = useCallback(async () => {
    try {
      const params = chapterId ? `?chapterId=${chapterId}` : "";
      const r = await api.get(`/styles/resolved/${novelId}${params}`);
      setStyleCtx(r.data.data as ResolvedStyle);
    } catch { setStyleCtx(null); }
  }, [novelId, chapterId]);

  useEffect(() => {
    if (!chapterId) { setStyleCtx(null); return; }
    loadStyles();
    api.get(`/novels/${novelId}/payoffs`).then(r => setPayoffs(r.data.data ?? [])).catch(() => {});
  }, [novelId, chapterId, loadStyles]);

  async function loadProfilesAndOpenDropdown(target: "novel" | "chapter") {
    if (openDropdown === target) { setOpenDropdown(null); return; }
    try {
      const r = await api.get("/styles");
      setAllProfiles(r.data.data ?? []);
      setOpenDropdown(target);
    } catch {}
  }

  async function handleBind(profileId: string, target: "novel" | "chapter") {
    const targetId = target === "chapter" ? chapterId : novelId;
    if (!targetId) return;
    try {
      await api.post(`/styles/${profileId}/bind`, { targetType: target, targetId });
      setOpenDropdown(null);
      loadStyles();
    } catch {}
  }

  async function handleUnbindChapter(bindingName: string) {
    if (!chapterId || !styleCtx) return;
    try {
      const r = await api.get(`/styles/bindings/chapter/${chapterId}`);
      const chapterBindings = (r.data.data ?? []) as Array<{ id: string; styleProfile?: { name: string } }>;
      const target = chapterBindings.find(b => b.styleProfile?.name === bindingName);
      const profileId = styleCtx.bindings.find(b => b.name === bindingName && b.targetType === "chapter")?.id;
      if (profileId && target) { await api.delete(`/styles/${profileId}/bind/${target.id}`); loadStyles(); }
    } catch {}
  }

  async function handleUnbindNovel(name: string) {
    if (!styleCtx) return;
    try {
      const r = await api.get(`/styles/bindings/novel/${novelId}`);
      const bindings = (r.data.data ?? []) as Array<{ id: string; styleProfile?: { name: string } }>;
      const target = bindings.find(b => b.styleProfile?.name === name);
      const profileId = styleCtx.bindings.find(b => b.name === name && b.targetType === "novel")?.id;
      if (profileId && target) { await api.delete(`/styles/${profileId}/bind/${target.id}`); loadStyles(); }
    } catch {}
  }

  // Bindings from the API — source of truth for what's bound (independent of rule contribution)
  const chapterBindings = (styleCtx?.bindings ?? []).filter(b => b.targetType === "chapter");
  const novelBindings = (styleCtx?.bindings ?? []).filter(b => b.targetType === "novel");

  // Group merged rules by field for display
  const rulesByField: Record<string, string[]> = {};
  for (const r of (styleCtx?.rules ?? [])) {
    const m = r.match(/^\[(.+?)\]\s/);
    const field = m ? m[1] : "";
    const text = m ? r.slice(m[0].length) : r;
    if (!rulesByField[field]) rulesByField[field] = [];
    rulesByField[field].push(text);
  }
  const FIELD_ORDER = ["叙事", "语言", "角色", "节奏", "反AI"];
  const totalRuleCount = styleCtx?.rules?.length ?? 0;
  const statusMap: Record<string, string> = { setup: "已埋", hinted: "暗示", pending_payoff: "待兑现", overdue: "⚠逾期", failed: "已作废", paid_off: "已兑现" };
  const activePayoffs = payoffs.filter(p => p.currentStatus !== "paid_off" && p.currentStatus !== "failed");
  const STATUS_ORDER = ["overdue", "pending_payoff", "hinted", "setup"];

  if (!chapterId) return null;

  return (
    <div className="flex gap-3 text-xs h-full">
      {/* Style Constraints — compact indicator */}
      <div className="flex-1 border-r border-slate-100 pr-3 overflow-hidden cursor-pointer hover:bg-slate-50 rounded p-2 -m-2 flex flex-col" onClick={() => setShowStyleDetail(true)}>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1 shrink-0"><Clock size={12} />写法</h4>
        {totalRuleCount > 0 ? (
          <div className="text-xs text-slate-500 leading-relaxed">
            {styleCtx?.primaryProfileName ?? "已绑定"}
            {novelBindings.length > 0 ? " · 全书" : ""}
            {chapterBindings.length > 0 ? " · 本章" : ""}
            {totalRuleCount > 0 ? ` · ${totalRuleCount}条` : ""}
            {styleCtx?.summary && (
              <p className="text-slate-600 line-clamp-3 mt-0.5">{styleCtx.summary}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1"><p className="text-xs text-slate-400 italic">点击配置写法</p></div>
        )}
      </div>

      {/* Payoffs */}
      <div className="flex-1 border-r border-slate-100 pr-3 overflow-hidden cursor-pointer hover:bg-slate-50 rounded p-2 -m-2 flex flex-col" onClick={() => setShowPayoffDetail(true)}>
        <h4 className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1 shrink-0"><Lightbulb size={12} />伏笔</h4>
        {activePayoffs.length > 0 ? (
          <div className="text-xs text-slate-500 leading-relaxed">
            {activePayoffs.slice(0, 3).map((p, i) => (
              <div key={i} className="truncate"><span className={p.currentStatus === "overdue" ? "text-red-500 font-medium" : ""}>{statusMap[p.currentStatus] ?? p.currentStatus}</span> {p.title}</div>
            ))}
            {activePayoffs.length > 3 && <div className="text-slate-300">...</div>}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center"><p className="text-xs text-slate-400 italic">点击查看伏笔</p></div>
        )}
      </div>

      {/* Payoff Detail Popup */}
      {showPayoffDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowPayoffDetail(false)}>
          <div className="w-[44rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-800">伏笔</h3>
                <span className="text-xs text-slate-400">{payoffs.length}条</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={handleScanPayoffs} disabled={scanning}
                  className="text-xs px-2 py-1 rounded border border-brand-200 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-0.5">
                  <Sparkles size={10} />{scanning ? "扫描中..." : "AI 扫描"}
                </button>
                <AddPayoffForm novelId={novelId} onDone={() => {
                  api.get(`/novels/${novelId}/payoffs`).then(r => setPayoffs(r.data.data ?? [])).catch(() => {});
                }} />
                <button onClick={() => setShowPayoffDetail(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
              </div>
            </div>
            <div className="space-y-3">
              {STATUS_ORDER.map(status => {
                const items = payoffs.filter(p => p.currentStatus === status);
                if (!items.length) return null;
                return (
                  <div key={status}>
                    <p className="text-xs font-medium text-slate-500 mb-1">{statusMap[status]}</p>
                    <div className="space-y-1">
                      {items.map(p => <PayoffCard key={p.id} payoff={p} statusMap={statusMap} novelId={novelId} onUpdated={() => {
                        api.get(`/novels/${novelId}/payoffs`).then(r => setPayoffs(r.data.data ?? [])).catch(() => {});
                      }} />)}
                    </div>
                  </div>
                );
              })}
              {payoffs.length === 0 && <p className="text-xs text-slate-400 text-center py-8">暂无伏笔</p>}
            </div>
          </div>
        </div>
      )}

      {/* Scene Cards */}
      <SceneCardPanel novelId={novelId} chapterId={chapterId ?? undefined} />

      {/* Style Detail Popup */}
      {showStyleDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowStyleDetail(false)}>
          <div className="w-[36rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">写法</h3>
              <button onClick={() => setShowStyleDetail(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            {/* Binding management */}
            <div className="mb-4 space-y-2">
              <p className="text-xs font-medium text-slate-600">绑定管理</p>
              {(["novel", "chapter"] as const).map(target => {
                const bindings = target === "novel" ? novelBindings : chapterBindings;
                const label = target === "novel" ? "书级" : "章级";
                const hint = target === "chapter" && chapterBindings.length === 0 && novelBindings.length > 0
                  ? "沿用书级写法（未单独指定）" : "";
                const boundNames = new Set(bindings.map(b => b.name));
                const unbound = allProfiles.filter(p => !boundNames.has(p.name));
                return (
                  <div key={target} className="rounded border border-slate-200 p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-400">{label}绑定</span>
                      <div className="relative">
                        <button onClick={() => loadProfilesAndOpenDropdown(target)}
                          className="text-slate-700 hover:text-slate-900 text-xs">＋ 选择</button>
                        {openDropdown === target && unbound.length > 0 && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-[70] max-h-40 overflow-y-auto">
                            {unbound.map(p => (
                              <button key={p.id} onClick={() => handleBind(p.id, target)}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                                {p.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {openDropdown === target && unbound.length === 0 && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-2 px-3 z-[70]">
                            <p className="text-xs text-slate-400">暂无可选写法</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {bindings.length > 0 ? (
                      bindings.map((b, i) => (
                        <div key={i} className="flex items-center justify-between py-0.5">
                          <span className={target === "chapter" ? "text-brand-700 font-medium" : "text-slate-700"}>
                            {b.name}
                          </span>
                          <button onClick={() => target === "novel" ? handleUnbindNovel(b.name) : handleUnbindChapter(b.name)}
                            className="text-slate-400 hover:text-red-500">&times;</button>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-400 italic text-xs">{hint || (target === "novel" ? "未绑定全书法则" : "未绑定")}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Merged rules */}
            {totalRuleCount > 0 && (
              <div className="mb-4 pt-3 border-t">
                {styleCtx?.summary && (
                  <p className="text-xs text-slate-600 leading-relaxed mb-2">{styleCtx.summary}</p>
                )}
                <p className="text-xs font-medium text-slate-600 mb-2">生效规则（合并后 · {totalRuleCount}条 · 去重后）</p>
                <div className="space-y-2">
                  {FIELD_ORDER.map(field => {
                    const rules = rulesByField[field];
                    if (!rules?.length) return null;
                    return (
                      <div key={field}>
                        <p className="text-xs font-medium text-slate-500 mb-1">{field}</p>
                        <div className="space-y-0.5">
                          {rules.map((r, i) => (
                            <div key={i} className="text-xs text-slate-600 pl-3 border-l-2 border-slate-100">
                              {r}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}

// ─── Payoff sub-components ───────────────────────────

function PayoffCard({ payoff, statusMap, novelId, onUpdated }: {
  payoff: { id: string; title: string; summary?: string; scopeType?: string; currentStatus: string; firstSeenOrder?: number; targetStartOrder?: number; targetEndOrder?: number; statusReason?: string };
  statusMap: Record<string, string>; novelId: string; onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: payoff.title, summary: payoff.summary ?? "", scopeType: payoff.scopeType ?? "book", currentStatus: payoff.currentStatus, targetStartOrder: payoff.targetStartOrder ?? 0, targetEndOrder: payoff.targetEndOrder ?? 0 });

  async function handleSave() {
    try {
      await api.patch(`/novels/${novelId}/payoffs/${payoff.id}`, form);
      setEditing(false);
      onUpdated();
    } catch {}
  }

  return (
    <div className="rounded border border-slate-200 p-2 text-xs">
      {editing ? (
        <div className="space-y-1.5">
          <input className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="标题" />
          <input className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="摘要" />
          <div className="flex gap-2">
            <select className="flex-1 border border-slate-200 rounded px-1 py-0.5 text-xs" value={form.scopeType} onChange={e => setForm({ ...form, scopeType: e.target.value })}>
              <option value="book">整书级</option><option value="volume">卷级</option><option value="chapter">本章级</option>
            </select>
            <input type="number" className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" value={form.targetStartOrder || ""} onChange={e => setForm({ ...form, targetStartOrder: parseInt(e.target.value) || 0 })} placeholder="起" />
            <span className="text-slate-400 self-center">–</span>
            <input type="number" className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs" value={form.targetEndOrder || ""} onChange={e => setForm({ ...form, targetEndOrder: parseInt(e.target.value) || 0 })} placeholder="止" />
          </div>
          <div className="flex gap-1 justify-end">
            <button onClick={() => setEditing(false)} className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100">取消</button>
            <button onClick={handleSave} className="text-xs px-2 py-0.5 rounded bg-slate-900 text-white hover:bg-slate-800">保存</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className={`font-medium ${payoff.currentStatus === "overdue" ? "text-red-600" : "text-slate-700"}`}>{payoff.title}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(true)} className="text-slate-300 hover:text-slate-500 text-xs">编辑</button>
              <button onClick={async () => { try { await api.delete(`/novels/${novelId}/payoffs/${payoff.id}`); onUpdated(); } catch {} }}
                className="text-slate-300 hover:text-red-400">&times;</button>
            </div>
          </div>
          <div className="text-slate-400 mt-0.5">
            {payoff.firstSeenOrder && <span>首次出现：第{payoff.firstSeenOrder}章</span>}
            {payoff.targetStartOrder && payoff.targetEndOrder && <span> · 应在第{payoff.targetStartOrder}–{payoff.targetEndOrder}章兑现</span>}
            {payoff.statusReason && <span className="text-red-400 ml-1">· {payoff.statusReason}</span>}
          </div>
          {payoff.summary && <div className="text-slate-500 mt-0.5">{payoff.summary}</div>}
        </>
      )}
    </div>
  );
}

function AddPayoffForm({ novelId, onDone }: { novelId: string; onDone: () => void }) {
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [scopeType, setScopeType] = useState("book");
  const [targetStart, setTargetStart] = useState("");
  const [targetEnd, setTargetEnd] = useState("");

  async function handleAdd() {
    if (!title.trim()) return;
    try {
      await api.post(`/novels/${novelId}/payoffs`, { title: title.trim(), summary, scopeType, targetStartOrder: parseInt(targetStart) || undefined, targetEndOrder: parseInt(targetEnd) || undefined });
      setTitle(""); setSummary(""); setScopeType("book"); setTargetStart(""); setTargetEnd(""); setShow(false);
      onDone();
    } catch {}
  }

  return show ? (
    <div className="absolute right-5 top-12 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-[80]">
      <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold">添加伏笔</span><button onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button></div>
      <input className="w-full border border-slate-200 rounded px-2 py-1 text-xs mb-1.5" value={title} onChange={e => setTitle(e.target.value)} placeholder="伏笔标题" autoFocus />
      <input className="w-full border border-slate-200 rounded px-2 py-1 text-xs mb-1.5" value={summary} onChange={e => setSummary(e.target.value)} placeholder="摘要（可选）" />
      <div className="flex gap-2 mb-1.5">
        <select className="flex-1 border border-slate-200 rounded px-1.5 py-1 text-xs" value={scopeType} onChange={e => setScopeType(e.target.value)}>
          <option value="book">整书级</option><option value="volume">卷级</option><option value="chapter">本章级</option>
        </select>
        <input className="w-14 border border-slate-200 rounded px-1.5 py-1 text-xs" value={targetStart} onChange={e => setTargetStart(e.target.value)} placeholder="起" />
        <span className="text-slate-400 self-center text-xs">–</span>
        <input className="w-14 border border-slate-200 rounded px-1.5 py-1 text-xs" value={targetEnd} onChange={e => setTargetEnd(e.target.value)} placeholder="止" />
      </div>
      <button onClick={handleAdd} disabled={!title.trim()} className="w-full rounded bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-700 disabled:opacity-50">添加</button>
    </div>
  ) : (
    <button onClick={() => setShow(true)} className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-0.5"><Plus size={10} />添加</button>
  );
}
