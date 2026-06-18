# 参考书深度分析管道 — 完整功能逻辑

## Phase 0：上传与解析

用户上传 epub/txt → 客户端 JSZip（epub）或 FileReader（txt）提取全文 → `POST /profiles` 创建 ReferenceProfile → 原文存入 `content` 列。

epub 解析流程：
1. JSZip 解压 ZIP 包
2. 找 `*.opf` 文件 → 解析 `<spine>` 获取阅读顺序
3. 按 spine 顺序提取所有 HTML/XHTML 文件
4. 去 HTML 标签、去 style/script 块、解码 HTML 实体（`&nbsp;` → 空格、`&lt;` → `<` 等）
5. 拼接为纯文本

---

## Phase 1：章节解析（纯正则，不调 AI）

输入：`profile.content`（原始文本，可达 1200 万字符）

处理：4 组正则扫描全部章节边界
- `第X章/节/回`：支持中文数字（一/二/三...）和阿拉伯数字
- `Chapter X`：英文格式
- 纯数字标题：`123. 标题` 或 `123、标题`（限定 2-40 字标题以防误匹配）
- `卷X`：中文章节分卷标记

去重：相邻匹配位置 < 50 字符的视为同一章（不同正则命中同一位置），只保留第一个。

排序：按原文位置升序排列，重新编号为 1,2,3...

输出：`ParsedChapter[]`，每条包含：
- `index`：1-based 序号
- `title`：提取到的标题文本
- `startChar`：在原文中的起始字符位置
- `endChar`：下一章起始位置（或文末）
- `wordCount`：endChar - startChar，粗略字数估算

---

## Phase 2：逐章标注（AI 批处理）

输入：`ParsedChapter[]` + 原文全文

### 动态批次大小

```
avgChapterSize = Σ(每章wordCount) / 总章数
batchSize = clamp(5, floor(60000 / avgChapterSize), 15)
```

短章多放（最多 15 章/批），长章少放（最少 5 章/批），确保每批不超过 60K 字符。

### 每批操作

1. 从原文切片提取该批每章的完整内容（`ch.startChar` 到 `ch.endChar`，**不做任何截断**）
2. 构造 userPrompt：
   - 批注 N 章（批次 X/Y）
   - 章节目录：第1章 标题、第2章 标题、...
   - 每章全文（以 `=== 第X章 标题 ===` 分隔）
3. 调用 `novel.chapter.annotate` 注册 prompt（系统 prompt 在 `productionPrompts.ts` 中，包含全部类型定义和判断规则）
4. AI 返回每章的标注数据
5. `nullToUndefined()` 全局预处理（AI 返回 `null` 的可选字段转为 `undefined`，Zod 的 `.optional()` 只认 `undefined`）
6. Zod schema 验证
7. 结果加入 `results[]`
8. `JSON.stringify(results)` 写入 `profile.chapterAnnotations`（断点续传）

### 每章标注字段

| 字段 | 说明 | 可选值 |
|---|---|---|
| `chapterType` | 章节类型 | advance(推进)/transition(过渡)/cooldown(冷却)/climax(高潮) |
| `coolPointLevel` | 爽点等级 | high(高)/medium(中)/low(低) |
| `hookType` | 章尾钩子类型 | suspense(悬念)/reversal(反转)/preview(预告)/emotional(情绪) |
| `contentBeat` | 主要节拍类型 | 修炼/显圣/赚钱/恋爱/日常/过渡/说明/调查/推理/战斗 |
| `secondaryBeat` | 次要节拍 | 同上（可选，可为空） |
| `conflictIntensity` | 冲突强度 | 1-10 |
| `summary` | 一章概括 | 15-30 字 |

### 重试机制

每批最多 3 次调用，失败后指数退避（2s, 4s），三次全失败则管道中断。

### 断点续传

每次运行时先读 `profile.chapterAnnotations`，如果已存在则加载已有标注矩阵，跳过已标注的批次，只标注剩余章节。所有 738 章标注完成后保留 `chapterAnnotations`，下次运行直接跳过 Phase 2。

---

## Phase 3：回环推断（统计预检测 + AI 验证）

输入：738 条 `ChapterAnnotation[]`

### 步骤 1：统计预检测

- 找到所有 `chapterType === "climax"` 的章节（高潮章 = 回环终点候选）
- 构造标注摘要：每章一行 `第X章 type=advance cool=medium conflict=5 hook=suspense`
- 检测冲突强度从高回落的拐点（climax 章 conflict≥8，随后章节 conflict≤4）

### 步骤 2：AI 验证

调用 `reference.loop.infer` 注册 prompt（系统 prompt 在 `referencePrompts.ts` 中）。userPrompt 包含：
- 高潮章位置列表
- 标注摘要（截取前 8000 字）
- 推断原则（回环的 setup→progress→pressure→turn→payoff→cooldown 模式）

AI 返回：`{ loops: [{ startChapter, endChapter, triggerHint }] }`

### 步骤 3：格式转换

AI 输出格式：`{ startChapter: 1, endChapter: 18 }`

客户端需要格式：`[{ chapterIndex: 1, type: "start" }, { chapterIndex: 18, type: "end" }]`

```typescript
loops.flatMap(l => [
  { chapterIndex: l.startChapter, type: "start", loopIndex: l.loopIndex },
  { chapterIndex: l.endChapter, type: "end", loopIndex: l.loopIndex },
]).sort((a, b) => a.chapterIndex - b.chapterIndex)
```

输出：38 个回环 → 76 条边界记录。存入 `profile.loopBoundaries`。

---

## Phase 4：统计合成 ArchitectureProfile

输入：738 条 `ChapterAnnotation[]` + 38 个 `LoopBoundary[]`

**全部从标注矩阵统计，不调 AI。** 非拍脑袋，非采样估算。

### chapterTypeDistribution

```
advance 章数 / 738 × 100 → 百分比
transition / cooldown / climax 同理
四个百分比相加 = 100%
```

### avgChaptersPerLoop

```
38 个回环的 estimatedChapters 集合
min = 最小回环章数
max = 最大回环章数
avg = 总和 / 38
```

### avgChapterWordCount

```
738 章 wordCount 集合
min/max/avg 直接从 ParsedChapter.wordCount 计算
```

### coolPointRecipe

统计所有 `coolPointLevel === "high"` 的章节中，每种 contentBeat 的出现次数：

```
collect  = 修炼+赚钱类型中 high 章数 / 总 high 章数 × 100
strategy = 调查+推理类型中 high 章数 / 总 high 章数 × 100
faceSlap = 显圣类型中 high 章数 / 总 high 章数 × 100
reveal   = 说明类型中 high 章数 / 总 high 章数 × 100
upgrade  = 其余 high 章（战斗等）/ 总 high 章数 × 100
verify   = 0（逐章标注无法判断验证型爽点，按 0 处理）
```

六个百分比相加 = 100%。

### hookProfile

```
hookType 四种类型的计数 / 738 → hookDistribution 百分比
shortTermPerChapter = (suspense + reversal 章数) / 738（取一位小数）
mediumTermPerVolume = 回环数 / (738 / 100)（每 100 章的回环数）
longTermLines = 738 / 100（全书主线数）
```

### contentBeatProfile

```
每种 contentBeat 的出现次数 / 738 → 百分比
secondaryBeat 按 0.5 权重计入主要节拍统计
```

### characterSystem

从 conflictIntensity 平均值和总章数推算（非逐章标注直接统计——角色信息不在逐章标注中）：

```
avgTotal = 8 + avgConflict × 1.5
roleDistribution 按经验比例分配
avgChaptersBetweenAppearances = 总章数 / 15
avgCharactersPerChapter = 2 + avgConflict / 3
```

### payoffPatterns

从回环结构推断：

```
avgSeedToPayoffChapters = 总章数 / 回环数 × 0.7
seedsPerVolume = 总章数 / 20
typicalPayoffWindow = 总章数 / 回环数
```

### loopPhases

使用标准 7 阶段定义（trigger/enter/explore/setback/turn/climax/settlement），每阶段的 typicalChapterRange 从 avgChaptersPerLoop 按经验比例分配。

输出：完整的 `ArchitectureProfile` 对象。存入 `profile.architectureProfile`（JSON 字符串）。

---

## Phase 5：写法技法提取

输入：全文 + `ChapterAnnotation[]`

### 步骤 1：找代表性章节

从标注矩阵中按场景类型筛选：
- 第一个 `chapterType === "climax"` 的章 → 高潮场景样本
- 第一个 `chapterType === "cooldown"` 的章 → 日常场景样本
- 第一个 `chapterType === "advance"` 的章 → 推进场景样本

对每章用正则从原文中提取章节内容（前 3000 字）：
```
RegExp(`第${chapterIndex}[章節节回].*?(?=第\\d+[章節节回]|$)`, "s")
```

### 步骤 2：构造 userPrompt

三个样本拼接：
```
【高潮场景样本】\n...\n\n【日常场景样本】\n...\n\n【推进场景样本】\n...
```

### 步骤 3：AI 调用

调用 `reference.writing_assets.extract` 注册 prompt。AI 从三种场景中提取 5 维技法：

| 维度 | 键名 | 每条技法包含 |
|---|---|---|
| 叙事技法 | `narrativeAssets` | category, observation（对标书做法 50-150 字）, rule（可模仿规则 50-150 字）, confidence（0-1） |
| 语言风格 | `languageAssets` | 同上 |
| 角色塑造 | `characterAssets` | 同上 |
| 节奏控制 | `rhythmAssets` | 同上 |
| 反AI特征 | `antiAiAssets` | 同上 |

输出：`WritingTechniques` 对象。存入 `profile.writingAssets`。同时赋值到 `architectureProfile.writingTechniques`。

在章节写作时，`contextBlockBuilders.ts` 读取 `novel.architectureProfile.writingTechniques`，以 `priority=76` 注入 `writing_techniques` 上下文块，5 维规则全部作为 style_contract 的一部分送入 AI。

---

## Phase 6：金手指提取

输入：全文（前 80K 字——网文金手指几乎都在前几章揭示完毕）

### AI 调用

- 调用 `reference.golden-finger.extract` 注册 prompt（系统 prompt 在 `referencePrompts.ts` 中）
- userPrompt = `text.slice(0, 80000)`（纯内容，无内联指令）
- AI 输出：`{ abilities: string[], limits: string[], goldenFingerName?: string }`
- Zod schema 验证
- 非致命错误：失败不中断管道，`goldenFingerBounds` 保持 `null`

### 为什么是全文级而非逐章

金手指是角色的全局能力设定，不属于某一章。AI 需要从全书内容中推断金手指的全貌。

### 为什么是前 80K 字

网文通常在开篇几万字内就完成金手指的设定和首次展示。后续章节是能力的使用和进化，理论上也应该看，但 80K 字已是上下文窗口的上限。

输出：`{ abilities, limits, goldenFingerName }`。存入 `profile.goldenFingerBounds`。

---

## Phase 7：设定时间线提取

输入：全文（前 80K 字——核心世界观设定通常在前期揭示）

### AI 调用

- 调用 `reference.setting-timeline.extract` 注册 prompt
- userPrompt = `text.slice(0, 80000)`
- AI 输出：`[{ chapterIndex: number, settingName: string, description: string, category: string }]`
- category ∈ { 力量体系, 世界历史, 角色秘密, 势力格局, 地理环境, 其他 }
- chapterIndex 无法确定时填 0（从开头内容推断）
- Zod schema 验证
- 非致命错误

输出：`SettingTimelineItem[]`。存入 `profile.settingTimeline`。

---

## 前端展示

### 数据加载（loadProfile）

`GET /profiles/:id` → 得到 profile 对象。

如果 `profile.architectureProfile` 存在（深度分析产出），从其中提取所有字段并转换为 Section 组件期望的格式：

| 展示维度 | 数据来源 | 格式转换 |
|---|---|---|
| 回环推断 | `p.loopBoundaries` JSON 数组 | 直接解析 `[{chapterIndex, type}]` |
| 爽点分布 | `p.coolPointDensity` JSON | `{highCoolChapters: number[], lowCoolChapters: number[]}` |
| 钩子模式 | `archProfile.hookProfile` | `hookDistribution` → `{distribution, avgHookStrength: 0.7, typicalHookStyle}` |
| 金手指 | `p.goldenFingerBounds` JSON | `{abilities: string[], limits: string[]}` |
| 设定时间线 | `p.settingTimeline` JSON | `[{chapterIndex, settingName, description, category}]` |
| 内容节拍 | `archProfile.contentBeatProfile` | `{[beat]: %}` → `{beatTypes, overallDistribution, totalChapters}` |
| 写法技法 | `p.writingAssets` JSON | 直接解析 5 维数组 |

如果 `architectureProfile` 不存在（旧分析数据），走独立列读取（向后兼容）。

### Section 组件

每个维度显示一行状态栏：
- 绿色 ✓ 图标 → 已完成
- 摘要文字（如 "38轮回环"、"15项能力 · 8条限制"）
- "查看详情"按钮 → 弹出模态框展示完整数据

### ArchitectureProfile 概览卡片

在 Section 列表上方展示：
- 章节类型分布（4 种百分比徽章）
- 爽点配方（彩色条形图 + 百分比标签）
- 钩子密度（每章/每卷/长线）
- 伏笔回收窗口
- 内容节拍 Top 6 标签
- 平均章节字数 + 平均回环章数

---

## 数据流总结

```
上传 epub/txt
    │
    ▼
Phase 1: parseChapters()           → 738 章 ParsedChapter[]
    │
    ▼
Phase 2: batchAnnotateChapters()   → 738 条 ChapterAnnotation[]（存入 chapterAnnotations）
    │
    ▼
Phase 3: detectLoopBoundaries()    → 38 个 LoopBoundary（存入 loopBoundaries）
    │
    ▼
Phase 4: synthesizeProfile()       → ArchitectureProfile（存入 architectureProfile）
    │
    ├── Phase 5: extractWritingTechniques()  → WritingTechniques（存入 writingAssets）
    ├── Phase 6: AI golden finger            → goldenFingerBounds（存入 goldenFingerBounds）
    └── Phase 7: AI setting timeline         → settingTimeline（存入 settingTimeline）
    │
    ▼
前端 loadProfile() 读取 architectureProfile + 独立列
    │
    ▼
Section 组件展示 7 个维度 + ArchitectureProfile 概览卡片
```
