import { useState, useRef, useEffect } from "react";
import { api } from "../app/api";
import { Send, Sparkles, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: Array<{ type: string; label: string; args?: Record<string, string> }>;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "你好！我是创作助手。告诉我你想写什么类型的小说，或者有什么创作问题？\n\n你可以说：\n· 帮我创建一本悬疑小说\n· 生成这个故事的大纲\n· 查看当前进度" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [novelId, setNovelId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput(""); setLoading(true);

    try {
      const { data } = await api.post("/chat", { message: input, novelId });
      const reply: Message = { role: "assistant", content: data.data.response, actions: data.data.actions };
      setMessages(prev => [...prev, reply]);
      if (data.data.novelId) setNovelId(data.data.novelId);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "抱歉，出错了，请重试。" }]);
    } finally { setLoading(false); }
  }

  async function handleAction(action: { type: string; label: string; args?: Record<string, string> }) {
    setLoading(true);
    try {
      const { data } = await api.post("/chat/action", { action, novelId });
      setMessages(prev => [...prev, { role: "assistant", content: data.data.message }]);
      if (data.data?.data?.novelId) setNovelId(data.data.data.novelId);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "操作失败" }]);
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full max-h-full">
      <div className="shrink-0 mb-4">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Sparkles size={20} className="text-purple-500" />创作助手
        </h2>
        <p className="text-xs text-slate-500 mt-1">用自然语言描述你想做什么，AI 帮你完成</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
              msg.role === "user" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.actions.map((act, j) => (
                    <button key={j} onClick={() => handleAction(act)} disabled={loading}
                      className="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs text-purple-700 hover:bg-purple-100 transition-colors">
                      {act.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />思考中...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="说说你想做什么..."
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-purple-400 focus:outline-none" />
        <button onClick={handleSend} disabled={loading || !input.trim()}
          className="rounded-xl bg-slate-800 px-4 py-2.5 text-white hover:bg-slate-700 disabled:opacity-50">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
