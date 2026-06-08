import { useState } from "react";
import { useExportPreview, useExportNovel } from "../../api/novel";

interface Props {
  novelId: string;
  onClose: () => void;
}

const FORMATS = [
  { key: "epub", label: "EPUB 电子书", desc: "分章节、带目录、可导入 Kindle / Apple Books / 微信读书", icon: "📖" },
  { key: "md", label: "Markdown", desc: "带 YAML 元数据 + 目录，可导入 Obsidian / Notion", icon: "📝" },
  { key: "txt", label: "纯文本 TXT", desc: "章节分隔，通用格式，适合在任何设备阅读", icon: "📄" },
  { key: "json", label: "JSON 完整备份", desc: "含全部元数据/角色/大纲，可重新导入系统", icon: "💾" },
];

export default function ExportDialog({ novelId, onClose }: Props) {
  const [format, setFormat] = useState("epub");
  const [exporting, setExporting] = useState(false);
  const preview = useExportPreview(novelId);
  const exportMutation = useExportNovel();

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportMutation.mutateAsync({ novelId, format });
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = preview.data?.title?.replace(/[<>:"/\\|?*]/g, "_") ?? "novel";
      const ext = format === "epub" ? "epub" : format === "md" ? "md" : format === "json" ? "json" : "txt";
      a.download = `${safeName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      // Error handled by mutation
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">导出全书</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {preview.data && (
          <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm space-y-1">
            <div className="font-medium">{preview.data.title}</div>
            <div className="text-gray-500">
              {preview.data.chapterCount} 章 · {preview.data.completedChapters} 已完成 · {(preview.data.totalChars / 1000).toFixed(1)}k 字
            </div>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {FORMATS.map(f => (
            <label
              key={f.key}
              className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                format === f.key ? "border-amber-500 bg-amber-50" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="format"
                value={f.key}
                checked={format === f.key}
                onChange={() => setFormat(f.key)}
                className="mt-0.5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="font-medium text-sm flex items-center gap-1.5">
                  <span>{f.icon}</span> {f.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {format === "epub" && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
            将生成 EPUB 3.0 格式，含封面占位页、自动目录和分章 XHTML。可在 Calibre、Apple Books 中打开。
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-60"
          >
            {exporting ? "导出中..." : `导出 ${FORMATS.find(f => f.key === format)?.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
