import { useState, useEffect } from "react";
import { X, Loader2, Save, Eye, EyeOff } from "lucide-react";
import { api } from "../../app/api";
import { MODEL_OPTIONS } from "../../pages/SettingsPage";

export interface ProviderInfo {
  provider: string;
  name: string;
  defaultModel: string;
  currentModel: string;
  maskedKey: string;
  isConfigured: boolean;
}

interface Props {
  provider: ProviderInfo;
  onClose: () => void;
  onSaved: () => void;
}

export function ProviderConfigDialog({ provider, onClose, onSaved }: Props) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(provider.currentModel || provider.defaultModel);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);

  useEffect(() => {
    setModel(provider.currentModel || provider.defaultModel);
  }, [provider]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.post(`/settings/providers/${provider.provider}`, { key: key.trim() || undefined, model: model.trim() || undefined });
      onSaved();
    } catch {} finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      // Save first if key changed
      if (key.trim()) await api.post(`/settings/providers/${provider.provider}`, { key: key.trim(), model });
      const r = await api.post(`/settings/providers/${provider.provider}/test`);
      setTestResult(r.data.data);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "测试失败" });
    } finally { setTesting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">配置 {provider.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          {/* API Key */}
          <div>
            <div className="text-xs text-slate-500 font-medium mb-1.5">API Key</div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder={provider.maskedKey ? `当前: ${provider.maskedKey}` : "输入 API Key"}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm focus:border-brand-300 focus:outline-none"
              />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">留空则不修改已保存的 Key</p>
          </div>

          {/* Model */}
          <div>
            <div className="text-xs text-slate-500 font-medium mb-1.5">模型</div>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none bg-white h-10">
              {(MODEL_OPTIONS.find(g => g.provider === provider.provider)?.models ?? [provider.defaultModel]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`mt-4 rounded-lg p-3 text-xs ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testResult.ok
              ? `✅ 连接成功 (${testResult.latencyMs}ms)`
              : `❌ ${testResult.error}`}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-5">
          <button onClick={handleTest} disabled={testing}
            className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}测试连接
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存
          </button>
        </div>
      </div>
    </div>
  );
}
