import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string; // Tailwind max-w class, e.g. "max-w-lg"
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, maxWidth = "max-w-lg", footer }: ModalProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn("bg-white rounded-xl shadow-xl w-full mx-4", maxWidth)}>
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}
