/**
 * RelationshipNetwork — simple visual network graph of character relationships.
 * Nodes colored by loop function tag, edges labeled with relationship type + stage.
 * Pure CSS layout; clickable nodes and edges for quick editing.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface CharNode {
  id: string; name: string; role: string; loopFunctionTag?: string | null;
}
export interface RelEdge {
  id: string; sourceId: string; targetId: string; type: string; stage?: string | null;
  attitudeSource?: string | null; attitudeTarget?: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  protagonist: "border-blue-400 bg-blue-50 text-blue-700",
  antagonist: "border-red-400 bg-red-50 text-red-700",
  supporting: "border-green-400 bg-green-50 text-green-700",
  minor: "border-slate-300 bg-slate-50 text-slate-500",
};

const TAG_COLORS: Record<string, string> = {
  "副本触发器": "bg-yellow-100 border-yellow-400",
  "奖励来源": "bg-emerald-100 border-emerald-400",
  "伏笔载体": "bg-brand-100 border-brand-400",
  "长期威胁": "bg-red-100 border-red-400",
  "情感锚点": "bg-pink-100 border-pink-400",
};

const REL_COLORS: Record<string, string> = {
  friend: "text-green-600", enemy: "text-red-600", lover: "text-pink-600",
  rival: "text-orange-600", mentor: "text-brand-600", family: "text-accent-600",
};

interface Props {
  characters: CharNode[];
  relations: RelEdge[];
  onEditRelation?: (rel: RelEdge) => void;
}

export function RelationshipNetwork({ characters, relations, onEditRelation }: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  if (characters.length === 0) return <p className="text-xs text-slate-400 py-4 text-center">暂无角色</p>;

  // Layout: arrange characters in a circle
  const radius = 140;
  const cx = 180, cy = 150;

  const positions = characters.map((_, i) => {
    const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-100 bg-white" style={{ height: 320 }}>
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        {relations.map(rel => {
          const si = characters.findIndex(c => c.id === rel.sourceId);
          const ti = characters.findIndex(c => c.id === rel.targetId);
          if (si < 0 || ti < 0) return null;
          const sp = positions[si], tp = positions[ti];
          const midX = (sp.x + tp.x) / 2, midY = (sp.y + tp.y) / 2;
          const isHovered = hoveredEdge === rel.id;
          const colorClass = REL_COLORS[rel.type] ?? "text-slate-400";
          return (
            <g key={rel.id} style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={() => onEditRelation?.(rel)}
              onMouseEnter={() => setHoveredEdge(rel.id)}
              onMouseLeave={() => setHoveredEdge(null)}>
              <line x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y}
                stroke={isHovered ? "#6366f1" : "#cbd5e1"} strokeWidth={isHovered ? 2 : 1} />
              <rect x={midX - 24} y={midY - 8} width={48} height={16} rx={4}
                fill="white" stroke={isHovered ? "#6366f1" : "#e2e8f0"} strokeWidth={0.5} />
              <text x={midX} y={midY + 4} textAnchor="middle" fontSize="9" fill="#64748b"
                className={isHovered ? "font-medium" : ""}>
                {rel.type}{rel.stage ? `·${rel.stage.slice(0, 4)}` : ""}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Character nodes */}
      {characters.map((char, i) => {
        const pos = positions[i];
        const isSelected = selectedNode === char.id;
        const roleColor = ROLE_COLORS[char.role] ?? ROLE_COLORS.minor;
        const tagColor = char.loopFunctionTag ? TAG_COLORS[char.loopFunctionTag] : "";

        return (
          <div key={char.id}
            className={cn("absolute rounded-xl border-2 px-2 py-1.5 text-center cursor-pointer transition-all shadow-sm",
              roleColor, tagColor, isSelected ? "ring-2 ring-brand-300 scale-110 z-10" : "hover:scale-105 z-0",
            )}
            style={{ left: pos.x - 40, top: pos.y - 16, width: 80 }}
            onClick={() => setSelectedNode(isSelected ? null : char.id)}
            title={`${char.role === "protagonist" ? "主角" : char.role === "antagonist" ? "反派" : char.role === "supporting" ? "配角" : "次要"}${char.loopFunctionTag ? ` · ${char.loopFunctionTag}` : ""}`}>
            <div className="text-xs font-semibold truncate">{char.name}</div>
            <div className="text-[9px] opacity-60 truncate">
              {char.loopFunctionTag ?? char.role}
            </div>
          </div>
        );
      })}

      {/* Selected node detail */}
      {selectedNode && (() => {
        const char = characters.find(c => c.id === selectedNode);
        if (!char) return null;
        const charRels = relations.filter(r => r.sourceId === selectedNode || r.targetId === selectedNode);
        return (
          <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-white border border-slate-200 p-2 shadow-lg z-20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-700">{char.name}</span>
              <button onClick={() => setSelectedNode(null)} className="text-slate-300 hover:text-slate-500"><X size={10} /></button>
            </div>
            {char.loopFunctionTag && <div className="text-[10px] text-slate-500 mb-1">{char.loopFunctionTag}</div>}
            <div className="text-[10px] text-slate-400">
              {charRels.length > 0 ? `${charRels.length}条关系` : "无关系"}
              {charRels.slice(0, 3).map(r => {
                const other = r.sourceId === char.id
                  ? characters.find(c => c.id === r.targetId)
                  : characters.find(c => c.id === r.sourceId);
                return <span key={r.id} className="ml-1 text-slate-500">· {other?.name}({r.type})</span>;
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
