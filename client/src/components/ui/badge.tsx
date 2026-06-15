import type * as React from "react";
import { cn } from "@/lib/cn";

const variants: Record<string, string> = {
  default: "border-transparent bg-slate-800 text-slate-100",
  secondary: "border-transparent bg-slate-100 text-slate-600",
  destructive: "border-transparent bg-red-500 text-white",
  outline: "border-slate-300 text-slate-700",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none",
        variants[variant] ?? variants.default,
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
