import { useEffect, useState, useCallback } from "react";
import { api } from "../../app/api";
import { Lightbulb, Target, Clock, Plus, X, Eye } from "lucide-react";
import { cn } from "../../lib/cn";
import SceneCardPanel from "./SceneCardPanel";

interface Props { novelId: string; chapterId: string | null }

interface StyleSource {
  name: string;
  targetType: string;
  ruleCount: number;
}

interface ResolvedStyle {
  styleBlock: string;
  rules: string[];
  sources: StyleSource[];
  primaryProfileName: string | null;
  bindings: Array<{ id: string; name: string; targetType: string; priority: number }>;
}

export function BottomPanel({ novelId, chapterId }: Props) {
  const [payoffs, setPayoffs] = useState<Array<{ id: string; title: string; currentStatus: string; firstSeenOrder?: number; targetEndOrder?: number; statusReason?: string }>>([]);
  const [styleCtx, setStyleCtx] = useState<ResolvedStyle | null>(null);
  const [allProfiles, setAllProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showCompiled, setShowCompiled] = useState(false);
  const [showAddPayoff, setShowAddPayoff] = useState(false);
  const [newPayoffTitle, setNewPayoffTitle] = useState("");
  const [addingPayoff, setAddingPayoff] = useState(false);

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

  async function openStylePicker() {
    try {
      const r = await api.get("/styles");
      setAllProfiles(r.data.data ?? []);
      setShowStylePicker(true);
    } catch {}
  }

  async function handleBindChapter(profileId: string) {
    if (!chapterId) return;
    try {
      await api.post(`/styles/${profileId}/bind`, { targetType: "chapter", targetId: chapterId });
      setShowStylePicker(false);
      loadStyles();
    } catch {}
  }

  async function handleUnbindChapter(bindingName: string) {
    if (!chapterId || !styleCtx) return;
    try {
      const r = await api.get(`/styles/bindings/chapter/${chapterId}`);
      const chapterBindings = (r.data.data ?? []) as Array<{ id: string; styleProfile?: { name: string } }>;
      const target = chapterBindings.find(b => b.styleProfile?.name === bindingName);
      if (target) {
        await api.delete(`/styles/${bindingName}/bind/${target.id}`);
        loadStyles();
      }
    } catch {}
  }

  const chapterSources = styleCtx?.sources?.filter(s => s.targetType === "chapter") ?? [];
  const novelSources = styleCtx?.sources?.filter(s => s.targetType === "novel") ?? [];
  const activePayoffs = payoffs.filter(p => p.currentStatus !== "paid_off");
  const statusMap: Record<string, string> = { setup: "已埋", hinted: "暗示", pending_payoff: "待兑现", overdue: "⚠逾期", failed: "已作废" };

  async function handleAddPayoff() {
    if (!newPayoffTitle.trim()) return;
    setAddingPayoff(true);
    try {
      await api.post(`/novels/${novelId}/payoffs`, { title: newPayoffTitle.trim(), scopeType: "book" });
      setNewPayoffTitle("");
      setShowAddPayoff(false);
      const r = await api.get(`/novels/${novelId}/payoffs`);
      setPayoffs(r.data.data ?? []);
    } catch {} finally { setAddingPayoff(false); }
  }

  if (!chapterId) return null;

  return (
    <div className="flex gap-3 text-xs h-full">
      {/* Style Constraints — with book-level + chapter-level sub-sections */}
      <div className="flex-1 border-r border-slate-100 pr-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="font-semibold text-slate-700 flex items-center gap-1"><Clock size={12} />写法约束</h4>
          {styleCtx?.styleBlock && styleCtx.rules.length > 0 && (
            <button onClick={() => setShowCompiled(true)} className="text-slate-400 hover:text-slate-600" title="查看编译块">
              <Eye size={11} />
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {/* ── 书级绑定 ── */}
          <div>
            <p className="text-slate-400 font-medium mb-0.5">▸ 书级绑定</p>
            {novelSources.length > 0 ? (
              novelSources.map((s, i) => (
                <div key={`nv-${i}`} className="flex items-center rounded bg-slate-50 px-1.5 py-0.5 mb-0.5">
                  <span className="text-slate-600">{s.name}</span>
                  <span className="ml-auto text-slate-400">{s.ruleCount}条</span>
                </div>
              ))
            ) : (
              <p className="text-slate-400 italic text-xs pl-1">
                前往规划页 →「选择写法」绑定全书法则
              </p>
            )}
          </div>

          {/* ── 章级绑定 ── */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-slate-400 font-medium">▸ 章级绑定</p>
              <button onClick={openStylePicker} className="text-purple-500 hover:text-purple-700 flex items-center gap-0.5 text-xs"><Plus size={10} /></button>
            </div>
            {chapterSources.length > 0 ? (
              chapterSources.map((s, i) => (
                <div key={`ch-${i}`} className="flex items-center justify-between rounded bg-purple-50 px-1.5 py-0.5 mb-0.5">
                  <span className="text-purple-700 font-medium">{s.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-purple-500 text-xs">{s.ruleCount}条</span>
                    <button onClick={() => handleUnbindChapter(s.name)} className="text-purple-400 hover:text-red-500" title="解绑">&times;</button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 italic text-xs pl-1">
                {novelSources.length > 0 ? "沿用书级写法（未单独指定）" : "点击 ＋ 为本章绑定写法"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Payoffs */}
      <div className="flex-1 border-r border-slate-100 pr-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="font-semibold text-slate-700 flex items-center gap-1"><Lightbulb size={12} />伏笔</h4>
          <button onClick={() => setShowAddPayoff(!showAddPayoff)} className="text-slate-400 hover:text-indigo-500" title="手动添加伏笔">
            <Plus size={12} />
          </button>
        </div>
        {showAddPayoff && (
          <div className="mb-1.5 flex gap-1">
            <input
              autoFocus
              className="flex-1 border border-slate-200 rounded px-1.5 py-0.5 text-xs outline-none focus:border-indigo-300"
              value={newPayoffTitle}
              onChange={e => setNewPayoffTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAddPayoff(); }}
              placeholder="伏笔标题"
            />
            <button
              onClick={handleAddPayoff}
              disabled={addingPayoff || !newPayoffTitle.trim()}
              className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
            >{addingPayoff ? "..." : "添加"}</button>
          </div>
        )}
        {activePayoffs.length > 0 ? (
          <div className="space-y-0.5">
            {activePayoffs.slice(0, 8).map(p => (
              <div key={p.id} className={cn("text-xs truncate", p.currentStatus === "overdue" ? "text-red-500 font-medium" : "text-slate-500")}>
                <span className="mr-1">{statusMap[p.currentStatus] ?? p.currentStatus}</span>
                {p.title}
                {p.currentStatus === "overdue" && p.statusReason && (
                  <span className="text-red-400 ml-1">({p.statusReason})</span>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-slate-400 italic text-xs">暂无</p>}
      </div>

      {/* Scene Cards */}
      <SceneCardPanel novelId={novelId} chapterId={chapterId ?? undefined} />

      {/* Compiled style block preview */}
      {showCompiled && styleCtx?.styleBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCompiled(false)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">写法编译块预览</h3>
              <button onClick={() => setShowCompiled(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">以下内容将在生成章节时注入 AI 系统指令</p>
            <pre className="whitespace-pre-wrap text-xs text-slate-700 bg-slate-50 rounded-lg p-3 max-h-[60vh] overflow-y-auto leading-relaxed font-sans">{styleCtx.styleBlock}</pre>
          </div>
        </div>
      )}

      {/* Style picker modal for chapter-level binding */}
      {showStylePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowStylePicker(false)}>
          <div className="w-72 rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">绑定写法到本章</h3>
            <p className="text-xs text-slate-400 mb-3">章级规则覆盖书级同名规则，仅本章生效</p>
            {allProfiles.length === 0 ? (
              <p className="text-xs text-slate-500 mb-3">暂无写法配置。请先在侧栏「写法引擎」中创建。</p>
            ) : (
              <div className="space-y-1 mb-3">
                {allProfiles.map(p => {
                  const isChBound = chapterSources.some(s => s.name === p.name);
                  const isNvBound = novelSources.some(s => s.name === p.name);
                  return (
                    <button key={p.id} disabled={isChBound}
                      onClick={() => handleBindChapter(p.id)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2 text-left text-sm flex items-center justify-between",
                        isChBound ? "bg-purple-50 text-purple-400 cursor-not-allowed"
                        : "text-slate-700 hover:bg-slate-50 border border-slate-100"
                      )}>
                      <span>{p.name}</span>
                      {isChBound && <span className="text-xs text-purple-400">本章已绑定</span>}
                      {!isChBound && isNvBound && <span className="text-xs text-slate-400">已绑定全书</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <button onClick={() => setShowStylePicker(false)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
