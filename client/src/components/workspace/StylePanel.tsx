/**
 * StylePanel — 写法配置（风格绑定管理）
 * Extracted from ContextPanel.tsx
 */
import { useState, useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../app/api";

interface ResolvedStyle {
  styleBlock: string; antiAiPrompt: string; rules: string[];
  primaryProfileName: string | null; summary: string;
  bindings: Array<{ id: string; name: string; targetType: string; priority: number }>;
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

export function StylePanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
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
