import { Users, History, ClipboardList, X, AlertTriangle, RefreshCw, Search } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { useNovel, useTimelineReminders, useResources } from "../../api/novel";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../app/api";
import { SEVERITY_LABEL } from "@one2novel/shared";
import { OPERATION_LABELS, type WorkspaceDiagnosis } from "../../api/revision";
import { cn } from "../../lib/cn";

interface Props {
  novelId: string; chapterId: string | null;
  chapterTitle?: string; chapterOrder?: number;
  quality: Record<string, unknown> | null;
  diagnosis: WorkspaceDiagnosis | null;
  reviewing: boolean;
}

export function ContextPanel({ novelId, chapterId, chapterOrder, quality, diagnosis, reviewing }: Props) {
  const { data: novel, refetch: refetchNovel } = useNovel(novelId);
  const qc = useQueryClient();
  const [showDetail, setShowDetail] = useState(false);
  const chars: Array<{ id: string; name: string; role?: string; currentGoal?: string; currentLocation?: string; currentStatus?: string; voiceTexture?: string; identityLabel?: string; factionLabel?: string }> = ((novel as unknown) as { characters?: Array<{ id: string; name: string; role?: string; currentGoal?: string; currentLocation?: string; currentStatus?: string; voiceTexture?: string; identityLabel?: string; factionLabel?: string }> }).characters ?? [];
  const [showCharDetail, setShowCharDetail] = useState(false);
  const { data: resources } = useResources(showCharDetail ? novelId : undefined);
  const activeChars = chars.filter(c => c.currentGoal || c.currentLocation || c.currentStatus);
  const ROLE_LABEL: Record<string, string> = { protagonist: "主角", antagonist: "对手", supporting: "配角", minor: "次要" };
  const timelines: Array<{ title: string; category: string; sortOrder: number; status?: string }> =
    ((novel as unknown) as { timelineItems?: Array<{ title: string; category: string; sortOrder: number; status?: string }> }).timelineItems ?? [];
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflicts, setConflicts] = useState<Array<{ type: string; description: string; severity: string }>>([]);
  const [reExtracting, setReExtracting] = useState(false);

  // Clear per-chapter state on switch
  useEffect(() => { setConflicts([]); }, [chapterId]);

  // Check if current chapter has content (for re-extract button availability)
  const currentChapter = chapterId
    ? ((novel as unknown) as { chapters?: Array<{ id: string; content?: string }> })?.chapters?.find(c => c.id === chapterId)
    : null;
  const hasContent = !!(currentChapter?.content && currentChapter.content.length > 100);

  const handleReExtract = useCallback(async () => {
    if (!chapterId || reExtracting) return;
    setReExtracting(true);
    try {
      await api.post(`/novels/${novelId}/chapters/${chapterId}/timeline/re-extract`);
      await refetchNovel();
      qc.invalidateQueries({ queryKey: ["timeline-reminders", novelId, chapterOrder] });
    } catch { /* toast could go here */ }
    finally { setReExtracting(false); }
  }, [novelId, chapterId, chapterOrder, reExtracting, refetchNovel, qc]);

  // Phase 16: pre-chapter timeline reminders (auto-loaded on chapter select)
  const { data: remindersResult } = useTimelineReminders(novelId, chapterOrder);

  // Extract quality scores — prefer fresh prop, fallback to DB
  const chapterFromNovel = chapterId
    ? ((novel as unknown) as { chapters?: Array<Record<string, unknown>> } | undefined)?.chapters?.find(c => (c as Record<string, unknown>).id === chapterId)
    : null;

  const scores = (() => {
    // Prefer fresh review result from parent state
    if (quality) {
      return {
        openingScore: quality.openingScore as number ?? 0,
        plotScore: quality.plotScore as number ?? 0,
        characterScore: quality.characterScore as number ?? 0,
        dialogueScore: quality.dialogueScore as number ?? 0,
        suspenseScore: quality.suspenseScore as number ?? 0,
        pacingScore: quality.pacingScore as number ?? 0,
        showNotTellScore: quality.showNotTellScore as number ?? 0,
        languageScore: quality.languageScore as number ?? 0,
        genreScore: quality.genreScore as number ?? 0,
        overallComment: quality.overallComment as string ?? "",
        issues: (quality.issues as Array<{ type: string; severity: string; description: string; fixSuggestion: string }> | undefined) ?? [],
      };
    }
    // Fallback: reconstruct from DB-stored chapter data
    if (chapterFromNovel && (chapterFromNovel.qualityScore as number) > 0) {
      let issues: Array<{ type: string; severity: string; description: string; fixSuggestion: string }> = [];
      let comment = "";
      try {
        const h = JSON.parse((chapterFromNovel.repairHistory as string) ?? "{}");
        comment = (h.overallComment as string) ?? "";
        issues = (h.issues as Array<{ type: string; severity: string; description: string; fixSuggestion: string }>) ?? [];
      } catch { /* ignore */ }
      return {
        openingScore: (chapterFromNovel.openingScore as number) ?? 0,
        plotScore: (chapterFromNovel.plotScore as number) ?? 0,
        characterScore: (chapterFromNovel.characterScore as number) ?? 0,
        dialogueScore: (chapterFromNovel.dialogueScore as number) ?? 0,
        suspenseScore: (chapterFromNovel.suspenseScore as number) ?? 0,
        pacingScore: (chapterFromNovel.pacingScore as number) ?? 0,
        showNotTellScore: (chapterFromNovel.showNotTellScore as number) ?? 0,
        languageScore: (chapterFromNovel.languageScore as number) ?? 0,
        genreScore: (chapterFromNovel.genreScore as number) ?? 0,
        overallComment: comment,
        issues,
      };
    }
    return null;
  })();

  const totalScore = scores
    ? scores.openingScore + scores.plotScore + scores.characterScore + scores.dialogueScore
      + scores.suspenseScore + scores.pacingScore + scores.showNotTellScore + scores.languageScore + scores.genreScore
    : 0;

  // diagnosis: prefer fresh prop, fallback to DB
  const displayDiagnosis: WorkspaceDiagnosis | null = diagnosis ?? (() => {
    if (!chapterFromNovel?.diagnosis) return null;
    try { return JSON.parse(chapterFromNovel.diagnosis as string) as WorkspaceDiagnosis; }
    catch { return null; }
  })();

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Character Dynamics */}
      <div className="p-3 border-b border-slate-100">
        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Users size={13} />角色动态</h4>
        {activeChars.length > 0 ? (
          <div>
            <div className="space-y-1 mb-1.5">
              {activeChars.slice(0, 4).map((c, i) => (
                <div key={i} className="text-slate-600 text-xs">
                  <div className="font-medium text-slate-700 truncate">{c.name}{c.role ? ` · ${ROLE_LABEL[c.role] ?? c.role}` : ""}</div>
                  {c.currentGoal && <div className="text-slate-500 truncate ml-1">目标 {c.currentGoal}</div>}
                </div>
              ))}
            </div>
            <button onClick={() => setShowCharDetail(true)} className="w-full text-xs text-indigo-500 hover:text-indigo-700 text-left mt-1">
              查看详情
            </button>
          </div>
        ) : <p className="text-slate-400 italic text-xs">写完后自动更新</p>}
      </div>

      {/* Timeline */}
      <div className="p-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-slate-700 flex items-center gap-1.5"><History size={13} />时间线</h4>
          <div className="flex items-center gap-1">
            {hasContent && (
              <button
                onClick={handleReExtract}
                disabled={reExtracting}
                className="text-xs text-slate-400 hover:text-blue-500 disabled:opacity-50 flex items-center gap-0.5"
                title="从本章正文重新提取时间线事件"
              >
                <RefreshCw size={10} className={reExtracting ? "animate-spin" : ""} />
                {reExtracting ? "提取中..." : "重提"}
              </button>
            )}
            {timelines.length > 1 && (
              <button
                onClick={async () => {
                  setCheckingConflicts(true);
                  try {
                    const r = await api.get(`/novels/${novelId}/timeline/conflicts`);
                    setConflicts(r.data.data ?? []);
                  } catch { setConflicts([]); }
                  finally { setCheckingConflicts(false); }
                }}
                disabled={checkingConflicts}
                className="text-xs text-slate-400 hover:text-amber-500 disabled:opacity-50 flex items-center gap-0.5"
                title="检查时间线冲突"
              ><Search size={10} />{checkingConflicts ? "检查中..." : "检查"}</button>
            )}
          </div>
        </div>

        {/* Color legend */}
        {timelines.length > 0 && (
          <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />事件</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-purple-400" />里程碑</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />截止日</span>
            <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />约束</span>
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="mb-2 rounded bg-amber-50 p-1.5 text-[10px] text-amber-700 space-y-0.5">
            {conflicts.slice(0, 3).map((c, i) => (
              <div key={i} className="flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pre-chapter reminders */}
        {remindersResult && remindersResult.reminders.length > 0 && (
          <div className="mb-2 rounded bg-blue-50 p-1.5 text-[10px]">
            <p className="font-medium text-blue-700 mb-1">写前提醒</p>
            {remindersResult.summary && (
              <p className="text-blue-600 mb-1">{remindersResult.summary}</p>
            )}
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {remindersResult.reminders.map((r, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-1",
                  r.isOverdue ? "text-red-600 font-medium" : r.isUpcoming ? "text-blue-600" : "text-blue-500",
                )}>
                  <span className="shrink-0">
                    {r.isOverdue ? "⚠" : r.isUpcoming ? "🔔" : r.status === "violated" ? "❌" : "•"}
                  </span>
                  <span className="truncate">{r.title}</span>
                  <span className="shrink-0 text-[9px] opacity-60">第{r.sortOrder}章</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {timelines.length > 0 ? (
          <div className="space-y-1">
            {timelines.slice(-8).reverse().map((t, i) => (
              <div key={i} className="text-slate-600 flex items-center gap-1.5">
                <span className={cn(
                  "shrink-0 w-1.5 h-1.5 rounded-full",
                  t.status === "violated" ? "bg-red-500"
                  : t.category === "milestone" ? "bg-purple-400"
                  : t.category === "deadline" ? "bg-red-400"
                  : t.category === "constraint" ? "bg-amber-400"
                  : "bg-blue-400"
                )} />
                <span className={cn("truncate", t.status === "violated" && "text-red-500 font-medium")}>{t.title}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-slate-400 italic text-xs">写完章节后自动提取</p>}
      </div>

      {/* Review Detail */}
      <div className="p-3">
        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><ClipboardList size={13} />审查详情</h4>
        {reviewing ? (
          <div className="flex items-center gap-1.5 text-xs text-blue-500">
            <RefreshCw size={12} className="animate-spin" />
            AI 审查中...
          </div>
        ) : scores ? (
          <div>
            <div className="text-xs text-slate-600 mb-1.5">
              总分 <span className="font-bold text-slate-800">{totalScore}</span>/90
              {scores.issues.length > 0 && <span className="text-slate-400 ml-1">· {scores.issues.length}个问题</span>}
            </div>
            <button
              onClick={() => setShowDetail(true)}
              className="w-full text-xs text-indigo-500 hover:text-indigo-700 text-left"
            >
              查看详情
            </button>
          </div>
        ) : (
          <p className="text-slate-400 italic text-xs">点击工具栏「审查」进行评估</p>
        )}
      </div>

      {/* Detail Popup */}
      {showDetail && scores && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDetail(false)}>
          <div className="w-[44rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">审查详情</h3>
              <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-2 gap-5">
              {/* Left: Scores + Issues */}
              <div className="space-y-3">
                <p className="text-xs text-slate-500">总分 <span className="font-bold text-slate-800">{totalScore}</span> / 90</p>
                <div className="space-y-0.5">
                  {[["开头吸引力", scores.openingScore], ["情节推进", scores.plotScore], ["人物塑造", scores.characterScore], ["对话质量", scores.dialogueScore], ["悬念设置", scores.suspenseScore], ["节奏控制", scores.pacingScore], ["展示而非讲述", scores.showNotTellScore], ["语言质量", scores.languageScore], ["题材适应度", scores.genreScore]].map(([l, s]) => (
                    <div key={l as string} className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 w-[4.5rem] shrink-0 text-right">{l as string}</span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", (s as number) >= 7 ? "bg-green-400" : (s as number) >= 5 ? "bg-amber-400" : "bg-red-400")} style={{ width: `${(s as number) * 10}%` }} />
                      </div>
                      <span className="text-xs font-medium w-3 text-right">{s as number}</span>
                    </div>
                  ))}
                </div>

                {scores.overallComment && (
                  <p className="text-xs text-slate-600 leading-relaxed">{scores.overallComment}</p>
                )}

                <div className="pt-3 border-t">
                  <p className="text-xs font-medium text-slate-700 mb-1.5">
                    整体问题
                    <span className="text-slate-400 ml-1 font-normal">({scores.issues.length}条)</span>
                  </p>
                  {scores.issues.length > 0 ? (
                    <div className="space-y-1">
                      {scores.issues.map((iss, i) => (
                        <div key={i} className="rounded border border-amber-100 bg-amber-50/50 p-1.5 text-xs">
                          <span className={cn("px-1 py-0.5 rounded mr-1", iss.severity === "high" ? "bg-red-100 text-red-700" : iss.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600")}>{SEVERITY_LABEL[iss.severity] ?? iss.severity}</span>
                          <span className="text-amber-800">{iss.description}</span>
                          <div className="text-amber-600 mt-0.5 text-[10px] italic">{iss.fixSuggestion}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">✓ 无明显问题</p>
                  )}
                </div>
              </div>

              {/* Right: 段落细查 */}
              <div className="border-l border-slate-100 pl-5">
                <p className="text-xs font-medium text-slate-700 mb-2">段落细查</p>
                {displayDiagnosis ? (
                  <div className="space-y-1.5">
                    {displayDiagnosis.recommendedTask && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                        <span className="font-medium text-amber-800">优先修复</span>
                        <div className="text-amber-700 mt-0.5">{displayDiagnosis.recommendedTask.title}</div>
                        <div className="text-amber-600 mt-0.5">{displayDiagnosis.recommendedTask.summary}</div>
                      </div>
                    )}
                    {displayDiagnosis.cards.length > 0 ? (
                      displayDiagnosis.cards.map((card, i) => (
                        <div key={i} className={`p-2 rounded border text-xs ${card.severity === "critical" ? "border-red-300 bg-red-50" : card.severity === "high" ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
                          <div className="flex items-center gap-1 mb-1">
                            <span className={`px-1 py-0 rounded text-[10px] font-medium ${card.severity === "critical" ? "bg-red-200 text-red-800" : card.severity === "high" ? "bg-orange-200 text-orange-800" : card.severity === "medium" ? "bg-amber-200 text-amber-800" : "bg-slate-200 text-slate-600"}`}>{SEVERITY_LABEL[card.severity] ?? card.severity}</span>
                            <span className="font-semibold truncate">{card.title}</span>
                          </div>
                          <div className="text-slate-500 mb-1 leading-relaxed">{card.problemSummary}</div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {card.paragraphStart && <span className="text-slate-400 text-[10px]">第{card.paragraphStart}{card.paragraphEnd && card.paragraphEnd !== card.paragraphStart ? `–${card.paragraphEnd}` : ""}段</span>}
                            <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0 rounded text-[10px]">{OPERATION_LABELS[card.recommendedAction]?.label ?? card.recommendedAction}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-green-600 py-1">✓ 未发现明显问题</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">点击工具栏「审查」以生成</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Character Detail Popup */}
      {showCharDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCharDetail(false)}>
          <div className="w-[28rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">角色动态</h3>
              <button onClick={() => setShowCharDetail(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              {activeChars.map((c, i) => (
                <div key={i}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-semibold text-sm text-slate-800">{c.name}</span>
                    {c.role && <span className="text-xs text-slate-500">{ROLE_LABEL[c.role] ?? c.role}</span>}
                  </div>
                  {(c.identityLabel || c.factionLabel) && (
                    <div className="text-xs text-slate-400 mb-1">
                      {[c.identityLabel, c.factionLabel].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="space-y-1 text-xs">
                    {c.currentLocation && (
                      <div className="flex items-center gap-2"><span className="text-slate-400 shrink-0 w-8 text-right">位置</span><span className="text-slate-600">{c.currentLocation}</span></div>
                    )}
                    {c.currentGoal && (
                      <div className="flex items-center gap-2"><span className="text-slate-400 shrink-0 w-8 text-right">目标</span><span className="text-slate-600">{c.currentGoal}</span></div>
                    )}
                    {c.currentStatus && (
                      <div className="flex items-center gap-2"><span className="text-slate-400 shrink-0 w-8 text-right">状态</span><span className="text-slate-600">{c.currentStatus}</span></div>
                    )}
                    {c.voiceTexture && (
                      <div className="flex items-center gap-2"><span className="text-slate-400 shrink-0 w-8 text-right">声线</span><span className="text-slate-600 italic">{c.voiceTexture}</span></div>
                    )}
                    <div className="flex items-start gap-2">
                      <span className="text-slate-400 shrink-0 w-8 text-right">资源</span>
                      <div>
                        {(() => {
                          const charResources = (resources ?? []).filter(r => r.ownerId === c.id);
                          if (!charResources.length) return <span className="text-slate-300 italic">暂无</span>;
                          return charResources.map(r => (
                            <div key={r.id} className="text-slate-500">
                              <span className={r.status === "depleted" ? "text-slate-300 line-through" : "text-slate-600"}>{r.name}</span>
                              <span className="text-slate-400 ml-1">{r.category}</span>
                              {r.acquiredIn && <span className="text-slate-300 ml-1">第{r.acquiredIn}章</span>}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                  {i < activeChars.length - 1 && <div className="border-b border-slate-100 mt-3" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
