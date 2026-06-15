import { cn } from "@/lib/cn";

interface DesktopBrandMarkProps {
  className?: string;
}

export default function DesktopBrandMark({ className }: DesktopBrandMarkProps) {
  return (
    <img
      src="/icon-512.png"
      alt="One2Novel"
      className={cn("h-16 w-16 drop-shadow-[0_18px_40px_rgba(8,16,31,0.28)]", className)}
      aria-hidden="true"
    />
  );
}
