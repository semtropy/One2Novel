import { useState } from "react";
import { GitBranch, X } from "lucide-react";
import { useRelationshipGraph } from "../../api/novel";

interface Props { novelId: string }

export function RelationshipTimeline({ novelId }: Props) {
  const [show, setShow] = useState(false);
  const { data: graph } = useRelationshipGraph(novelId);

  if (!graph) return null;

  const sevColors: Record<string, string> = {
    friend: "border-emerald-400", enemy: "border-red-400", lover: "border-pink-400",
    rival: "border-accent-400", mentor: "border-blue-400", family: "border-brand-400",
  };
  const sevLabels: Record<string, string> = {
    friend: "盟友", enemy: "敌对", lover: "恋人", rival: "竞争", mentor: "师徒", family: "家人",
  };
  const stageColors: Record<string, string> = {
    strangers: "bg-slate-100 text-slate-500", acquainted: "bg-blue-50 text-blue-600",
    allied: "bg-green-50 text-green-600", conflicted: "bg-red-50 text-red-600",
    estranged: "bg-slate-200 text-slate-500", reconciled: "bg-accent-50 text-accent-600",
  };
  const stageLabels: Record<string, string> = {
    strangers: "陌生", acquainted: "相识", allied: "结盟", conflicted: "冲突", estranged: "疏远", reconciled: "和解",
  };

  const mainChars = graph.nodes.filter(n => n.role === "protagonist" || n.role === "antagonist");
  const otherChars = graph.nodes.filter(n => n.role !== "protagonist" && n.role !== "antagonist");

  return (
    <>
      <button onClick={() => setShow(true)}
        className="flex items-center gap-1 rounded-lg border bg-slate-800 text-white px-2.5 py-1 text-xs font-medium hover:bg-slate-700 rounded-lg">
        <GitBranch size={11} />关系
      </button>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShow(false)}>
          <div className="w-[44rem] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">角色关系</h3>
              <button onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            {graph.edges.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">暂无关系数据</p>
            ) : (
              <div className="space-y-3">
                {mainChars.map(node => (
                  <div key={node.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-2">{node.name} ({node.role === "protagonist" ? "主角" : "反派"})</p>
                    <div className="space-y-1.5">
                      {graph.edges.filter(e => e.sourceId === node.id || e.targetId === node.id).map(edge => {
                        const otherName = edge.sourceId === node.id ? edge.targetName : edge.sourceName;
                        return (
                          <div key={edge.id} className={`flex items-center gap-2 rounded border ${sevColors[edge.type] ?? "border-slate-200"} bg-slate-50 px-2 py-1.5`}>
                            <span className="text-[10px] font-medium text-slate-500 w-8">{sevLabels[edge.type] ?? edge.type}</span>
                            <span className="text-xs text-slate-700">{otherName}</span>
                            {edge.stage && (
                              <span className={`ml-auto rounded px-1.5 py-0 text-[10px] ${stageColors[edge.stage] ?? "bg-slate-100 text-slate-500"}`}>
                                {stageLabels[edge.stage] ?? edge.stage}
                              </span>
                            )}
                            {edge.attitudeSource && node.id === edge.sourceId && (
                              <span className="text-[10px] text-slate-400 ml-1">{edge.attitudeSource}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {otherChars.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs font-medium text-slate-500 mb-2">其他角色</p>
                    <div className="flex flex-wrap gap-1.5">
                      {otherChars.map(n => (
                        <span key={n.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{n.name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
