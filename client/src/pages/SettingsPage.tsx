import { useState, useEffect } from "react";
import { api } from "../app/api";
import { CheckCircle, XCircle, Loader2, Wrench, Zap } from "lucide-react";
import { ProviderConfigDialog, type ProviderInfo } from "../components/settings/ProviderConfigDialog";

const SELECT_STYLE = "rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 focus:outline-none bg-white";

export function SettingsPage() {
  const [prefs, setPrefs] = useState<Record<string, unknown>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; provider: string; model: string; error?: string } | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProviderInfo | null>(null);

  useEffect(() => {
    api.get("/preferences").then(r => setPrefs(r.data.data?.preferences ?? {})).catch(() => {});
    loadProviders();
  }, []);

  async function loadProviders() {
    try { const r = await api.get("/settings/providers"); setProviders(r.data.data ?? []); } catch {}
  }

  async function savePref(key: string, value: unknown) {
    await api.post("/preferences", { [key]: value }).catch(() => {});
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    try { const res = await api.get("/llm/probe"); setTestResult(res.data.data); } catch (e) {
      setTestResult({ ok: false, provider: "", model: "", error: e instanceof Error ? e.message : "失败" });
    } finally { setTesting(false); }
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-3xl">
      <h2 className="mb-6 text-lg font-semibold text-slate-900">设置</h2>
      <div className="space-y-5">

        {/* ════════════════ 模型配置 ════════════════ */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Zap size={15} className="text-amber-500" />默认模型 · 连接测试
          </h3>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <div className="text-xs text-slate-500 font-medium mb-1.5">默认模型</div>
              <select
                value={(prefs.defaultProvider as string) ?? "deepseek"}
                onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, defaultProvider: v })); savePref("defaultProvider", v); }}
                className={SELECT_STYLE + " w-full h-10"}
              >
                <option value="deepseek">DeepSeek (deepseek-chat)</option>
                <option value="openai">OpenAI (gpt-5-mini)</option>
                <option value="anthropic">Anthropic Claude (claude-sonnet-4-6)</option>
              </select>
            </div>
            <div className="flex-1">
              <div className="text-xs text-slate-500 font-medium mb-1.5">连接测试</div>
              <button onClick={testConnection} disabled={testing}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 w-full justify-center h-10">
                {testing && <Loader2 size={14} className="animate-spin" />}测试连接
              </button>
            </div>
          </div>
          {testResult && (
            <div className={"mt-4 flex items-start gap-2 rounded-lg p-3 text-sm " + (testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
              {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
              <div>
                <p className="font-medium">{testResult.ok ? `已连接 ${testResult.provider}（${testResult.model}）` : "连接失败"}</p>
                {testResult.error && <p className="text-xs mt-1 opacity-80">{testResult.error}</p>}
              </div>
            </div>
          )}
        </section>

        {/* ════════════════ 模型厂商 ════════════════ */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
            <Wrench size={15} className="text-slate-500" />模型厂商
          </h3>
          <p className="text-xs text-slate-400 mb-4">管理各厂商的 API Key 和模型。点击厂商名即可配置。</p>

          <div className="overflow-hidden rounded-lg border border-slate-100">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
              <span className="w-28 shrink-0">厂商</span>
              <span className="flex-1">模型</span>
              <span className="w-16 text-center">状态</span>
              <span className="w-24 text-center">Key</span>
              <span className="w-20 text-center">操作</span>
            </div>
            {/* Rows */}
            {providers.map(p => (
              <div key={p.provider}
                className={`flex items-center gap-4 px-4 py-3 border-b border-slate-50 last:border-b-0 transition-colors ${
                  p.isConfigured ? "border-l-[3px] border-l-emerald-400 bg-white" : "border-l-[3px] border-l-slate-200 bg-white"
                }`}
              >
                {/* Name */}
                <button
                  onClick={() => setEditingProvider(p)}
                  className="w-28 shrink-0 text-sm font-medium text-slate-700 hover:text-indigo-600 text-left transition-colors"
                >{p.name}</button>
                {/* Model */}
                <span className="flex-1 text-sm text-slate-500">
                  {(p.currentModel || p.defaultModel) ? (p.currentModel || p.defaultModel) : "-"}
                </span>
                {/* Status */}
                <span className="w-16 text-center">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    p.isConfigured ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.isConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
                    {p.isConfigured ? "已配置" : "未配置"}
                  </span>
                </span>
                {/* Key */}
                <span className="w-24 text-center text-xs text-slate-400 font-mono">
                  {p.maskedKey || "-"}
                </span>
                {/* Action */}
                <span className="w-20 text-center">
                  <button
                    onClick={() => setEditingProvider(p)}
                    className="text-xs rounded-lg border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                  >配置</button>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ════════════════ 创作偏好 ════════════════ */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">创作偏好</h3>
          <p className="text-xs text-slate-400 mb-5">创建新小说时的默认值，可在小说设置中随时修改。</p>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">写作视角</div>
                <select
                  value={(prefs.preferredPerspective as string) ?? "third_person"}
                  onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, preferredPerspective: v })); savePref("preferredPerspective", v); }}
                  className={SELECT_STYLE + " w-full"}
                >
                  <option value="third_person">第三人称</option>
                  <option value="first_person">第一人称</option>
                  <option value="mixed">混合视角</option>
                </select>
              </div>
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">叙事节奏</div>
                <select
                  value={(prefs.preferredPace as string) ?? "balanced"}
                  onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, preferredPace: v })); savePref("preferredPace", v); }}
                  className={SELECT_STYLE + " w-full"}
                >
                  <option value="slow">慢节奏 · 细腻铺垫</option>
                  <option value="balanced">均衡 · 张弛有度</option>
                  <option value="fast">快节奏 · 强冲突推进</option>
                </select>
              </div>
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">默认章节字数</div>
                <input type="number" min={500} max={50000} step={500}
                  value={(prefs.defaultChapterLength as number) ?? 3000}
                  onChange={e => { setPrefs(p => ({ ...p, defaultChapterLength: parseInt(e.target.value) || 3000 })); }}
                  onBlur={() => savePref("defaultChapterLength", prefs.defaultChapterLength)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">风格基调</div>
                <input
                  value={(prefs.preferredTone as string) ?? ""}
                  onChange={e => setPrefs(p => ({ ...p, preferredTone: e.target.value }))}
                  onBlur={() => savePref("preferredTone", prefs.preferredTone)}
                  placeholder="如：紧张刺激、轻松幽默"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">偏好题材</div>
                <input
                  value={(prefs.favoriteGenres as string[] ?? []).join("、")}
                  onChange={e => { const g = e.target.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean); setPrefs(p => ({ ...p, favoriteGenres: g })); }}
                  onBlur={() => savePref("favoriteGenres", prefs.favoriteGenres)}
                  placeholder="如：悬疑、科幻、言情"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                />
              </div>
            </div>
            <div className="w-1/3">
              <div className="text-xs text-slate-500 font-medium mb-1.5">默认目标章数</div>
              <input type="number" min={1} max={1000}
                value={(prefs.typicalChapterCount as number | null) ?? ""}
                onChange={e => { const v = e.target.value ? parseInt(e.target.value) || null : null; setPrefs(p => ({ ...p, typicalChapterCount: v })); }}
                onBlur={() => savePref("typicalChapterCount", prefs.typicalChapterCount)}
                placeholder="不预设"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">留空则不预设总章数</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    {/* Provider Config Dialog */}
    {editingProvider && (
      <ProviderConfigDialog
        provider={editingProvider}
        onClose={() => setEditingProvider(null)}
        onSaved={() => { setEditingProvider(null); loadProviders(); }}
      />
    )}
    </div>
  );
}
