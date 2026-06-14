import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Target, Zap, Bookmark, Flag, Tag, RefreshCw } from "lucide-react";
import { WorldPanel } from "./WorldPanel";
import { useNovel, useUpdateNovel, useGenerateFraming } from "../../api/novel";

interface Props { novelId: string }

export function AdvancedSettings({ novelId }: Props) {
  const [open, setOpen] = useState(false);
  const { data: novel, refetch } = useNovel(novelId);
  const update = useUpdateNovel();
  const genFraming = useGenerateFraming();
  const [genError, setGenError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  async function saveField(key: string, value: string) {
    try { await update.mutateAsync({ id: novelId, [key]: value }); refetch(); } catch {}
    setEditing(null);
  }

  const tags: string[] = (() => {
    const raw = novel?.commercialTags;
    if (!raw) return [];
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch { return raw.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean); }
  })();

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left py-1">
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <span className="text-sm font-semibold text-slate-500">高级设置</span>
      </button>
      {open && (
        <div className="mt-3 space-y-6 pl-6">
          {/* Editorial / Market Framing */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-800">编辑向信息</h4>
              <button onClick={() => { setGenError(""); genFraming.mutate(novelId, { onError: (e) => setGenError(e instanceof Error ? e.message : "生成失败，请重试") }); }} disabled={genFraming.isPending}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1">
                {genFraming.isPending ? <RefreshCw size={11} className="animate-spin" /> : "AI生成"}
              </button>
              {genError && <span className="text-xs text-red-500 ml-2">{genError.slice(0, 80)}</span>}
            </div>
            <div className="space-y-2">
              <TextField icon={Target} label="目标读者" value={novel?.targetAudience ?? ""} editing={editing} editVal={editVal}
                onEdit={() => { setEditing("targetAudience"); setEditVal(novel?.targetAudience ?? ""); }}
                onSave={(v) => saveField("targetAudience", v)} onCancel={() => setEditing(null)} onChange={setEditVal}
                placeholder="谁会看这本书？" />
              <TextField icon={Zap} label="核心卖点" value={novel?.bookSellingPoint ?? ""} editing={editing} editVal={editVal}
                onEdit={() => { setEditing("bookSellingPoint"); setEditVal(novel?.bookSellingPoint ?? ""); }}
                onSave={(v) => saveField("bookSellingPoint", v)} onCancel={() => setEditing(null)} onChange={setEditVal}
                placeholder="读者为什么要点进来、追读？" rows={2} />
              <TextField icon={Bookmark} label="差异化感受" value={novel?.competingFeel ?? ""} editing={editing} editVal={editVal}
                onEdit={() => { setEditing("competingFeel"); setEditVal(novel?.competingFeel ?? ""); }}
                onSave={(v) => saveField("competingFeel", v)} onCancel={() => setEditing(null)} onChange={setEditVal}
                placeholder="和同类书有什么不同的体验？" rows={2} />
              <TextField icon={Flag} label="前30章承诺" value={novel?.first30ChapterPromise ?? ""} editing={editing} editVal={editVal}
                onEdit={() => { setEditing("first30ChapterPromise"); setEditVal(novel?.first30ChapterPromise ?? ""); }}
                onSave={(v) => saveField("first30ChapterPromise", v)} onCancel={() => setEditing(null)} onChange={setEditVal}
                placeholder="读完前30章能得到什么？" rows={2} />
              <div className="rounded-lg border border-slate-100 p-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5"><Tag size={14} className="text-slate-400" /><span className="text-xs font-medium text-slate-500">商业标签</span></div>
                  {editing === "commercialTags" ? (
                    <div className="flex gap-1">
                      <button onClick={() => saveField("commercialTags", JSON.stringify(editVal.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)))} className="rounded-md border border-green-300 bg-green-50 px-2 py-0.5 text-xs text-green-700">保存</button>
                      <button onClick={() => setEditing(null)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditing("commercialTags"); setEditVal(tags.join("，")); }} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-100"><Pencil size={11} /></button>
                  )}
                </div>
                {editing === "commercialTags" ? (
                  <input autoFocus className="w-full rounded border border-slate-200 px-2 py-1 text-sm" value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveField("commercialTags", JSON.stringify(editVal.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean))); if (e.key === "Escape") setEditing(null); }} />
                ) : tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">{tags.map((t, i) => (<span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>))}</div>
                ) : (
                  <p className="text-xs text-slate-400">AI生成后自动填充</p>
                )}
              </div>
            </div>
          </section>
          <section><WorldPanel novelId={novelId} /></section>
        </div>
      )}
    </div>
  );
}

function TextField({ icon: Icon, label, value, editing, editVal, onEdit, onSave, onCancel, onChange, placeholder, rows = 1 }: {
  icon: typeof Target; label: string; value: string; editing: string | null; editVal: string;
  onEdit: () => void; onSave: (v: string) => void; onCancel: () => void; onChange: (v: string) => void;
  placeholder: string; rows?: number;
}) {
  const isEditing = editing === label;
  return isEditing ? (
    <div className="rounded-lg border border-slate-300 bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5"><Icon size={14} className="text-slate-400" /><span className="text-xs font-medium text-slate-500">{label}</span></div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onSave(editVal)} className="rounded-md border border-green-300 bg-green-50 px-2 py-0.5 text-xs text-green-700 hover:bg-green-100">保存</button>
          <button onClick={onCancel} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">取消</button>
        </div>
      </div>
      <textarea autoFocus className="w-full rounded border border-slate-200 p-2 text-sm resize-none focus:border-slate-400 focus:outline-none" rows={rows} value={editVal} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
    </div>
  ) : (
    <div className="rounded-lg border border-slate-100 bg-white p-3 group cursor-pointer hover:border-slate-200" onClick={onEdit}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5"><Icon size={14} className="text-slate-400" /><span className="text-xs font-medium text-slate-500">{label}</span></div>
        <button className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1" onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={11} />编辑</button>
      </div>
      {value ? <p className="text-sm text-slate-700 whitespace-pre-wrap">{value}</p> : <p className="text-sm text-slate-400 italic">{placeholder}</p>}
    </div>
  );
}
