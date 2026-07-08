/**
 * PowerSystemTree — vertical cultivation/sequence level tree.
 *
 * Displays hierarchical power levels (境界/序列) as a clean vertical list.
 * Each level shows: [N] name (expand to see breakthrough condition + ability upgrade).
 * Children = sub-levels, indented with a connector line.
 */
import { useState } from "react";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";

export interface PowerNode {
  id: string;
  name: string;
  breakthroughCondition: string;
  abilityUpgrade: string;
  children: PowerNode[];
}

interface Props {
  nodes: PowerNode[];
  onChange: (nodes: PowerNode[]) => void;
  readonly?: boolean;
}

export function PowerSystemTree({ nodes, onChange, readonly }: Props) {
  const addRoot = () => {
    const id = `n_${Date.now()}`;
    onChange([...nodes, { id, name: "", breakthroughCondition: "", abilityUpgrade: "", children: [] }]);
  };

  const addChild = (parentId: string) => {
    const id = `n_${Date.now()}`;
    const add = (ns: PowerNode[]): PowerNode[] =>
      ns.map(n => n.id === parentId
        ? { ...n, children: [...n.children, { id, name: "", breakthroughCondition: "", abilityUpgrade: "", children: [] }] }
        : { ...n, children: add(n.children) });
    onChange(add(nodes));
  };

  const update = (id: string, field: keyof PowerNode, value: string) => {
    const upd = (ns: PowerNode[]): PowerNode[] =>
      ns.map(n => n.id === id
        ? { ...n, [field]: value }
        : { ...n, children: upd(n.children) });
    onChange(upd(nodes));
  };

  const remove = (id: string) => {
    const del = (ns: PowerNode[]): PowerNode[] =>
      ns.filter(n => n.id !== id).map(n => ({ ...n, children: del(n.children) }));
    onChange(del(nodes));
  };

  if (nodes.length === 0 && !readonly) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-slate-400 mb-2">暂未定义力量体系</p>
        <button onClick={addRoot}
          className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
          <Plus size={12} className="inline mr-1" />添加第一个境界
        </button>
      </div>
    );
  }

  return (
    <div>
      {nodes.map((node, idx) => (
        <TreeNode key={node.id} node={node} depth={0} index={idx}
          totalSiblings={nodes.length}
          onAddChild={addChild} onUpdate={update} onRemove={remove}
          readonly={readonly} />
      ))}
      {!readonly && nodes.length > 0 && (
        <button onClick={addRoot}
          className="w-full rounded-lg border border-dashed border-slate-200 py-2 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-600 transition-colors mt-2">
          <Plus size={11} className="inline mr-1" />添加顶级境界
        </button>
      )}
    </div>
  );
}

// ─── Recursive TreeNode ─────────────────────────────

function TreeNode({ node, depth, index, totalSiblings, onAddChild, onUpdate, onRemove, readonly }: {
  node: PowerNode; depth: number; index: number; totalSiblings: number;
  onAddChild: (id: string) => void;
  onUpdate: (id: string, field: keyof PowerNode, value: string) => void;
  onRemove: (id: string) => void;
  readonly?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className={`${depth > 0 ? "ml-5 pl-2 border-l-2 border-slate-200" : ""}`}>
        {/* Row 1: name */}
        <div className="flex items-center gap-1.5 group py-0.5">
          {hasChildren ? (
            <button onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-slate-400 hover:text-slate-600">
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="shrink-0 w-3" />
          )}
          <span className="shrink-0 w-5 h-5 rounded bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-600">
            {index + 1}
          </span>
          <input
            className="flex-1 min-w-0 rounded border border-transparent hover:border-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-700 focus:border-brand-400 focus:outline-none"
            value={node.name}
            onChange={e => onUpdate(node.id, "name", e.target.value)}
            placeholder="境界名称"
            readOnly={readonly}
          />
          {!readonly && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 shrink-0">
              <button onClick={() => onAddChild(node.id)} className="rounded p-0.5 text-slate-300 hover:text-emerald-500" title="子境界"><Plus size={11} /></button>
              <button onClick={() => onRemove(node.id)} className="rounded p-0.5 text-slate-300 hover:text-red-500" title="删除"><X size={11} /></button>
            </div>
          )}
        </div>

        {/* Row 2+3: detail fields — stacked vertically */}
        <div className="ml-7 space-y-1 mb-1">
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 text-[10px] text-slate-400 w-12 pt-0.5">突破条件</span>
            <input
              className="flex-1 min-w-0 rounded border border-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 focus:border-brand-300 focus:outline-none"
              value={node.breakthroughCondition}
              onChange={e => onUpdate(node.id, "breakthroughCondition", e.target.value)}
              placeholder="如：炼化三品丹药、渡过雷劫"
              readOnly={readonly}
            />
          </div>
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 text-[10px] text-slate-400 w-12 pt-0.5">能力跃迁</span>
            <input
              className="flex-1 min-w-0 rounded border border-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 focus:border-brand-300 focus:outline-none"
              value={node.abilityUpgrade}
              onChange={e => onUpdate(node.id, "abilityUpgrade", e.target.value)}
              placeholder="如：寿元+500年、可催动本命法宝"
              readOnly={readonly}
            />
          </div>
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child, cIdx) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} index={cIdx}
              totalSiblings={node.children.length}
              onAddChild={onAddChild} onUpdate={onUpdate} onRemove={onRemove}
              readonly={readonly} />
          ))}
        </div>
      )}
    </div>
  );
}
