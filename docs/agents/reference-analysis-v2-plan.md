# 参考书分析 V2 计划

## 目标

"模仿创作"。分析一本对标书，提取可迁移到自己的小说创作中的所有结构级和技法级洞察。

---

## 一、当前七维 → 新七维

### 1. 回环推断 → 回环叙事分析（保留，升级）

**当前**：AI 从标注矩阵推断 `[{startChapter, endChapter, triggerHint}]`——只有章号和一句提示。

**升级后**：Phase 3 不再只输出边界。对于每个检测到的回环，额外调用 AI 深度分析：

```
每个回环的输出：
{
  loopIndex: number,
  startChapter: number, endChapter: number,
  // 叙事结构
  coreConflict: string,        // 本回环的核心冲突（30-80字）
  protagonistChange: string,   // 主角在本回环中的变化（30-80字）
  keyEvents: string[],         // 3-5个关键事件（各15-30字）
  infoRevealed: string[],      // 本回环新揭示的世界信息（2-3条）
  settlementContent: string,   // 回环结算内容（30-80字）
  // 叙事功能
  narrativeFunction: "setup" | "escalation" | "turn" | "climax" | "denouement",
  // 与前一轮的关系
  progressionFromPrevious: string, // 本轮比上一轮"大"在哪（15-40字）
}
```

**对创作的影响**：Step 4 生成回环骨架时，给 AI 的不是某本书的回环数，而是"回环叙事模板"——每轮回环承担什么样的叙事功能、推进到什么程度。

**实现方式**：Phase 3 检测边界后，对每个回环单独调 AI（非批量——每个回环需要深度分析）。26 个回环 = 26 次 AI 调用。每次调用的上下文是该回环的所有章节标注摘要 + 章节开头内容。

---

### 2. 爽点分布 → 节奏曲线分析（保留，升级）

**当前**：`{highCoolChapters: [1,5,12,...], lowCoolChapters: [3,8,...]}`——一串章号。

**升级后**：从标注矩阵计算：

```
{
  // 完整节奏曲线
  tensionCurve: number[],  // 每章的 conflictIntensity，长度 = 总章数
  // 统计特征
  avgClimaxInterval: number,     // 平均两个高潮章之间的间隔
  avgCooldownLength: number,     // 平均冷却章连续长度
  tensionCycleLength: number,    // 典型的 tension-release 周期长度
  // 模板
  rhythmTemplate: "波浪式" | "阶梯上升" | "双峰交替" | "自定义描述",
  rhythmDescription: string,     // 一句话描述节奏特征
}
```

**对创作的影响**：Step 4 卷展开时，将 rhythmTemplate 和 stats 注入 AI prompt——"对标书的冲突曲线是每 12 章一个 tension-release 周期，高潮间隔 3 章，冷却段不超过 2 章"。

**实现方式**：纯统计计算，不调 AI。从 213 条 chapterAnnotation 的 conflictIntensity 数组直接计算。

---

### 3. 金手指 → 设计模式提取（保留，升级）

**当前**：`{abilities: [...], limits: [...], goldenFingerName: "幽灵倒计时"}`——特定书的内容。

**升级后**：Phase 6 除了提取金手指本身，额外分析**设计模式**：

```
{
  // 提取结果（保留）
  goldenFinger: { name, abilities[], limits[] },
  // 设计模式（新增——这才是可迁移的）
  designPattern: {
    type: "信息差型" | "能力进化型" | "资源放大器型" | "规则外挂型" | "自定义",
    typeDescription: string,      // 一句话说明（15-40字）
    coreMechanic: string,         // 核心机制（50-100字）
    acquisitionPattern: string,   // 获取模式（"开局赠送" / "逐步解锁" / "隐藏触发" / ...）
    evolutionPath: string[],      // 能力的进化路径描述（what unlocks when）
    limitationStrategy: string,   // 限制策略（"代价递增" / "冷却时间" / "资源消耗" / "精神负担" / ...）
    narrativeIntegration: string, // 如何融入叙事（"倒计时推动主角调查真相"）
    suitability: {                // 适用场景
      genres: string[],           // 适合的题材
      architectures: string[],    // 适合的架构类型
    },
  }
}
```

**对创作的影响**：Step 2（世界构建）的金手指 AI 生成时，设计模式作为 few-shot 参考注入 prompt。不是生成"幽灵倒计时"的克隆，而是生成类似模式（"信息差型：主角获得一个只有自己能看到的预警信号"）。

**实现方式**：Phase 6 第一次调用提取金手指本身。第二次调用分析设计模式（同一个 prompt 中用 structured output 同时输出两者）。

---

### 4. 设定时间线（删除）

对模仿创作无迁移价值。从 CockpitPage 移除 Section。从 deepAnalyze 删除 Phase 7。

---

### 5. 写法技法（保留，不变）

当前已经足够。5 维技法规则 + 章节写作 context injection。

---

### 6. 内容节拍分布（保留，不变）

当前从标注矩阵统计，已足够。

---

### 7. 新增：三页统计

从标注矩阵 + 全文计算，纯统计，不调 AI。

#### 7a. 开场模式

每章前 200 字分类：

```
{
  openingPatterns: {
    action: number,    // "他从墙上取下剑..."
    dialogue: number,  // "'你来了。'他没有回头。"
    environment: number, // "雨已经下了三天..."
    internal: number,  // "他不知道自己还能撑多久..."
    exposition: number, // "大奉王朝延续三百年..."
  },
  dominantPattern: string, // "environment (42%)"
}
```

#### 7b. 对白密度

```
{
  dialogueRatio: number,        // 对话占总字数 %
  avgDialoguePerChapter: number, // 每章平均对话次数
  avgDialogueLineLength: number, // 平均每句对话字数
}
```

#### 7c. 描写类型分布

用关键词/句式特征估算（不需要 AI）：

```
{
  visual: number,    // 视觉描写占比 %（颜色词/光/形状/...）
  action: number,    // 动作描写占比 %
  internal: number,  // 内心独白/思考占比 %
  sensory: number,   // 听觉/触觉/嗅觉占比 %
}
```

**对创作的影响**：注入章节写作 context 和 StyleProfile——"对标书 42% 的章以环境描写开场，对话占 35%，视觉描写为主"。

**实现方式**：Phase 2 扩展现有的逐章标注，增加 `openingType` 字段。对白密度和描写类型从全文统计。

---

## 二、Phase 2 标注扩展

当前 6 个字段 → 增加 1 个字段：

```diff
  ChapterAnnotation {
    chapterType, coolPointLevel, hookType,
    contentBeat, secondaryBeat,
    conflictIntensity, summary,
+   openingType: "action" | "dialogue" | "environment" | "internal" | "exposition",
  }
```

在 `novel.chapter.annotate` 系统 prompt 中增加一个字段说明。不影响已有标注数据（旧标注 openingType 为 null）。

---

## 三、Prisma Schema 变更

ReferenceProfile 用单独的 `analysisResult` JSON 列替代所有独立列：

```diff
  ReferenceProfile {
    name, content, totalChapters,
-   loopBoundaries, coolPointDensity, hookPatterns,
-   goldenFingerBounds, contentBeatPatterns,
-   writingAssets, settingTimeline,
-   architectureProfile, deepAnalysisProgress,
-   chapterAnnotations,
+   analysisResult  String?  // JSON: 完整的 AnalysisResult（见下文）
  }
```

所有分析结果聚合到一个 JSON 列中，不再有分散的独立列。

```
AnalysisResult {
  // 基础
  totalChapters: number,
  completedAt: string,

  // 逐章标注矩阵
  annotations: ChapterAnnotation[],

  // ArchitectureProfile（统计合成）
  architectureProfile: ArchitectureProfile,

  // 回环叙事（每个回环的深度分析）
  loopNarratives: LoopNarrative[],

  // 节奏曲线
  rhythmProfile: RhythmProfile,

  // 金手指设计模式
  goldenFingerAnalysis: GoldenFingerAnalysis,

  // 写法技法
  writingTechniques: WritingTechniques,

  // 三页统计
  craftStats: CraftStats,
}
```

---

## 四、对 4 步创作链路的影响

### Step 1：无影响

故事核心不需要参考书分析的这些数据。

### Step 2：世界构建

| 子模块 | 影响 |
|---|---|
| 架构选择 | 无变化——ArchitectureProfile 已覆盖 |
| 力量体系树 | 无变化 |
| 世界规则 | 无变化 |
| 金手指 | 新：AI 生成时注入设计模式作为 few-shot 参考 |

### Step 3：角色阵容

| 影响 | 说明 |
|---|---|
| 回环叙事分析 | 生成角色时参考每个回环的角色变化（protagonistChange）——约束每个阶段的角色功能 |

### Step 4：章节大纲

| 影响 | 说明 |
|---|---|
| 回环骨架 | 新：注入回环叙事分析（narrativeFunction 模板） |
| 卷展开 | 新：注入节奏曲线（rhythmTemplate + cycle stats） |
| 期待管理 | ArchitectureProfile 已覆盖 |

### 写作阶段

| 影响 | 说明 |
|---|---|
| 章节写作 | 新：注入三页统计（开场模式、对白密度、描写分布） |
| 已有 | 写法技法已在 context 中 |

---

## 五、实现顺序

不分步提交——一次性重写完整管道和前端。四个文件：

| 文件 | 改动 |
|---|---|
| `referenceDeepAnalysis.ts` | 完全重写。输入 profile → 输出 AnalysisResult JSON |
| `schema.prisma` | ReferenceProfile：删所有独立列，加 `analysisResult` |
| `ReferenceCockpitPage.tsx` | 删 loadProfile 中的兼容逻辑，统一从 analysisResult 读取 |
| `productionPrompts.ts` | `novel.chapter.annotate` 加 openingType 字段 |

---

## 六、Token 成本估算

| 阶段 | 213 章（三体） | 2000 章（大书） |
|---|---|---|
| 逐章标注（含 openingType） | 74 批 × 15 章 | 133 批 × 15 章 |
| 回环叙事（26/38 回环） | 26 次 AI 调用 | 38 次 AI 调用 |
| 金手指设计模式 | 1 次 AI 调用 | 1 次 AI 调用 |
| 节奏曲线/三页统计 | 0（纯统计） | 0（纯统计） |
| **总计（增量）** | **+27 次调用** | **+39 次调用** |

相对于已有的 74 批标注的 74 次调用，增加约 36%（小书）~29%（大书）。
