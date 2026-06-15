// ─── Severity 标签映射（中英文）─────────────────────────
// 后端归一化后存英文字符串，前端用此映射展示中文

export const SEVERITY_LABEL = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
} as const;

export type SeverityKey = keyof typeof SEVERITY_LABEL;
