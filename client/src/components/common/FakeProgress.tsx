import { useEffect, useState, useRef } from "react";

interface Props {
  running: boolean;
  onComplete?: () => void;
  label?: string;
}

function stageLabel(pct: number, label?: string): string {
  const stage = pct >= 100 ? "完成" : pct < 25 ? "正在准备..." : pct < 60 ? "正在生成..." : pct < 78 ? "正在审查..." : pct < 95 ? "正在修复..." : "即将完成...";
  return label ? `${stage} · ${label}` : stage;
}

export function FakeProgress({ running, onComplete, label }: Props) {
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!running) return;
    setPct(0); setDone(false);

    const steps = [
      { at: 800, to: 25 },
      { at: 2000, to: 45 },
      { at: 4000, to: 60 },
      { at: 7000, to: 78 },
      { at: 12000, to: 88 },
      { at: 20000, to: 94 },
      { at: 25000, to: 99 },
    ];

    timers.current = steps.map(s => setTimeout(() => setPct(s.to), s.at));

    return () => { timers.current.forEach(clearTimeout); };
  }, [running]);

  // When running becomes false, jump to 100% and complete
  useEffect(() => {
    if (!running && pct > 0 && !done) {
      setPct(100);
      setDone(true);
      setTimeout(() => {
        setPct(0); setDone(false);
        onComplete?.();
      }, 1000);
    }
  }, [running, pct, done, onComplete]);

  if (!running && !done) return null;

  return (
    <div className="mt-2 rounded-lg bg-blue-50 p-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-blue-600">{stageLabel(pct, label)}</span>
        <span className="text-blue-400">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-blue-100 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
