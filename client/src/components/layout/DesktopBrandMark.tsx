import { cn } from "@/lib/cn";

interface DesktopBrandMarkProps {
  className?: string;
}

export default function DesktopBrandMark({ className }: DesktopBrandMarkProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-16 w-16 drop-shadow-[0_18px_40px_rgba(8,16,31,0.28)]", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="desktopBrandGradientReact" x1="14" y1="12" x2="82" y2="84" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1E3A5F" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="80" height="80" rx="24" fill="url(#desktopBrandGradientReact)" />
      <text x="48" y="60" textAnchor="middle" fill="#F8FAFC" fontSize="34" fontWeight="700" fontFamily="sans-serif">1→N</text>
      <circle cx="69" cy="28" r="4.5" fill="#76E5FF" />
      <circle cx="28" cy="65" r="3.5" fill="#F6B24C" />
    </svg>
  );
}
