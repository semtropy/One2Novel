import { Loader2 } from "lucide-react";

export function Loading({ text = "加载中..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <Loader2 size={32} className="animate-spin text-slate-400" />
      <span className="text-sm text-slate-500">{text}</span>
    </div>
  );
}
