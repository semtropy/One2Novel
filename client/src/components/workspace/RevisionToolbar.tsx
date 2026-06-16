import { OPERATION_LABELS, type RevisionOperation } from "../../api/revision";

interface Props {
  visible: boolean;
  position: { top: number; left: number } | null;
  onSelectOperation: (op: RevisionOperation) => void;
  onClose: () => void;
  loading: boolean;
}

export function RevisionToolbar({ visible, position, onSelectOperation, onClose, loading }: Props) {
  const operations = Object.entries(OPERATION_LABELS) as [RevisionOperation, { label: string; emoji: string; desc: string }][];

  if (!visible || !position) return null;

  return (
    <div
      className="fixed z-40 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[260px]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b">
        <span className="text-xs font-medium text-gray-500">AI 改写选中段落</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm leading-none">&times;</button>
      </div>
      <div className="space-y-0.5">
        {operations.map(([key, op]) => (
          <button
            key={key}
            disabled={loading}
            onClick={() => onSelectOperation(key)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-accent-50 disabled:opacity-50 transition-colors group"
          >
            <span className="text-base">{op.emoji}</span>
            <div className="flex-1">
              <div className="font-medium text-gray-700 group-hover:text-accent-700">{op.label}</div>
              <div className="text-[10px] text-gray-400">{op.desc}</div>
            </div>
          </button>
        ))}
        <button
          onClick={() => onSelectOperation("polish")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-brand-50 text-brand-500 mt-1 border-t pt-1.5"
        >
          <span className="text-base">💬</span>
          <span className="font-medium">自定义指令</span>
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 bg-white/60 rounded-xl flex items-center justify-center">
          <div className="animate-spin w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
