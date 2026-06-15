import { useParams, useNavigate, useLocation } from "react-router-dom";
import { BookOpen, Settings, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

const NAV_ITEMS = [
  { path: "/novels", label: "我的小说", icon: BookOpen },
];

export function TopBar() {
  const { novelId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Detect which workspace view we're in for breadcrumb
  const isPlanView = location.pathname.includes("/plan");
  const isWriteView = location.pathname.includes("/write");
  const workspaceLabel = isPlanView ? "创作规划" : isWriteView ? "写作工作台" : null;

  return (
    <header className="flex h-14 items-center gap-1 border-b border-slate-200 bg-white px-4">
      {/* Logo */}
      <button onClick={() => navigate("/")} className="flex items-center gap-2 font-bold text-slate-800 hover:text-slate-600 mr-4 shrink-0">
        <img src="/icon-bw-512.png" alt="One2Novel" className="w-[18px] h-[18px]" />
        <span className="text-sm">One2Novel</span>
      </button>

      {/* Nav links */}
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(item => {
          const active = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-slate-100 text-slate-900 font-medium"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              <item.icon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Breadcrumb for workspace */}
      {novelId && workspaceLabel && (
        <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-200">
          <ChevronRight size={12} className="text-slate-300" />
          <span className="text-sm text-slate-500">{workspaceLabel}</span>
        </div>
      )}

      {/* Settings */}
      <button
        onClick={() => navigate("/settings")}
        className={cn(
          "ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
          location.pathname === "/settings"
            ? "bg-slate-100 text-slate-900"
            : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        )}
      >
        <Settings size={15} />
        设置
      </button>
    </header>
  );
}
