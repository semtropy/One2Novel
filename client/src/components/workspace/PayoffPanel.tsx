/**
 * PayoffPanel — 伏笔管理（列表+扫描+添加）
 * Extracted from ContextPanel.tsx
 */
import { useState, useEffect } from "react";
import { Sparkles, Plus } from "lucide-react";
import { api } from "../../app/api";
import { cn } from "../../lib/cn";

export function PayoffPanel({ novelId, chapterId }: { novelId: string; chapterId: string }) {
  const [payoffs, setPayoffs] = useState<Array<{ id: string; title: string; summary?: string; scopeType?: string; currentStatus: string; firstSeenOrder?: number; targetStartOrder?: number; targetEndOrder?: number; statusReason?: string }>>([]);
  const [scanning, setScanning] = useState(false);
  const statusMap: Record<string, string> = { setup: "已埋", hinted: "暗示", pending_payoff: "待兑现", overdue: "⚠逾期", failed: "已作废", paid_off: "已兑现" };
  const STATUS_ORDER = ["overdue", "pending_payoff", "hinted", "setup"];
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", scopeType: "volume" });

  useEffect(() => {
    api.get(`/novels/${novelId}/payoffs`).then(r => setPayoffs(r.data.data ?? [])).catch(() => {});
  }, [novelId, chapterId]);

  async function handleScan() {
    if (scanning) return; setScanning(true);
    try { await api.post(`/novels/${novelId}/chapters/${chapterId}/payoffs/scan`); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
    finally { setScanning(false); }
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    try { await api.post(`/novels/${novelId}/payoffs`, form); setShowAdd(false); setForm({ title: "", summary: "", scopeType: "volume" }); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
  }

  async function handleUpdatePayoff(payoffId: string, status: string) {
    try { await api.patch(`/novels/${novelId}/payoffs/${payoffId}`, { currentStatus: status }); const r = await api.get(`/novels/${novelId}/payoffs`); setPayoffs(r.data.data ?? []); } catch {}
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{payoffs.length}条</span>
        <div className="flex gap-1.5">
          <button onClick={handleScan} disabled={scanning} className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"><Sparkles size={10} />{scanning ? "扫描中..." : "AI 扫描"}</button>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"><Plus size={10} />添加</button>
        </div>
      </div>
      {showAdd && (
        <div className="space-y-2 rounded border border-slate-200 p-3">
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="伏笔标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <input className="w-full rounded border border-slate-200 px-2 py-1 text-xs" placeholder="简要描述" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
          <select className="w-full rounded border border-slate-200 px-2 py-1 text-xs" value={form.scopeType} onChange={e => setForm({ ...form, scopeType: e.target.value })}><option value="book">全书级</option><option value="volume">卷级</option><option value="chapter">章级</option></select>
          <button onClick={handleAdd} className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">确认添加</button>
        </div>
      )}
      <div className="space-y-2">
        {STATUS_ORDER.map(status => {
          const items = payoffs.filter(p => p.currentStatus === status);
          if (!items.length) return null;
          return (
            <div key={status}>
              <p className="text-[10px] font-medium text-slate-500 mb-1">{statusMap[status]}</p>
              {items.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
                  <span className={cn("truncate flex-1", p.currentStatus === "overdue" ? "text-red-500 font-medium" : "text-slate-600")}>{p.title}</span>
                  <select className="text-[10px] border border-slate-100 rounded px-1 py-0 ml-2" value={p.currentStatus} onChange={e => handleUpdatePayoff(p.id, e.target.value)}>
                    {Object.entries(statusMap).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
        {payoffs.length === 0 && <p className="text-slate-400 italic text-center py-4">暂无伏笔，点击「AI 扫描」从正文提取</p>}
      </div>
    </div>
  );
}
