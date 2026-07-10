# Phase 2：Reviewer 升级 — 从打分到问题清单

## Context

**现状：** qualityGate 返回 10 个维度分数（0-10 每维）+ 总分（0-100）+ verdict（PASS/WARNING/NEEDS_FIX/BLOCKED）+ issues[]。

**wNW reviewer：** 返回 5 维度问题清单（setting/timeline/continuity/character/logic），每个 issue 有 severity/category/evidence/fix_hint/blocking，无打分。

**差距：**
- One2Novel 的分数制对自动化决策有用（决定是否 repair），但对人类作者不直观
- qualityGate 的 issues[] 已有 description/fixSuggestion，但缺少 **evidence**（原文引用）、**blocking** 标记、**category** 维度归属
- 没有 wNW 的 `dimension_results`（每个维度显式 pass/发现问题）

## 设计目标

1. **保留分数制** — 用于自动化决策（repair threshold, verdict），这是 wNW 没有的
2. **增强问题清单** — 每个 issue 增加 evidence（原文引用）、blocking 标记、category 维度归属
3. **新增 dimension_results** — 5 个维度各一个 pass/发现问题结论，对齐 wNW reviewer schema
4. **零破坏性** — qualityGate 返回类型向后兼容，新增字段不影响现有 pipeline

## 改动范围

### 1. qualityGate.ts — 增强输出

```typescript
export interface QualityResult {
  // 保留现有字段（向后兼容）
  openingScore: number; plotScore: number; ... coherenceScore: number;
  verdict: Verdict;
  
  // 增强 issues[]
  issues: Array<{
    type: string;           // 现有：如"展示而非讲述"
    severity: "low" | "medium" | "high";  // 现有
    description: string;    // 现有
    fixSuggestion: string;  // 现有
    // 新增
    category: string;       // "setting" | "timeline" | "continuity" | "character" | "logic" | "pacing" | "style"
    evidence?: string;      // 原文引用片段
    blocking?: boolean;     // 是否阻断（仅 high severity + 硬约束违反）
    location?: string;      // 段落/行号定位
  }>;
  
  // 新增：5 维度结论（对齐 wNW reviewer schema）
  dimensionResults: Array<{
    dimension: "setting" | "timeline" | "continuity" | "character" | "logic";
    conclusion: string;     // "pass" 或 "发现N个问题：简述"
    issueCount: number;
  }>;
}
```

**category 映射规则：**
| qualityGate 维度 | → category |
|---|---|
| 角色硬约束违反 | logic (blocking) |
| coherenceScore | continuity |
| characterScore | character |
| genreScore | setting |
| pacingScore | pacing |
| showNotTellScore | style |
| languageScore | style |
| suspenseScore | logic |
| plotScore | logic |
| dialogueScore | character |
| openingScore | style |

**blocking 规则：**
- severity === "high" AND (type 包含"硬约束"或"违反") → blocking = true
- 其他情况 blocking = false（默认）

### 2. pipeline 消费端适配

**chapterPipeline.ts** — formatIssuesForRepair() 已兼容带 evidence/blocking 的 issue 结构，无需改动。

**ReviewPanel.tsx** — 现有显示分数 + 段落诊断。Phase 2 不改动 UI（分数仍然显示），但新增的 issues[].evidence 和 blocking 会在后续 RevisionWorkbench 中使用。

**qualityPersist.ts** — 将 issues[] 存入 AuditReport.details JSON。由于新增字段是可选的，向后兼容。

### 3. 不做的改动

- **不删除分数** — 分数对 automated repair decision 很重要
- **不引入独立的 reviewer agent** — qualityGate 已经是 LLM 调用，增加独立 reviewer 会多一次 LLM 成本
- **不改 qualityGate 的 prompt** — prompt 已经返回 issues[]，只需增强 schema

## 实施步骤

### Step 1: 增强 QualityResult schema（30m）
- 在 RawQualitySchema 中增加 category/evidence/blocking/location 字段
- 在 QualityResult 接口中增加 dimensionResults
- 修改 runQualityGate() 的计算逻辑，生成 dimensionResults

### Step 2: 增强 qualityDiagnostics（30m）
- 为每个 DiagnosticItem 增加 category 映射
- 增强 evidence 提取：从正文中定位问题段落

### Step 3: 更新 qualityPersist（15m）
- 确保 dimensionResults 也被持久化到 AuditReport

### Step 4: 验证（15m）
- typecheck
- 端到端测试：写章 → qualityGate → 验证 dimensionResults 格式

**总计：约 1.5 小时**
