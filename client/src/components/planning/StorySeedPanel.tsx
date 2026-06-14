import { RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovel, useGenerateStoryCore, useUpdateNovel } from "../../api/novel";
import { api } from "../../app/api";
import { FakeProgress } from "../common/FakeProgress";

interface Props { novelId: string }

export function StorySeedPanel({ novelId }: Props) {
  const { data: novel, refetch } = useNovel(novelId);
  const gen = useGenerateStoryCore();
  const update = useUpdateNovel();
  const qc = useQueryClient();
  const [genError, setGenError] = useState("");

  // Parse story core from DraftStorySeed (single source of truth for planning)
  const draftSeedContent = novel?.draftStorySeed?.content;
  const seed = parseSeed(draftSeedContent);
  const draftSeedSynced = novel?.draftStorySeed?.synced ?? true;

  // Editable story core fields
  const storyFields = [
    { key: "premise", label: "前提", value: (seed?.premise as string) ?? "", rows: 2 },
    { key: "mainArc", label: "主线", value: (seed?.mainArc as string) ?? "", rows: 2 },
    { key: "mysteryBox", label: "核心悬念", value: (seed?.mysteryBox as string) ?? "", rows: 2 },
    { key: "endingDirection", label: "结局方向", value: (seed?.endingDirection as string) ?? "", rows: 2 },
  ];

  const saveStoryField = async (field: string, value: string) => {
    const current = parseSeed(draftSeedContent);
    current[field] = value;
    try {
      await api.put(`/novels/${novelId}/draft-story-seed`, { content: JSON.stringify(current) });
      refetch();
      qc.invalidateQueries({ queryKey: ["confirmation-status", novelId] });
    } catch {}
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">全书定位</h3>
        </div>
        <div className="flex items-center gap-2">
          <FakeProgress running={gen.isPending} />
          <button onClick={() => { setGenError(""); gen.mutate(novelId, { onError: (e) => setGenError(e instanceof Error ? e.message : "生成失败，请重试") }); }} disabled={gen.isPending}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
            {gen.isPending ? <RefreshCw size={12} className="animate-spin" /> : "AI生成"}
          </button>
        </div>
      </div>
      {genError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2 flex items-center gap-2 text-xs text-red-600">
          <XCircle size={12} />{genError}
        </div>
      )}

      {/* Creative params */}
      <div className="grid grid-cols-4 gap-2">
        <SelectField label="题材" value={novel?.genre ?? ""} onChange={(v) => update.mutate({ id: novelId, genre: v })} options={["","悬疑","言情","奇幻","科幻","历史","都市","武侠","恐怖","其他"]} />
        <SelectField label="视角" value={novel?.narrativePov ?? ""} onChange={(v) => update.mutate({ id: novelId, narrativePov: v })} options={["","first_person","third_person","mixed"]} labels={["未设置","第一人称","第三人称","混合"]} />
        <SelectField label="节奏" value={novel?.pacePreference ?? ""} onChange={(v) => update.mutate({ id: novelId, pacePreference: v })} options={["","slow","balanced","fast"]} labels={["未设置","舒缓","均衡","快节奏"]} />
        <SelectField label="情感" value={novel?.emotionIntensity ?? ""} onChange={(v) => update.mutate({ id: novelId, emotionIntensity: v })} options={["","low","medium","high"]} labels={["未设置","克制","适中","强烈"]} />
      </div>

      {/* Story Core — always visible */}
      <div className="space-y-2 rounded-lg border border-slate-100 bg-white p-3">
        {storyFields.map(({ key, label, value, rows }) => (
            <EditableField key={key} fieldKey={key} label={label} value={value} rows={rows}
              onSave={(v) => saveStoryField(key, v)}
            />
          ))}
        </div>

    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function parseSeed(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function SelectField({ label, value, onChange, options, labels }: { label: string; value: string; onChange: (v: string) => void; options: string[]; labels?: string[] }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-2">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent text-xs text-slate-700 focus:outline-none">
        {options.map((o, i) => <option key={o} value={o}>{labels ? labels[i] : o || "未设置"}</option>)}
      </select>
    </div>
  );
}

function EditableField({ fieldKey, label, value, rows = 1, onSave }: {
  fieldKey: string; label: string; value: string; rows?: number; onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div className="rounded-lg border border-transparent hover:border-slate-100 p-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {rows > 1 ? (
        <textarea
          className="w-full mt-1 rounded border border-slate-100 bg-slate-50 p-2 text-sm resize-none focus:border-slate-300 focus:bg-white focus:outline-none"
          rows={rows}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => { if (!local) setLocal(""); }}
          onBlur={() => { if (local !== value) onSave(local); }}
          placeholder="未设置"
        />
      ) : (
        <input
          className="w-full mt-1 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm focus:border-slate-300 focus:bg-white focus:outline-none"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => { if (!local) setLocal(""); }}
          onBlur={() => { if (local !== value) onSave(local); }}
          placeholder="未设置"
        />
      )}
    </div>
  );
}

