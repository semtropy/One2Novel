import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronRight, Zap, Plus, AlertCircle, X, XCircle, Undo2 } from "lucide-react";
import { useNovel, useGenerateBlueprint } from "../../api/novel";
import { api } from "../../app/api";
import { FakeProgress } from "../common/FakeProgress";
import { cn } from "../../lib/cn";

interface Props { novelId: string }

const BEAT_LABELS: Record<string, { label: string; color: string }> = {
  setup: { label: "铺垫", color: "bg-slate-100 text-slate-600" },
  progress: { label: "推进", color: "bg-blue-100 text-blue-700" },
  pressure: { label: "施压", color: "bg-red-100 text-red-700" },
  turn: { label: "转折", color: "bg-purple-100 text-purple-700" },
  payoff: { label: "兑现", color: "bg-green-100 text-green-700" },
  cooldown: { label: "冷却", color: "bg-amber-100 text-amber-700" },
};

interface BeatCard { chapter: number; beatType: string; goal: string; conflict: string; reveal: string; emotionBeat: string; }

type DraftPlanItem = { id: string; chapterOrder: number; title: string; summary: string | null };
type VolumeData = { id: string; sortOrder: number; title: string; summary: string | null; chapterPlans: Array<{ id: string; chapterId: string | null; chapterOrder: number; title: string; summary: string | null }>; draftPlans: DraftPlanItem[] };

export function BlueprintPanel({ novelId }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const gen = useGenerateBlueprint();
  const qc = useQueryClient();
  const [genError, setGenError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [beats, setBeats] = useState<Record<number, BeatCard[]>>({});
  const [beatGen, setBeatGen] = useState<Record<number, boolean>>({});
  const [beatConfirm, setBeatConfirm] = useState<number | null>(null);
  const [addingVol, setAddingVol] = useState(false);
  const [addingChapterFor, setAddingChapterFor] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // "vol-{sortOrder}" or "ch-{planId}"

  // Read from the same data source as the writing tab: novel.volumes
  const volumes: VolumeData[] = ((novel as unknown) as { volumes?: VolumeData[] } | undefined)?.volumes ?? [];
  const hasAnyVol = volumes.length > 0;

  useEffect(() => {
    if (!hasAnyVol) return;
    const load = async () => {
      for (const vol of volumes) {
        try {
          const { data } = await api.get(`/novels/${novelId}/volumes/${vol.sortOrder}/beats`);
          const plans = data.data as Array<{ chapterOrder: number; purpose?: string; conflictLevel?: number; revealLevel?: number; taskSheet?: string }>;
          if (plans.length > 0 && plans.some(p => p.purpose || p.taskSheet)) {
            const beatsForVol = plans.map(p => {
              let extra = { conflict: "", reveal: "", emotionBeat: "" };
              try { if (p.taskSheet) extra = JSON.parse(p.taskSheet); } catch {}
              return { chapter: p.chapterOrder, beatType: inferBeatType(p.conflictLevel ?? 0, p.revealLevel ?? 0), goal: p.purpose ?? "", conflict: extra.conflict, reveal: extra.reveal, emotionBeat: extra.emotionBeat };
            });
            setBeats(prev => ({ ...prev, [vol.sortOrder]: beatsForVol }));
          }
        } catch { /* no beats yet — fine */ }
      }
    };
    load();
  }, [volumes, novelId, hasAnyVol]);

  function inferBeatType(conflict: number, reveal: number): string {
    if (conflict >= 8) return "pressure"; if (reveal >= 8) return "turn"; if (reveal >= 7) return "payoff";
    if (conflict <= 3 && reveal <= 3) return "cooldown"; if (conflict <= 4) return "setup"; return "progress";
  }

  function afterEdit() {
    refetch();
    qc.invalidateQueries({ queryKey: ["confirmation-status", novelId] });
  }

  async function saveChapterField(planId: string, volSort: number, field: string, value: string) {
    try { await api.patch(`/novels/${novelId}/volumes/${volSort}/chapters/${planId}`, { [field]: value }); afterEdit(); } catch {}
  }

  async function saveVolumeField(volId: string, field: string, value: string) {
    try { await api.patch(`/novels/${novelId}/volumes/${volId}`, { [field]: value }); afterEdit(); } catch {}
  }

  async function handleBeatSheet(volSort: number) {
    setBeatGen(p => ({ ...p, [volSort]: true }));
    try { const { data } = await api.post(`/novels/${novelId}/volumes/${volSort}/beats`); setBeats(p => ({ ...p, [volSort]: data.data.beats })); afterEdit(); } catch {} finally { setBeatGen(p => ({ ...p, [volSort]: false })); }
  }

  async function handleAddVolume() {
    setAddingVol(true);
    try { await api.post(`/novels/${novelId}/volumes`); afterEdit(); } catch {} finally { setAddingVol(false); }
  }

  async function handleAddChapter(volSort: number) {
    setAddingChapterFor(volSort);
    try { await api.post(`/novels/${novelId}/volumes/${volSort}/chapters`); afterEdit(); } catch {} finally { setAddingChapterFor(null); }
  }

  async function handleDeleteVolume(sortOrder: number) {
    try { await api.delete(`/novels/${novelId}/volumes/${sortOrder}`); setDeleteConfirm(null); afterEdit(); } catch {}
  }

  async function handleDeleteChapter(volSort: number, planId: string) {
    try {
      await api.delete(`/novels/${novelId}/volumes/${volSort}/chapters/${planId}`);
      setDeleteConfirm(null); afterEdit();
    } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">章节大纲</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => { try { await api.post(`/novels/${novelId}/blueprint/restore`); refetch(); } catch {} }}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1" title="撤销为写作区当前结构">
            <Undo2 size={12} />撤销
          </button>
          <FakeProgress running={gen.isPending} />
          <button onClick={() => { setGenError(""); gen.mutate(novelId, { onError: (e) => setGenError(e instanceof Error ? e.message : "生成失败，请重试") }); }} disabled={gen.isPending}
            className={cn("rounded-lg px-3 py-1.5 text-xs", hasAnyVol ? "border border-slate-200 text-slate-600 hover:bg-slate-50" : "bg-slate-800 text-white hover:bg-slate-700")}>
            {gen.isPending ? <RefreshCw size={13} className="animate-spin" /> : "AI生成"}
          </button>
          {genError && <span className="text-xs text-red-500"><XCircle size={11} className="inline mr-1" />{genError.slice(0, 80)}</span>}
        </div>
      </div>

      {hasAnyVol ? (
        <div className="space-y-3">
          {volumes.map((vol) => {
            const volBeats = beats[vol.sortOrder];
            const plans = vol.draftPlans;
            return (
              <div key={vol.id} className="rounded-lg border border-slate-100 bg-white group/vol">
                <button onClick={() => setExpanded(p => ({ ...p, [`v${vol.sortOrder}`]: !p[`v${vol.sortOrder}`] }))}
                  className="flex w-full items-center gap-2 p-3 text-left hover:bg-slate-50 rounded-t-lg">
                  {expanded[`v${vol.sortOrder}`] ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                  <span className="text-sm font-medium text-slate-700">第{vol.sortOrder}卷</span>
                  <span className="text-sm text-slate-700">{vol.title}</span>
                  <span className="text-xs text-slate-400">{plans.length}章</span>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(`vol-${vol.sortOrder}`); }}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 opacity-0 group-hover/vol:opacity-100 transition-opacity mr-1">
                    <X size={11} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleAddChapter(vol.sortOrder); }}
                    disabled={addingChapterFor === vol.sortOrder}
                    className="ml-auto rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-100 flex items-center gap-1 opacity-0 group-hover/vol:opacity-100 transition-opacity mr-1">
                    <Plus size={11} />章
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setBeatConfirm(vol.sortOrder); }}
                    disabled={beatGen[vol.sortOrder]}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:bg-purple-50 hover:text-purple-600 flex items-center gap-1 opacity-0 group-hover/vol:opacity-100 transition-opacity">
                    <Zap size={11} />{beatGen[vol.sortOrder] ? "..." : "节奏板"}
                  </button>
                </button>
                {expanded[`v${vol.sortOrder}`] && (
                  <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-2">
                    <EditableText
                      value={vol.summary ?? ""}
                      placeholder="卷概要"
                      onSave={v => saveVolumeField(vol.sortOrder.toString(), "summary", v)}
                      className="text-xs text-slate-500 w-full bg-slate-50 rounded p-1.5"
                    />
                    {plans.map((ch) => {
                      const chBeat = volBeats?.find(b => b.chapter === ch.chapterOrder);
                      return (
                        <div key={ch.id} className="flex items-start gap-2 py-1 border-b border-slate-50 last:border-0 group/ch">
                          <span className="shrink-0 w-5 text-center text-xs text-slate-400 pt-1">{ch.chapterOrder}</span>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <EditableText
                              value={ch.title}
                              placeholder="章节标题"
                              onSave={v => saveChapterField(ch.id, vol.sortOrder, "title", v)}
                              className="text-sm text-slate-800 font-medium w-full bg-transparent hover:bg-slate-50 rounded px-1 py-0.5"
                            />
                            <div className="flex items-start gap-1">
                              <EditableText
                                value={ch.summary ?? ""}
                                placeholder="核心事件或摘要"
                                onSave={v => saveChapterField(ch.id, vol.sortOrder, "summary", v)}
                                className="text-xs text-slate-500 flex-1 w-full bg-transparent hover:bg-slate-50 rounded px-1 py-0.5"
                              />
                              <button onClick={() => setDeleteConfirm(`ch-${ch.id}`)}
                                className="shrink-0 text-slate-300 hover:text-red-500 opacity-0 group-hover/ch:opacity-100 transition-opacity pt-0.5">
                                <X size={11} />
                              </button>
                            </div>
                            {chBeat && (
                              <div className="flex items-center gap-1.5">
                                <span className={cn("shrink-0 rounded px-1 py-0 text-xs font-medium", BEAT_LABELS[chBeat.beatType]?.color ?? "bg-slate-100 text-slate-500")}>
                                  {BEAT_LABELS[chBeat.beatType]?.label ?? chBeat.beatType}
                                </span>
                                <span className="text-xs text-slate-500 truncate">{chBeat.goal}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={handleAddVolume} disabled={addingVol}
            className="w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-2 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-500">
            <Plus size={12} />{addingVol ? "创建中..." : "添加卷"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-8 text-center space-y-3">
          <AlertCircle size={32} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-500">尚无章节大纲</p>
          <p className="text-xs text-slate-400">AI 生成自动规划卷和章节，或手动创建卷后逐章添加</p>
          <button onClick={handleAddVolume} disabled={addingVol}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-600 hover:bg-white transition-colors">
            {addingVol ? "创建中..." : "手动创建第一个卷"}
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteConfirm(null)}>
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-2">
              {deleteConfirm.startsWith("vol-") ? "删除卷" : "删除章节"}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {deleteConfirm.startsWith("vol-")
                ? "将删除该卷及其所有章节，此操作不可撤销。"
                : "将删除该章节，此操作不可撤销。"}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={() => {
                const key = deleteConfirm;
                if (key.startsWith("vol-")) handleDeleteVolume(parseInt(key.replace("vol-", "")));
                else {
                  // Find which volume this chapter belongs to
                  const planId = key.replace("ch-", "");
                  const vol = volumes.find(v => v.draftPlans?.some(p => p.id === planId));
                  if (vol) handleDeleteChapter(vol.sortOrder, planId);
                }
              }} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">删除</button>
            </div>
          </div>
        </div>
      )}

      {beatConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setBeatConfirm(null)}>
          <div className="w-96 rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-slate-800">节奏板</h3><button onClick={() => setBeatConfirm(null)} className="text-slate-400 hover:text-slate-600">&times;</button></div>
            <p className="text-xs text-slate-600 mb-3">为每章标注节奏类型，帮助控制全卷叙事节奏波浪。</p>
            <div className="flex gap-2">
              <button onClick={() => setBeatConfirm(null)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={() => { handleBeatSheet(beatConfirm); setBeatConfirm(null); }} className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700">确认生成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditableText({ value, placeholder, onSave, className }: {
  value: string; placeholder: string; onSave: (v: string) => void; className: string;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  if (!editing && local !== value) setLocal(value);
  return editing ? (
    <input autoFocus className={className + " border border-slate-300 outline-none"}
      value={local} onChange={e => setLocal(e.target.value)}
      onBlur={() => { setEditing(false); if (local !== value) onSave(local); }}
      onKeyDown={e => { if (e.key === "Enter") { setEditing(false); if (local !== value) onSave(local); } if (e.key === "Escape") { setEditing(false); setLocal(value); } }}
      placeholder={placeholder} />
  ) : (
    <div className={className} onClick={() => setEditing(true)}>
      {value || <span className="text-slate-400 italic">{placeholder}</span>}
    </div>
  );
}
