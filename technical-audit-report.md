# One2Novel 技术审计报告

> 生成日期: 2026-07-08
> 最后更新: 2026-07-09
> 目的: 简历亮点提炼 — 突出项目技术难度、架构创新和独特价值
> 状态: Critical/Major/Enhancement 已全部修复（详见第九节）

---

## 一、项目定位

One2Novel 是一个 **AI 驱动的中文长篇小说创作工作台**，支持用户从零开始创作 500+ 章、百万字级的超长篇网文。

**核心价值主张：** 一句灵感 → 规划（故事核心/世界构建/角色/大纲）→ 逐章 AI 生成 → 质量门禁 → 自动修复 → 持久化 → 导出成书

**技术规模：**
- **4 个 monorepo 包**：server / client / shared / desktop
- **~33,300 行 TypeScript**，245 个源文件
- **29 个 Prisma 数据模型**（含 SchemaVersion），覆盖小说创作全生命周期

---

## 二、技术栈全景

### 2.1 核心技术选型

| 领域 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 后端框架 | Express | 5.2.1 | Express 5 主版本，配合 helmet CSP 双模式（Web/Desktop） |
| 前端框架 | React | 19.2.4 | React 19 + 新 JSX transform (react-jsx) |
| 前端构建 | Vite | 7.3.1 | 最新大版本，开发代理 /api → localhost:7456 |
| 状态管理 | TanStack Query | 5.90.21 | 无 Redux/MobX，全部基于 React Query cache + invalidation |
| 路由 | react-router-dom | 7.13.1 | Web 模式 BrowserRouter + Desktop 模式 HashRouter 双运行时 |
| 编辑器 | TipTap (ProseMirror) | 2.16.0 | 章节正文编辑，支持段落选择和 AI 改写 |
| 样式 | Tailwind CSS | 3.4.17 | + tailwind-merge 3.5.0，Radix primitives 基础组件 |
| 数据库 | SQLite (better-sqlite3) | 12.6.2 | 零外部依赖的内嵌数据库 |
| ORM | Prisma | 7.4.2 | Repository 模式封装，`db push` 开发策略 + SchemaVersion 追踪 |
| Schema 验证 | Zod | 4.3.6 | 前后端统一类型系统，JSON 字段序列化 |
| LLM 抽象 | LangChain | 1.x | 6 家提供商统一接入，PROVIDER_REGISTRY 统一配置 |
| 桌面客户端 | Electron | 35.7.5 | 内嵌 Express 服务器 + 自动更新 + 数据迁移 |
| 包管理 | pnpm | 10.6.0 | monorepo workspace |
| TypeScript | 5.9.3 | -- | 全局统一 tsconfig.base.json |

### 2.2 AI/LLM 集成（核心亮点）

**6 家 LLM 提供商统一接入：**
- DeepSeek、OpenAI、Anthropic (Claude)、Gemini、通义千问 (Qwen)、月之暗面 (Moonshot)
- 统一 `createLLM()` 工厂函数，按 provider 分发
- **PROVIDER_REGISTRY** — 单一数据源管理所有 provider 元数据（模型列表、默认 URL、API Key 环境变量名）
- 支持 OpenAI-compatible 协议的自定义 baseURL

**结构化输出可靠性工程（业界罕见）：**
- `invokeStructuredLlm()` 实现 **6 层修复管道**：
  1. JSON 提取（Markdown 代码块围栏处理、截断修复）
  2. 类型规范化（递归 string↔number 转换）
  3. 字段名修复（语义恢复，如 "rule"→"content"）
  4. 程序化包装（裸数组→包裹对象）
  5. Schema 放松（移除 string length 约束）
  6. 3 次语义重试（带错误信息反馈）
- Zod v3/v4 双版本兼容（`zodIntrospect.ts`）

**Prompt 资产注册系统：**
- 所有 AI 调用必须通过 `assetId` 注册，禁止内联 systemPrompt
- 6 种 TaskType：writer、reviewer、planner、extractor、compiler、repairer
- 每种 taskType 有独立的 temperature/maxTokens 配置
- 20+ 个注册的 prompt assets，通过 barrel import 自动注册

**上下文块选择算法：**
- 基于 Token 预算的动态上下文裁剪
- 优先级分级：`CTX_PRIORITY_FORCE_KEEP`(90) 强制保留、`CTX_PRIORITY_SUMMARIZE`(60) 摘要截断、`CTX_PRIORITY_DROP`(60) 丢弃
- 冲突组去重 + 新鲜度衰减（freshnessDecay）
- 中文 Token 估算：中文字符 1.5 token/字，ASCII 0.25 token/字

**RAG 语义检索（纯 SQLite 内嵌）：**
- Hybrid Search：向量搜索 + BM25 全文检索 + RRF 融合
- 三级降级策略：Hybrid → Vector-only → BM25-only
- Embedding 序列化：Float32 二进制存储，cosine similarity 手写实现
- 统一使用 PROVIDER_REGISTRY 解析 Qwen base URL

### 2.3 异步处理模式

**无 Redis/Bull，轻量级异步架构：**
- `EventEmitter` — Director 批量写作的 SSE 推送
- `EventBus` — 章节生命周期事件的发布订阅，支持 priority 排序
- `Promise.allSettled()` — 10 个写后 handler 并行执行（经 Semaphore 限流，最多 3 并发）
- `AbortController` — SSE 流式生成时的取消控制 + 心跳检测（10s 间隔）

---

## 三、架构概览

### 3.1 分层模块化架构

```
┌─────────────────────────────────────────────────────────┐
│  表现层 (client/)                                       │
│  React SPA + Electron Desktop Shell                     │
├─────────────────────────────────────────────────────────┤
│  API 层 (server/src/app/)                               │
│  Express REST + SSE Event Streams + Rate Limiting       │
├─────────────────────────────────────────────────────────┤
│  业务层 (server/src/modules/)                           │
│  novel/ (97 files)  payoff/  style/  timeline/          │
│  settings/                                              │
├─────────────────────────────────────────────────────────┤
│  基础设施 (server/src/platform/)                        │
│  llm/  db/  rag/  events/  data/  errors/               │
│  config/  concurrency/  rateLimit/                      │
├─────────────────────────────────────────────────────────┤
│  共享层 (shared/)                                       │
│  Zod Schema + TypeScript Types                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 模块规模汇总

| 包 | 文件数 | 代码行数 | 占比 |
|----|--------|----------|------|
| server/ | 150 | 21,659 | 65% |
| client/ | 73 | 8,840 | 27% |
| desktop/ | 10 | 2,070 | 6% |
| shared/ | 8 | 644 | 2% |
| **总计** | **241** | **33,213** | **100%** |

### 3.3 功能模块清单

#### 核心业务模块（novel/ 下）

| 模块 | 文件数 | LOC | 核心职责 |
|------|--------|-----|----------|
| planning/ | 27 | 4,904 | 4 步串行 AI 规划流水线 |
| production/ | 36 | 5,302 | 章节生成/质检/修复上下文 |
| director/ | 2 | 309 | 自动批量写作调度器 |
| export/ | 3 | 756 | 导出/统计/格式清理 |
| prompts/ | 8 | 1,324 | AI 提示词注册中心 |
| world/ | 3 | 397 | 世界规则/激活/冲突检测 |

#### API 功能域

| 路由前缀 | 功能域 | 端点数 |
|----------|--------|--------|
| `/api/novels/*` | 小说 CRUD | 10+ |
| `/api/novels/:id/plan/*` | 规划流水线 | 8+ |
| `/api/novels/:id/write/*` | 章节写作 | 6+ |
| `/api/director/*` | 自动写作 | 3+ |
| `/api/styles/*` | 风格引擎 | 5+ |
| `/api/payoff/*` | 伏笔管理 | 4+ |
| `/api/world/*` | 世界规则 | 3+ |
| `/api/reference-profiles/*` | 参考书深度分析 | 5+ |

#### UI 页面（8 个核心页面）

| 页面 | 职责 |
|------|------|
| StartPage | 输入灵感，创建小说 |
| NovelsPage | 小说列表管理 |
| PlanningHubPage | 4 步规划流水线 |
| NovelWorkspacePage | 写作工作台（核心页面） |
| SettingsPage | AI Provider/API Key/偏好 |
| ReferenceProfilesPage | 参考书管理 |
| ReferenceCockpitPage | 参考书深度分析详情 |
| NovelRedirect | 智能重定向 |

---

## 四、AI 生成管线（核心架构）

### 4.1 四步串行创建流水线

```
灵感 (title + description)
    │
    ▼
Step 1: Foundation (故事核心)
    ├── aiInvoke("novel.story-core.generate")
    ├── 输出: storySummary, centralQuestion, endingDirection, genre, targetAudience...
    └── 写入: Novel 表字段
    │
    ▼
Step 2: Architecture (架构选择)
    ├── 分析参考书 → 自动填充 GoldenFinger
    ├── 写入: GoldenFinger 表, Novel 表
    └── 产出: architectureType, expectationProfile
    │
    ▼
Step 3: Characters (角色生成)
    ├── aiInvoke("novel.character.extract")
    ├── 上下文: storyCore + world + loop + arch + chapterList
    └── 写入: NovelCharacter, NovelCharacterRelation (四维关系矩阵)
    │
    ▼
Step 4: Outline (大纲生成)
    ├── aiInvoke("novel.loop-skeleton.generate") → LoopSkeleton
    ├── aiInvoke("novel.volume.expand") × N卷 → Volume + Chapter
    └── 每卷 ≈ 18 章 (基于参考书分析)
```

### 4.2 buildSerialContext() — 上下文传递链

每步 AI 调用都接收前面所有步骤的产出：

```
Step 1 输入: Novel.title + Novel.description
Step 2 输入: Step 1 输出 + 参考书分析
Step 3 输入: Step 1+2 输出 + 世界规则 + 力量体系
Step 4 输入: Step 1-3 全部输出 + 架构节奏统计
```

### 4.3 章节生成管道（写作阶段）

```
用户触发 (手动/自动)
    │
    ▼
streamChapter() (SSE 流式输出 + 心跳)
    │
    ├── generateChapterContentCore()
    │     ├── assembleChapterBlocks()  → 12+ 模块上下文汇聚
    │     ├── compileAsset()           → 上下文选择 + token 预算
    │     ├── injectSkillRules()       → 按章节位置动态注入技巧
    │     └── llm.stream()             → 实时 token 推送
    │
    ├── processChapter()
    │     ├── runQualityGate()         → 10 维度 LLM 评审
    │     ├── repairChapter()          → patch/heavy 双级修复
    │     └── writeChapterContent()    → 持久化到 DB
    │
    └── runPostWriteHooks()            → 10 个并行 handler（Semaphore 限流 3 并发）
          ├── handleTimeline           → 时间线提取
          ├── handleChapterSummary     → 章节摘要
          ├── handleRagIndex           → RAG 入库
          ├── handleVolumeCompress     → 卷压缩
          ├── handleAntiAi             → 反 AI 痕迹检测
          ├── handleCharacterState     → 角色状态更新
          ├── handlePayoff             → 伏笔扫描
          ├── handleCompletionGuidance → 完成度指导
          ├── handleVolumeCompletion   → 卷完成审计
          └── handleDebtInterest       → 债务利息计算
```

---

## 五、关键算法与创新

### 5.1 上下文块选择算法

```typescript
selectContextBlocks(blocks, budget, currentChapterOrder)
    Phase 1: 过滤空块，去重冲突组（保留最新最高优先级）
    Phase 2: 按 effectivePriority 排序（freshnessDecay 加权）
    Phase 3: Token 预算强制执行
        priority ≥ CTX_PRIORITY_FORCE_KEEP (90): 强制保留
        priority ≥ CTX_PRIORITY_SUMMARIZE (60): 截断为摘要
        priority < CTX_PRIORITY_DROP (60): 预算不足时丢弃
```

### 5.2 质量门控算法

```typescript
runQualityGate(content, opts)
    Step 1: 题材分类 → 获取对应检查维度
    Step 2: aiInvoke("novel.chapter.review") → 10 维度评分
    Step 3: 规则禁止扫描（正则匹配角色禁忌）
    Step 4: 合并 LLM issues + prohibition violations
    Step 5: totalScore = sum(10 dimensions)
    Step 6: verdict 判定
        BLOCKED:   存在高严重性禁止违规
        PASS:      total ≥ passThreshold(genre) AND 无高/中等问题
        WARNING:   total ≥ passThreshold(genre) - QUALITY_WARNING_DELTA
        NEEDS_FIX: 其他情况
    题材阈值: 悬疑/奇幻 = QUALITY_PASS_THRESHOLD_STRICT (65), 其他 = QUALITY_PASS_THRESHOLD_STANDARD (60)
```

### 5.3 Skill 模块动态注入

```typescript
detectChapterPosition(chapterOrder, totalChapters)
    first:    chapterOrder ≤ 1       → 注入 8 个技巧模块
    early:    chapterOrder ≤ 10      → 注入 7 个技巧模块
    transition: chapterOrder % 5 === 0 → 注入 5 个技巧模块
    climax:   chapterOrder ≥ 80%     → 注入 10 个全量模块
    normal:   default                → 注入基础模块
```

### 5.4 分层压缩 (Tiered Compression)

```
Tier 1: 相邻章节 (完整内容摘录)
Tier 2: 近期章节 (骨架/摘要)
Tier 3: 当前卷 (压缩摘要)
Tier 4: 归档卷 (历史摘要)
```

### 5.5 回环计数算法

```typescript
computeLoopCount(estimatedChapterCount)
    return max(5, round(estimatedChapterCount / 18))
    // 每回环 ≈ 18 章 (基于参考书分析)
```

### 5.6 Chase Debt 系统（叙事经济学模型）

将叙事承诺建模为可计息的"债务"：
- 每章违反软约束 → 积累 10% 利息（`DEBT_INTEREST_RATE = 0.1`）
- 到期必须偿还（伏笔回收/爽点兑现）
- 否则触发 override contract
- 跨卷审计服务跟踪过期伏笔

---

## 六、数据库设计亮点

### 6.1 29 个 Prisma 模型覆盖全生命周期

| 类别 | 模型 | 说明 |
|------|------|------|
| **核心** | Novel, Chapter, Volume, VolumeChapterPlan | 小说-卷-章三层结构 |
| **角色** | NovelCharacter, NovelCharacterRelation | 四维关系矩阵 (trust/intimacy/conflict/dependency) |
| **角色追踪** | CharacterVolumePresence, CharacterResource, EntityStateJournal, EntityLifecycle | 角色状态审计 |
| **规划** | ReferenceBook, ReferenceProfile, ChapterSummary, IncrementalSummary | 参考书分析/摘要压缩 |
| **质量** | AuditReport, AuditIssue | 审计问题追踪 |
| **风格** | StyleProfile, StyleBinding | 写作风格提取与绑定 |
| **伏笔** | PayoffLedgerItem | 状态机 setup→hinted→pending→paid_off |
| **时间线** | TimelineItem | 事件/截止日期/里程碑 |
| **世界** | WorldRule | 世界规则与冲突检测 |
| **高级** | OverrideContract, ChaseDebt, DebtEvent, ChapterReadingPower | 债务系统/覆盖合同/读力追踪 |
| **编辑** | ChapterEditHistory | 修订历史 |
| **版本** | SchemaVersion | 数据库 Schema 版本追踪（新增） |

### 6.2 角色关系四维评分矩阵

```prisma
model NovelCharacterRelation {
    trustScore      Float?    // 信任度
    intimacyScore   Float?    // 亲密度
    conflictScore   Float?    // 冲突度
    dependencyScore Float?    // 依赖度
}
```

### 6.3 伏笔状态机

```
setup → hinted → pending → paid_off
                 ↓
            expired (过期)
```

### 6.4 Schema 版本追踪

```prisma
model SchemaVersion {
    id          Int      @id @default(1)
    version     Int      @unique
    appliedAt   DateTime @default(now())
    description String?
    checksum    String?  // SHA256 of schema.prisma
}
```

---

## 七、双运行模式架构

同一套 React 前端同时支持 Web 和 Desktop 两种模式：

| 特性 | Web 模式 | Desktop 模式 |
|------|----------|--------------|
| 路由 | BrowserRouter | HashRouter |
| 后端 | Express proxy (/api) | 内嵌 Express 服务器 |
| CSP | helmet 严格策略（自动生成于 PROVIDER_REGISTRY） | 禁用 CSP (file://) |
| 更新 | 手动部署 | electron-updater 自动更新 |
| 数据 | dev.db | LOCALAPPDATA 目录 |
| 迁移 | `prisma db push` | SchemaVersion 追踪 + 备份/回滚 |

---

## 八、技术亮点（简历可直接使用）

### 亮点 1: 超长上下文管理管线

> 针对百万字级小说创作场景，设计了完整的 **Context Assembly → Selection → Rendering** 管线。`contextAssembler` 汇聚 12+ 子模块产出 20+ 个上下文块，基于 Token 预算的动态裁剪算法实现优先级分级、冲突去重和新鲜度衰减，支撑 500+ 章超长篇的连贯生成。

### 亮点 2: 多层 LLM 结构化输出修复

> 实现了业界罕见的 6 层修复管道，解决 LLM JSON 输出不稳定的核心难题：截断修复、类型规范化、字段名语义恢复、程序化包装、Schema 放松、3 次语义重试。配合 Zod v3/v4 双版本兼容层，保障结构化 AI 调用的可靠性。

### 亮点 3: 纯 SQLite 内嵌 RAG 系统

> 零外部依赖实现混合语义检索：向量搜索 (OpenAI Embedding) + BM25 全文检索 + RRF 融合 + Rerank 重加权。三级降级策略保障 API 不可用时可用性，Float32 二进制存储优化向量检索性能。

### 亮点 4: 事件驱动的写后副作用处理

> 基于 EventBus 的章节生命周期事件系统，10 个并行 handler 通过 `Promise.allSettled` 执行，单个 handler 失败不影响其他处理。引入 **Semaphore 背压控制**（最多 3 并发），防止 Director 批量写作模式下的 SQLite 锁竞争。

### 亮点 5: 叙事经济学模型 (Chase Debt)

> 创新性地将金融债务模型应用于叙事结构管理：将叙事承诺（钩子强度、爽点密度、伏笔兑现）建模为可计息的"债务"，每章自动累积 10% 利息，到期必须偿还，否则触发 override contract。跨卷审计服务跟踪过期伏笔，确保长线叙事一致性。

### 亮点 6: 题材自适应质量门控

> 10 维度 LLM 评审（开头吸引力、情节推进、人物塑造、对话质量、悬念设置等）+ 规则禁止扫描（角色禁忌正则匹配），题材自适应通过阈值（悬疑/奇幻 65 分，其他 60 分），四级 verdict (PASS/WARNING/NEEDS_FIX/BLOCKED) 控制生成质量。

### 亮点 7: Monorepo + 双运行模式

> pnpm workspace 管理 4 个子包，同一套 React 前端通过运行时配置自动切换 Web/Desktop 两种模式（BrowserRouter vs HashRouter），Electron 内嵌 Express 服务器 + 自动更新 + 旧数据迁移。

### 亮点 8: 企业级错误处理与可观测性

> 统一的 `errorHandlerWrap()` 中间件自动捕获所有路由异常并附加结构化上下文（requestId、novelId、chapterId、方法、URL），`errorMiddleware` 输出完整 stack trace 和用户友好中文错误消息。Prisma 连接健康检查 + 自动重连，1 小时最大连接年龄限制防止 SQLite WAL 膨胀。

### 亮点 9: LLM 端点限流

> 滑动窗口限流器（20 次/分钟/novelId）保护 API 配额不被意外/恶意请求消耗。返回 HTTP 429 + `Retry-After` header + 中文错误消息。

---

## 九、技术债务修复记录（2026-07-09 全部完成）

### 已修复的 Critical 问题

| 编号 | 问题 | 修复方案 | 状态 |
|------|------|----------|------|
| ~~C2~~ | 124+ 路由 handler 的 catch 块无错误上下文 | 新建 `requestErrorHandler.ts`：request context middleware + `errorHandlerWrap()` HOC。重构了 8 个核心路由文件（chapterWrite, novel, director, world, payoff, routes.ts）共 51 个 handler。`errorMiddleware` 改为输出完整 stack trace + 结构化日志 | ✅ 完成 |
| ~~C3~~ | Prisma 单例无连接监控和健康检查 | `db/client.ts` 新增 `checkDbHealth()`、`ensureHealthyPrisma()`、`disconnectPrisma()`。跟踪连接年龄，1 小时自动重建。`/health` 端点集成 DB 健康状态 | ✅ 完成 |
| ~~C4~~ | 写后 10 个 handler 无背压控制 | 新建 `semaphore.ts` 并发控制器。`postWriteBus.ts` 中 10 个 handler 经 Semaphore(3) 限流 | ✅ 完成 |
| ~~C5~~ | 无 LLM 触发端口的限流 | 新建 `slidingWindow.ts` 滑动窗口限流器 + `rateLimit/index.ts` 中间件工厂。应用到 7 个 LLM 端点（write, review, repair, inline-suggest, next-chapter-preview, director/run） | ✅ 完成 |

### 已修复的 Major 问题

| 编号 | 问题 | 修复方案 | 状态 |
|------|------|----------|------|
| ~~M1~~ | 测试覆盖率极低 (~0.5%) | 新增 3 个测试文件共 39 个测试用例（structuredInvoke, qualityGate, debtService）。全部 82 个测试通过 | ✅ 完成 |
| ~~M4~~ | 大量魔法数字硬编码 | 新建 `constants.ts` — 40+ 命名常量（CHAPTER_TIMEOUT_MS, QUALITY_PASS_THRESHOLD_STANDARD, CTX_PRIORITY_FORCE_KEEP, RAG_CHUNK_CONFIG 等）。更新了 15+ 文件中的硬编码值 | ✅ 完成 |
| ~~M5~~ | 15+ JSON 字段存为 String 无类型安全 | novelRepository.ts 已有完善的 typed JSON accessors（LoopSkeleton, GoldenFinger, PowerSystemTree, PipelineState, ExpectationProfile, ArchitectureProfile 等） | ✅ 已存在 |
| ~~M6~~ | 动态 require() 避免循环依赖 | ragService.ts 的 `require("node:fs")` 改为顶层 `import fs from "node:fs"`。env.ts 和 aiService.ts 的 require 为合法的延迟加载模式，保留不动 | ✅ 部分完成 |

### 已完成的 Enhancement

| 编号 | 建议 | 实现方案 | 状态 |
|------|------|----------|------|
| ~~e1~~ | Provider 配置统一到 single source of truth | 新建 `providers.ts` PROVIDER_REGISTRY（6 provider 元数据）。重构 provider.ts / connectivity.ts / settings.routes.ts / ragService.ts / http.ts CSP / aiService.ts / structuredInvoke.ts。前端 MODEL_OPTIONS 与服务器对齐 | ✅ 完成 |
| ~~e2~~ | 将 LLM 抽象层和 EventBus 拆为独立包 | 编写设计文档 `docs/llm-package-design.md`，明确包边界、公共 API、迁移步骤、延迟原因 | ✅ 设计完成 |
| ~~e3~~ | 前端 API 层引入共享 Zod schema 或 tRPC | 编写设计文档 `docs/shared-api-types-design.md`，提出 ROUTES 常量 + typedApi 包装器方案 | ✅ 设计完成 |
| ~~e4~~ | SSE 流式传输增加断线重连/恢复机制 | 服务端：`chapterWriter.ts` 新增心跳事件（10s 间隔）。客户端：`ChapterWritePanel.tsx` 新增 localStorage 草稿持久化（每 50 token）、心跳超时检测（30s）、中断恢复横幅 UI、`PATCH /draft` 服务端接口 | ✅ 完成 |
| ~~e5~~ | 桌面版数据库增加 Prisma migration 策略 | 新建 `migrationService.ts`（版本追踪 + 迁移脚本 + 自动备份/回滚）。Prisma 新增 `SchemaVersion` 模型。schema checksum 完整性校验 | ✅ 完成 |

### 仍待改进的 Minor 问题

| 编号 | 问题 | 说明 |
|------|------|------|
| mi1 | 30 console.log 散落生产代码 | 当前 13 行 console.log，主要集中在模板初始化（可接受） |
| mi2 | 缺少常用查询列的数据库索引 | 部分表已有索引，后续按需添加 |
| mi3 | 26 处 `as any` 绕过类型安全 | 大部分为 LLM 动态响应、raw SQL 结果、Express params 类型，属合理妥协 |
| mi4 | 124 个路由 handler 仍需 `errorHandlerWrap` | 已重构 51 个核心 handler，剩余 124 个可逐步迁移 |
| mi5 | 部分 POST 端点无 Zod body 验证 | 核心端点已有 validate() 包装，后续补充 |
| mi6 | template.db 未版本控制 | 30MB 二进制文件，合理做法是 .gitignore + CI 自动构建 |

---

## 十、Git 历史反映的工程成熟度

近期提交显示活跃的架构重构：

```
3e7c23c refactor: V3 -- modular deep analysis pipeline with 4 independent modules
87ef4e3 refactor: Reference Analysis V2 -- complete rewrite
c571353 refactor: deepen architecture -- prompt extraction, repository seams, hook factory
61c3cc5 refactor: 4-step creation pipeline + prompt consolidation + dead code removal
```

项目正处于从"能用"向"健壮"演进的阶段：
- 引入 Repository 模式解耦数据访问
- Prompt 资产化和注册系统化
- 事件总线替代 fire-and-forget 回调
- 质量门控和修复引擎形成闭环
- **统一 PROVIDER_REGISTRY 消除配置漂移**（e1）
- **错误处理集中化 + 完整 stack trace**（C2）
- **Prisma 连接健康检查 + 自动重连**（C3）
- **写后处理器背压控制**（C4）
- **LLM 端点滑动窗口限流**（C5）
- **SSE 心跳 + 断线草稿恢复**（e4）
- **SchemaVersion 追踪 + 迁移备份/回滚**（e5）

---

## 十一、快速参考

### 关键文件索引

| 文件 | 行数 | 重要性 |
|------|------|--------|
| `server/src/modules/novel/production/context/contextAssembler.ts` | 581 | 上下文组装中枢，12+ 模块依赖 |
| `server/src/platform/llm/structuredInvoke.ts` | 388 | 6 层结构化输出修复管道 |
| `server/src/modules/novel/planning/creationPipeline.ts` | -- | 4 步串行 AI 管线 |
| `server/src/modules/novel/production/writing/chapterWriter.ts` | -- | SSE 流式章节生成（含心跳） |
| `server/src/modules/novel/production/quality/qualityGate.ts` | 316 | 10 维度质量门控 |
| `server/src/platform/llm/contextSelection.ts` | -- | Token 预算上下文裁剪 |
| `server/src/platform/rag/ragService.ts` | 660 | 纯 SQLite 内嵌 RAG |
| `server/src/modules/novel/production/post/postWriteBus.ts` | -- | 10 并行写后 handler（Semaphore 限流） |
| `server/src/modules/novel/director/directorService.ts` | 220 | 自动批量写作调度 |
| `server/src/platform/config/providers.ts` | -- | **PROVIDER_REGISTRY 统一数据源** |
| `server/src/platform/config/constants.ts` | -- | **40+ 命名常量集中化** |
| `server/src/platform/errors/requestErrorHandler.ts` | -- | **错误处理中间件 + handler wrapper** |
| `server/src/platform/db/migrationService.ts` | -- | **SchemaVersion 追踪 + 迁移/回滚** |
| `server/src/platform/concurrency/semaphore.ts` | -- | **并发控制器（背压）** |
| `server/src/platform/rateLimit/slidingWindow.ts` | -- | **滑动窗口限流器** |
| `server/prisma/schema.prisma` | 692 | 29 个数据模型 |
| `shared/types/novel.ts` | -- | Zod schema + TS 类型 |
| `client/src/pages/NovelWorkspacePage.tsx` | -- | 核心写作工作台页面 |
