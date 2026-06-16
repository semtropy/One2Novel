import { useState, useEffect } from "react";
import { api } from "../app/api";
import { CheckCircle, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import type { ProviderInfo } from "../components/settings/ProviderConfigDialog";
const SELECT_STYLE = "rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:ring-1 focus:ring-brand-200 focus:outline-none bg-white";

export const MODEL_OPTIONS = [
  { provider: "deepseek", label: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { provider: "openai", label: "OpenAI", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"] },
  { provider: "anthropic", label: "Anthropic Claude", models: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"] },
  { provider: "gemini", label: "Google Gemini", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
  { provider: "qwen", label: "通义千问", models: ["qwen-plus", "qwen-max"] },
  { provider: "moonshot", label: "月之暗面 Moonshot", models: ["moonshot-v1-8k", "moonshot-v1-32k"] },
];

export function SettingsPage() {
  const [prefs, setPrefs] = useState<Record<string, unknown>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; provider: string; model: string; error?: string } | null>(null);
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("providerKeys") ?? "{}"); } catch { return {}; }
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testingProviders, setTestingProviders] = useState<Record<string, boolean>>({});
  const [testPassed, setTestPassed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem("providerKeys", JSON.stringify(editingKeys));
  }, [editingKeys]);

  async function saveProviderConfig(p: string, keyVal?: string, modelVal?: string) {
    const body: Record<string, string> = {};
    if (keyVal?.trim()) body.key = keyVal.trim();
    if (modelVal?.trim()) body.model = modelVal.trim();
    if (!Object.keys(body).length) return;
    await api.post(`/settings/providers/${p}`, body).catch(() => {});
  }

  async function testProvider(p: string, keyVal: string, modelVal: string) {
    setTestingProviders(prev => ({ ...prev, [p]: true })); setTestResult(null);
    try {
      if (keyVal.trim()) await api.post(`/settings/providers/${p}`, { key: keyVal.trim(), model: modelVal });
      const r = await api.post(`/settings/providers/${p}/test`);
      setTestResult(r.data.data);
      setTestPassed(prev => ({ ...prev, [p]: !!(r.data.data?.ok) }));
    } catch (e) {
      setTestResult({ ok: false, provider: p, model: modelVal, error: e instanceof Error ? e.message : "测试失败" });
    } finally { setTestingProviders(prev => ({ ...prev, [p]: false })); }
  }

  useEffect(() => {
    api.get("/preferences").then(r => setPrefs(r.data.data?.preferences ?? {})).catch(() => {});
    loadProviders();
    // Auto-push stored keys to server on mount (survive desktop app restarts)
    for (const [provider, keyVal] of Object.entries(editingKeys)) {
      if (keyVal?.trim()) {
        saveProviderConfig(provider, keyVal);
      }
    }
  }, []);

  async function loadProviders() {
    try { const r = await api.get("/settings/providers"); setProviders(r.data.data ?? []); } catch {}
  }

  async function savePref(key: string, value: unknown) {
    await api.post("/preferences", { [key]: value }).catch(() => {});
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-3xl mx-auto">
      <h2 className="mb-6 text-lg font-semibold text-slate-900">设置</h2>
      <div className="space-y-5">

        {/* ════════════════ 模型 ════════════════ */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">模型配置</h3>

          {/* Default model */}
          <div className="mb-4">
            <div className="text-xs text-slate-500 font-medium mb-1.5">默认模型</div>
            <select
              value={(prefs.defaultProvider as string) ?? "deepseek:deepseek-chat"}
              onChange={e => { const v = e.target.value; setPrefs(p => ({ ...p, defaultProvider: v })); savePref("defaultProvider", v); }}
              className={SELECT_STYLE + " w-full h-10"}
            >
              {MODEL_OPTIONS.filter(g => providers.some(p => p.provider === g.provider && p.isConfigured)).map(g => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map(m => (
                    <option key={`${g.provider}:${m}`} value={`${g.provider}:${m}`}>{m}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {testResult && (
            <div className={"mb-4 flex items-start gap-2 rounded-lg p-3 text-sm " + (testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
              {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
              <div>
                <p className="font-medium">{testResult.ok ? `已连接 ${testResult.provider}（${testResult.model}）` : "连接失败"}</p>
                {testResult.error && <p className="text-xs mt-1 opacity-80">{testResult.error}</p>}
              </div>
            </div>
          )}

          {/* All providers */}
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
              <span className="w-24 shrink-0">厂商</span>
              <span className="flex-1">模型</span>
              <span className="flex-1">API Key</span>
              <span className="w-20 text-center">连接</span>
            </div>
            {MODEL_OPTIONS.map(g => {
              const configured = providers.find(p => p.provider === g.provider);
              const isConfig = !!(configured?.isConfigured);
              const testing = testingProviders[g.provider];
              const keyVal = editingKeys[g.provider] ?? "";
              return (
                <div key={g.provider}
                  className={`flex items-center gap-3 px-4 py-2 border-b border-slate-50 last:border-b-0 ${
                    testPassed[g.provider] ? "border-l-[3px] border-l-emerald-400 bg-white" : "border-l-[3px] border-l-slate-200 bg-white"
                  }`}
                >
                  <span className="w-24 shrink-0 text-sm font-medium text-slate-700">{g.label}</span>
                  {/* Model dropdown */}
                  <select
                    value={configured?.currentModel || configured?.defaultModel || g.models[0]}
                    onChange={e => { saveProviderConfig(g.provider, undefined, e.target.value); loadProviders(); }}
                    className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs focus:border-brand-300 focus:outline-none bg-white"
                  >
                    {g.models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {/* Key input */}
                  <div className="flex-1 relative">
                    <input
                      type={showKeys[g.provider] ? "text" : "password"}
                      value={keyVal}
                      onChange={e => setEditingKeys(prev => ({ ...prev, [g.provider]: e.target.value }))}
                      onBlur={() => { if (keyVal.trim()) { saveProviderConfig(g.provider, keyVal); loadProviders(); } }}
                      className="w-full rounded border border-slate-200 px-2 py-1 pr-8 text-xs focus:border-brand-300 focus:outline-none [&::-ms-reveal]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
                    />
                    <button onClick={() => setShowKeys(prev => ({ ...prev, [g.provider]: !prev[g.provider] }))}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                      {showKeys[g.provider] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  {/* Test button */}
                  <span className="w-20 text-center">
                    <button onClick={() => testProvider(g.provider, keyVal, configured?.currentModel || configured?.defaultModel || g.models[0])} disabled={testing}
                      className="text-xs rounded-lg border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                      {testing ? <Loader2 size={11} className="animate-spin inline" /> : "测试"}
                    </button>
                  </span>
                </div>
              );
            })}
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none"
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <div className="text-xs text-slate-500 font-medium mb-1.5">偏好题材</div>
                <input
                  value={(prefs.favoriteGenres as string[] ?? []).join("、")}
                  onChange={e => { const g = e.target.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean); setPrefs(p => ({ ...p, favoriteGenres: g })); }}
                  onBlur={() => savePref("favoriteGenres", prefs.favoriteGenres)}
                  placeholder="如：悬疑、科幻、言情"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium mb-1.5">目标总章数</div>
              <input type="number" min={50} max={1000}
                value={(prefs.estimatedChapterCount as number) ?? 333}
                onChange={e => { const v = parseInt(e.target.value) || 333; setPrefs(p => ({ ...p, estimatedChapterCount: v })); }}
                onBlur={() => savePref("estimatedChapterCount", prefs.estimatedChapterCount)}
                className="w-1/3 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">长篇网文建议 100-500 章，回环骨架根据此数值自动计算回环数量</p>
            </div>
          </div>
        </section>

      </div>
    </div>

    </div>
  );
}
