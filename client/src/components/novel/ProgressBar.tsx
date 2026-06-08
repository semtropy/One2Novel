import { CheckCircle, Circle } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  steps: { key: string; label: string; done: boolean; current: boolean }[];
  onStepClick?: (key: string) => void;
}

export function ProgressBar({ steps, onStepClick }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <button onClick={() => onStepClick?.(s.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              s.done ? "bg-green-50 text-green-700 border border-green-200" :
              s.current ? "bg-slate-100 text-slate-600 border border-slate-300" :
              "bg-slate-50 text-slate-400 border border-slate-200"
            )}>
            {s.done ? <CheckCircle size={11} /> : <Circle size={11} />}
            {s.label}
          </button>
          {i < steps.length - 1 && <div className="w-3 h-0.5 bg-slate-200" />}
        </div>
      ))}
    </div>
  );
}
