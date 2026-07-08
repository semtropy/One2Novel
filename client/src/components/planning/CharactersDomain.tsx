/**
 * CharactersDomain — 角色阵容决策域
 * 角色卡片网格 · AI生成 · 回环功能标签 · 关系网络图 · 关系演化轨迹
 */
import { useState } from "react";
import { Sparkles, RefreshCw, GitBranch, X, Save, Plus } from "lucide-react";
import { NovelCharacterCreateSchema } from "@one2novel/shared/types/novel";
import { useNovel } from "../../api/novel";
import { useDraftRelationshipGraph, useUpsertDraftRelation } from "../../api/characters";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";
import { RelationshipNetwork } from "../pipeline/RelationshipNetwork";

interface Props { novelId: string; onComplete?: () => void }

const ROLE_OPTIONS: Record<string, string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
  minor: "次要角色",
};

const LOOP_FUNCTION_TAGS = [
  { value: "", label: "未设置" },
  { value: "副本触发器", label: "副本触发器 — 发布任务/制造麻烦" },
  { value: "奖励来源", label: "奖励来源 — 提供技能/装备/信息" },
  { value: "伏笔载体", label: "伏笔载体 — 知晓秘密/背负预言" },
  { value: "长期威胁", label: "长期威胁 — 阶段性反派/最终敌人" },
  { value: "情感锚点", label: "情感锚点 — 羁绊/伴侣/需要保护的对象" },
];

const RELATION_STAGES = ["strangers", "acquainted", "allied", "conflicted", "estranged", "reconciled"] as const;
const STAGE_LABELS: Record<string, string> = {
  strangers: "陌生人", acquainted: "相识", allied: "盟友", conflicted: "冲突", estranged: "疏远", reconciled: "和解",
};


export function CharactersDomain({ novelId, onComplete }: Props) {
  const { data: novel, refetch: refetchNovel } = useNovel(novelId);
  const { data: relGraph, refetch: refetchRel } = useDraftRelationshipGraph(novelId);
  const upsertRel = useUpsertDraftRelation();

  const [updatingTag, setUpdatingTag] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editCharId, setEditCharId] = useState<string | null>(null);
  const [editCharFields, setEditCharFields] = useState<Record<string, string>>({});

  const characters = novel?.characters ?? [];
  const volumes = novel?.volumes ?? [];
  const relations = relGraph?.edges ?? [];

  const [addCharOpen, setAddCharOpen] = useState(false);
  const [addCharName, setAddCharName] = useState("");
  const [addCharRole, setAddCharRole] = useState("supporting");

  const handleDeleteChar = async (charId: string, name: string) => {
    if (!window.confirm(`删除角色「${name}」？此操作不可撤销。`)) return;
    try { await api.delete(`/novels/${novelId}/characters/${charId}`); refetchNovel(); refetchRel(); } catch {}
  };

  const handleAddChar = async () => {
    const result = NovelCharacterCreateSchema.safeParse({ name: addCharName.trim(), role: addCharRole });
    if (!result.success) return; // Silently reject invalid input (field-level validation in JSX)
    try {
      await api.post(`/novels/${novelId}/characters`, result.data);
      refetchNovel();
      setAddCharName("");
      setAddCharRole("supporting");
      setAddCharOpen(false);
    } catch {}
  };

  const handleTagChange = async (charId: string, tag: string) => {
    setUpdatingTag(charId);
    try { await api.patch(`/novels/${novelId}/characters/${charId}`, { loopFunctionTag: tag }); refetchNovel(); }
    catch {} finally { setUpdatingTag(null); }
  };

  const [genError, setGenError] = useState("");
  const [genSuccess, setGenSuccess] = useState(false);

  const handleGenerateCharacters = async () => {
    if (characters.length > 0 && !window.confirm("重新生成将覆盖当前所有角色和关系，是否继续？")) return;
    setGenerating(true); setGenError(""); setGenSuccess(false);
    try {
      // Force regeneration via direct endpoint (pipeline step skips if chars exist)
      await api.post(`/novels/${novelId}/characters/generate`);
      await refetchNovel(); refetchRel();
      setGenSuccess(true);
      setTimeout(() => setGenSuccess(false), 3000);
      onComplete?.();
    } catch (e) { setGenError(e instanceof Error ? e.message : "生成失败，请重试"); }
    finally { setGenerating(false); }
  };

  const handleSaveCharField = async (charId: string) => {
    if (Object.keys(editCharFields).length === 0) { setEditCharId(null); return; }
    try {
      await api.patch(`/novels/${novelId}/characters/${charId}`, editCharFields);
      refetchNovel();
    } catch {}
    setEditCharId(null);
    setEditCharFields({});
  };

  const startEditChar = (char: typeof characters[0]) => {
    setEditCharId(char.id);
    setEditCharFields({
      personality: char.personality ?? "",
      coreMotivation: char.coreMotivation ?? "",
      background: char.background ?? "",
      appearance: char.appearance ?? "",
      voiceTexture: char.voiceTexture ?? "",
      quirks: char.quirks ?? "",
      factionLabel: char.factionLabel ?? "",
      flaw: char.prohibitions ?? "",
      characterArc: (char as any).characterArc ?? "",
    });
  };

  return (
    <div className="space-y-5">
      {characters.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-10 text-center">
          <p className="text-sm text-slate-500">暂无角色</p>
          {genError && <p className="text-xs text-red-500 mt-2">{genError}</p>}
          <button onClick={handleGenerateCharacters} disabled={generating}
            className={cn("mt-3 rounded-lg px-4 py-2 text-xs font-medium text-white disabled:opacity-50",
              genSuccess ? "bg-green-600" : "bg-slate-800 hover:bg-slate-700")}>
            {generating ? <RefreshCw size={13} className="animate-spin inline mr-1" /> : <Sparkles size={13} className="inline mr-1" />}
            {generating ? "生成中（约30秒）…" : genSuccess ? "生成完成 ✓" : "AI 生成角色"}
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-700">角色阵容 ({characters.length}人)</h3>
              <button onClick={handleGenerateCharacters} disabled={generating}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50",
                  genSuccess ? "bg-green-600 border-green-600 text-white" : "bg-slate-800 border-slate-800 text-white hover:bg-slate-700",
                )}>
                <RefreshCw size={12} className={generating ? "animate-spin" : ""} /> {generating ? "生成中（约30秒）…" : genSuccess ? "生成完成 ✓" : "重新生成全部"}
              </button>
              {genError && <p className="text-xs text-red-500 mt-1">{genError}</p>}
              <button onClick={() => setAddCharOpen(!addCharOpen)}
                className="flex items-center gap-1 rounded-lg border bg-slate-800 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-700 rounded-lg">
                <Plus size={12} /> 手动添加
              </button>
            </div>

            {addCharOpen && (
              <div className="mb-3 flex items-end gap-2 rounded-lg border border-brand-200 bg-brand-50/30 p-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">角色姓名</label>
                  <input autoFocus className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-300 focus:outline-none"
                    value={addCharName} onChange={e => setAddCharName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddChar(); if (e.key === "Escape") setAddCharOpen(false); }}
                    placeholder="2-3字中文名" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">角色定位</label>
                  <select className="rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-300 focus:outline-none"
                    value={addCharRole} onChange={e => setAddCharRole(e.target.value)}>
                    {Object.entries(ROLE_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <button onClick={handleAddChar} disabled={!addCharName.trim()}
                  className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  添加
                </button>
                <button onClick={() => setAddCharOpen(false)}
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-700">
                  取消
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {characters.map(char => (
                <div key={char.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-800 truncate">{char.name}</span>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0 text-xs font-medium",
                          char.role === "protagonist" ? "bg-blue-100 text-blue-700" :
                          char.role === "antagonist" ? "bg-red-100 text-red-700" :
                          char.role === "supporting" ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-400")}>
                          {char.role === "protagonist" ? "主角" : char.role === "antagonist" ? "反派" : char.role === "supporting" ? "配角" : "次要"}
                        </span>
                      </div>

                      {editCharId === char.id ? (
                        <div className="space-y-1.5 mt-2">
                          {[
                            {k:"personality",l:"性格"},
                            {k:"coreMotivation",l:"核心动机"},
                            {k:"background",l:"背景"},
                            {k:"appearance",l:"外貌"},
                            {k:"voiceTexture",l:"语气"},
                            {k:"quirks",l:"习惯动作"},
                            {k:"factionLabel",l:"所属阵营"},
                            {k:"flaw",l:"致命缺陷"},
                            {k:"characterArc",l:"成长弧线"},
                          ].map(({k,l}) => (
                            <div key={k}>
                              <label className="text-[10px] text-slate-400">{l}</label>
                              <input className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:border-brand-300 focus:outline-none"
                                value={editCharFields[k] ?? ""} onChange={e => setEditCharFields(prev => ({ ...prev, [k]: e.target.value }))} />
                            </div>
                          ))}
                          <div className="flex gap-1 pt-1">
                            <button onClick={() => handleSaveCharField(char.id)} className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-700"><Save size={10} />保存</button>
                            <button onClick={() => { setEditCharId(null); setEditCharFields({}); }} className="rounded px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"><X size={10} /></button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 mb-1 line-clamp-2">
                            {char.personality && <>性格：{char.personality}</>}
                            {char.identityLabel && <> · {char.identityLabel}</>}
                            {char.factionLabel && <> · {char.factionLabel}</>}
                          </p>
                          {char.coreMotivation && <p className="text-xs text-brand-700 mb-0.5 font-medium">动机：{char.coreMotivation}</p>}
                          {char.background && <p className="text-xs text-slate-400 mb-0.5 truncate">背景：{char.background}</p>}
                          {char.prohibitions && <p className="text-xs text-amber-600 mb-0.5">缺陷：{char.prohibitions}</p>}
                          {char.currentStatus && <p className="text-[10px] text-slate-400 mb-0.5">状态：{char.currentStatus}</p>}
                          <div className="mt-2 flex items-center justify-between">
                            <select value={char.loopFunctionTag ?? ""} onChange={e => handleTagChange(char.id, e.target.value)} disabled={updatingTag === char.id}
                              className="rounded border border-slate-200 px-2 py-0.5 text-xs focus:border-brand-300 focus:outline-none max-w-[160px]">
                              {LOOP_FUNCTION_TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            <button onClick={() => startEditChar(char)} className="text-[10px] text-slate-400 hover:text-brand-600">详情</button>
                            <button onClick={() => handleDeleteChar(char.id, char.name)} className="text-[10px] text-slate-300 hover:text-red-500 ml-1">删除</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Relationship Network Graph (primary relationship view) */}
          {characters.length > 0 && relations.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={14} className="text-brand-500" />
                <h3 className="text-sm font-medium text-slate-700">角色关系网络</h3>
              </div>
              <RelationshipNetwork
                characters={characters.map(c => ({ id: c.id, name: c.name, role: c.role as CharNode["role"], loopFunctionTag: c.loopFunctionTag }))}
                relations={relations.map(r => ({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, stage: r.stage ?? null as unknown as string }))}
                onEditRelation={(rel) => {
                  const REL_TYPE_OPTIONS = ["friend", "enemy", "lover", "rival", "mentor", "family"];
                  const REL_TYPE_LABELS: Record<string, string> = {
                    friend: "朋友", enemy: "敌人", lover: "恋人", rival: "竞争者", mentor: "导师", family: "家人",
                  };
                  const newType = window.prompt(
                    `编辑关系类型：\n${REL_TYPE_OPTIONS.map(t => `  ${t} = ${REL_TYPE_LABELS[t]}`).join("\n")}`,
                    rel.type
                  );
                  if (newType && REL_TYPE_OPTIONS.includes(newType) && newType !== rel.type) {
                    upsertRel.mutateAsync({ novelId, sourceCharacterId: rel.sourceId, targetCharacterId: rel.targetId, type: newType }).then(() => refetchRel());
                  }
                }}
              />
            </section>
          )}

          {/* Relationship Evolution Trajectory */}
          {relations.length > 0 && volumes.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">关系演化轨迹</h3>
              <p className="text-xs text-slate-400 mb-3">指定每条角色关系在各卷中的演化阶段。</p>
              <div className="overflow-x-auto">
                <div className="min-w-max">
                  <div className="flex items-center mb-2">
                    <span className="w-24 shrink-0 text-[10px] font-medium text-slate-400 px-2">关系</span>
                    {volumes.slice(0, 8).map(vol => <span key={vol.sortOrder} className="w-16 text-center text-[10px] text-slate-400 shrink-0">第{vol.sortOrder}卷</span>)}
                  </div>
                  {relations.slice(0, 6).map(rel => {
                    const source = relGraph?.nodes.find(n => n.id === rel.sourceId);
                    const target = relGraph?.nodes.find(n => n.id === rel.targetId);
                    return (
                      <div key={rel.id} className="flex items-center py-1 border-t border-slate-50">
                        <span className="w-24 shrink-0 text-[10px] text-slate-600 px-2 truncate">{source?.name ?? "?"}↔{target?.name ?? "?"}</span>
                        {volumes.slice(0, 8).map(vol => (
                          <select key={vol.sortOrder} className="w-16 shrink-0 mx-0.5 rounded border border-slate-100 text-[10px] text-slate-500 focus:border-brand-300 focus:outline-none py-0.5 text-center"
                            value={rel.stage ?? "strangers"}
                            onChange={async (e) => {
                              try {
                                await upsertRel.mutateAsync({ novelId, sourceCharacterId: rel.sourceId, targetCharacterId: rel.targetId, type: rel.type, stage: e.target.value });
                                refetchRel();
                              } catch {}
                            }}>
                            {RELATION_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                          </select>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Type helper for RelationshipNetwork props
type CharNode = { id: string; name: string; role: string; loopFunctionTag?: string | null };
