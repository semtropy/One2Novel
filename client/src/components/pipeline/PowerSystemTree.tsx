/**
 * PowerSystemTree — recursive tree visualization for cultivation/sequence systems.
 * Displays hierarchical power levels (境界/序列) with breakthrough conditions
 * and ability upgrades. Editable inline.
 */
import { useState } from "react";
import { Plus, X, ChevronRight, ChevronDown } from "lucide-react";

export interface PowerNode {
  id: string;
  name: string;                // 境界/序列名称 (e.g. "筑基", "序列9-占卜家")
  breakthroughCondition: string; // 突破条件
  abilityUpgrade: string;       // 能力跃迁描述
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
      <div className="text-center py-6">
        <p className="text-xs text-slate-400 mb-2">暂未定义力量体系</p>
        <button onClick={addRoot}
          className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700">
          <Plus size={11} className="inline mr-1" />添加境界/序列
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {nodes.map((node, idx) => (
        <TreeNode key={node.id} node={node} depth={0} index={idx}
          onAddChild={addChild} onUpdate={update} onRemove={remove}
          readonly={readonly} />
      ))}
      {!readonly && nodes.length > 0 && (
        <button onClick={addRoot}
          className="w-full rounded-lg border border-dashed border-slate-200 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-600">
          <Plus size={11} className="inline mr-1" />添加顶级境界
        </button>
      )}
    </div>
  );
}

// ─── Recursive TreeNode ─────────────────────────────

function TreeNode({ node, depth, index, onAddChild, onUpdate, onRemove, readonly }: {
  node: PowerNode; depth: number; index: number;
  onAddChild: (id: string) => void;
  onUpdate: (id: string, field: keyof PowerNode, value: string) => void;
  onRemove: (id: string) => void;
  readonly?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const indent = depth * 24;

  return (
    <div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white p-2.5 hover:border-slate-200 transition-colors"
        style={{ marginLeft: indent }}>
        {/* Expand/Collapse */}
        {hasChildren ? (
          <button onClick={() => setExpanded(!expanded)}
            className="shrink-0 mt-1 text-slate-400 hover:text-slate-600">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="shrink-0 w-3 mt-1" />
        )}

        {/* Level number */}
        <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 mt-0.5">
          {index + 1}
        </span>

        {/* Editable fields */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <input
            className="w-full rounded border border-transparent hover:border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 focus:border-brand-300 focus:outline-none"
            value={node.name}
            onChange={e => onUpdate(node.id, "name", e.target.value)}
            placeholder="境界/序列名称"
            readOnly={readonly}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              className="w-full rounded border border-transparent hover:border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 focus:border-brand-300 focus:outline-none"
              value={node.breakthroughCondition}
              onChange={e => onUpdate(node.id, "breakthroughCondition", e.target.value)}
              placeholder="突破条件"
              readOnly={readonly}
            />
            <input
              className="w-full rounded border border-transparent hover:border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 focus:border-brand-300 focus:outline-none"
              value={node.abilityUpgrade}
              onChange={e => onUpdate(node.id, "abilityUpgrade", e.target.value)}
              placeholder="能力跃迁"
              readOnly={readonly}
            />
          </div>
        </div>

        {/* Actions */}
        {!readonly && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 hover:opacity-100 transition-opacity">
            <button onClick={() => onAddChild(node.id)}
              className="rounded p-0.5 text-slate-300 hover:text-brand-500 hover:bg-brand-50"
              title="添加子层级">
              <Plus size={10} />
            </button>
            <button onClick={() => onRemove(node.id)}
              className="rounded p-0.5 text-slate-300 hover:text-red-500 hover:bg-red-50"
              title="删除">
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="mt-1">
          {node.children.map((child, cIdx) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} index={cIdx}
              onAddChild={onAddChild} onUpdate={onUpdate} onRemove={onRemove}
              readonly={readonly} />
          ))}
        </div>
      )}
    </div>
  );
}
