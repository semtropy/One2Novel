/**
 * StartPage — 创作入口页
 * 用户输入一句灵感 + 可选上传参考书 → 创建小说 → 进入规划流程
 */
import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, BookOpen, Upload, FileText, X, Sparkles } from "lucide-react";
import { useCreateNovel } from "../api/novel";
import { api } from "../app/api";
import { cn } from "../lib/cn";

const PLACEHOLDER_EXAMPLES = [
  "一个少年在末世觉醒了吞噬异能…",
  "穿越成反派后，我靠写小说成神…",
  "修仙界最后一个阵法师的逆袭之路…",
];

export function StartPage() {
  const navigate = useNavigate();
  const createNovel = useCreateNovel();

  const [inspiration, setInspiration] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const placeholder = PLACEHOLDER_EXAMPLES[Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length)];

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".txt")) {
      setError("仅支持 .txt 文件");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("文件大小不能超过 50MB");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedFile({
        name: file.name,
        content: (e.target?.result as string) ?? "",
      });
    };
    reader.onerror = () => setError("文件读取失败，请重试");
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleStart = async (skipRefBook = false) => {
    const desc = inspiration.trim();
    if (!desc) {
      setError("请输入你的灵感描述");
      return;
    }
    setCreating(true);
    setError("");

    try {
      // Create novel with inspiration as description
      const novel = await createNovel.mutateAsync({
        title: "未命名小说",
        description: desc,
      });

      // Upload reference book if provided
      if (!skipRefBook && uploadedFile?.content) {
        try {
          await api.post(`/novels/${novel.id}/reference-book`, {
            fileName: uploadedFile.name,
            content: uploadedFile.content,
          });
        } catch {
          // Reference upload is best-effort — don't block flow
        }
      }

      navigate(`/novels/${novel.id}/plan`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <img
            src="/icon-bw-512.png"
            alt="One2Novel"
            className="mx-auto mb-4 w-10 h-10"
          />
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            从一句灵感到百万字大作
          </h1>
          <p className="text-sm text-slate-500">
            AI 驱动的长篇小说创作工作台
          </p>
        </div>

        {/* Inspiration Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-600 mb-2">
            输入你的一句话灵感
          </label>
          <textarea
            className={cn(
              "w-full rounded-xl border bg-white px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 transition-all",
              inspiration
                ? "border-slate-300 focus:ring-brand-200"
                : "border-slate-200 focus:ring-brand-200",
            )}
            rows={4}
            placeholder={placeholder}
            value={inspiration}
            onChange={(e) => {
              setInspiration(e.target.value);
              setError("");
            }}
            maxLength={2000}
            autoFocus
          />
          <p className="text-xs text-slate-400 mt-1 text-right">
            {inspiration.length}/2000
          </p>
        </div>

        {/* Reference Book Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-600 mb-2">
            上传参考书（可选，.txt 文件）
          </label>

          {uploadedFile ? (
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50/50 px-4 py-3">
              <FileText size={18} className="text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-800 truncate">
                  {uploadedFile.name}
                </p>
                <p className="text-xs text-green-600">
                  {(uploadedFile.content.length / 1000).toFixed(0)}k 字符
                  {" · "}约 {(uploadedFile.content.length / 10000).toFixed(0)} 章
                </p>
              </div>
              <button
                onClick={() => setUploadedFile(null)}
                className="shrink-0 rounded-lg p-1 text-green-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div
              className={cn(
                "relative rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer",
                dragOver
                  ? "border-brand-400 bg-brand-50/30"
                  : "border-slate-300 bg-slate-50/50 hover:border-slate-400",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-500">
                拖拽 .txt 文件到此处，或点击选择
              </p>
              <p className="text-xs text-slate-400 mt-1">
                支持100万字以上，AI 将分析其回环结构、爽点分布和写作技法
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={() => handleStart(false)}
            disabled={creating || !inspiration.trim()}
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-xl px-6 py-4 text-sm font-medium transition-all",
              inspiration.trim()
                ? "bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
                : "bg-slate-200 text-slate-400 cursor-not-allowed",
              creating && "opacity-60",
            )}
          >
            {creating ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
            {uploadedFile ? "开始创作（含参考书分析）" : "开始创作"}
          </button>

          <button
            onClick={() => handleStart(true)}
            disabled={creating || !inspiration.trim() || !uploadedFile}
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm transition-colors",
              uploadedFile
                ? "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed",
            )}
            title={uploadedFile ? undefined : "请先上传参考书再使用此选项"}
          >
            <PenLine size={15} />
            仅凭灵感创作（跳过参考书分析）
          </button>
        </div>

        <button
          onClick={() => navigate("/novels")}
          className="mt-5 w-full flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <BookOpen size={14} />
          已有项目？进入我的小说
        </button>
      </div>
    </div>
  );
}
