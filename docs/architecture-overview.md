# One2Novel 架构总览

> 最后更新：2026-07-08

## 一、项目定位

AI 驱动的长篇小说创作工作台。用户输入一句灵感 → 经过规划（故事核心/世界构建/角色/大纲）→ 进入写作模式（逐章生成→质检→修复→持久化）→ 自动写作（Director 批量生成）。

支持两种运行模式：**Web**（Express + Vite SPA）和 **Desktop**（Electron 内置 Express 服务器 + SQLite）。

---

## 二、整体目录结构

```
One2Novel/
├── client/                  # React SPA (Vite) — 桌面端和 Web 端共用
│   ├── src/
│   │   ├── main.tsx         # 入口：React Router + TanStack Query
│   │   ├── app/
│   │   │   ├── router.tsx   # 路由定义（7 个页面）
│   │   │   ├── api.ts       # Axios 实例（baseURL + 超时）
│   │   │   └── queryClient  # TanStack Query 配置
│   │   ├── pages/           # 页面组件
│   │   ├── components/      # UI 组件
│   │   ├── api/             # React Query hooks（重定向到后端路由）
│   │   └── lib/
│   │       └── constants.ts # API 地址/超时/运行时模式（web vs desktop）
│   └── package.json
│
├── server/                  # Express API 服务器
│   ├── src/
│   │   ├── app.ts           # 入口：创建 Express app + 启动监听
│   │   ├── app/
│   │   │   ├── http.ts      # Express 工厂（CSP / CORS / JSON parser）
│   │   │   └── routes.ts    # 路由注册中心（挂载所有子路由）
│   │   ├── modules/         # 业务模块
│   │   │   ├── novel/       # ★ 核心：小说创作全流程
│   │   │   ├── style/       # 写法风格（Profile → Binding → 注入）
│   │   │   ├── payoff/      # 伏笔管理（埋设→追踪→回收）
│   │   │   ├── timeline/    # 时间线（提取→冲突检测）
│   │   │   └── settings/    # 用户偏好/持久化
│   │   └── platform/        # 基础设施层
│   │       ├── db/          # Prisma + SQLite（better-sqlite3）
│   │       ├── llm/         # AI 调用统一接口
│   │       ├── data/        # Repository 模式
│   │       ├── config/      # 环境变量/路径解析
│   │       ├── events/      # EventBus
│   │       ├── logging/     # 结构化错误日志
│   │       ├── errors/      # AppError + 错误中间件
│   │       └── rag/         # RAG 语义检索
│   ├── prisma/
│   │   ├── schema.prisma    # 数据模型定义（SQLite）
│   │   └── template.db      # 空数据库模板（首次启动拷贝）
│   └── package.json
│
├── shared/                  # 前后端共享类型
│   ├── index.ts             # 统一导出
│   └── types/
│       ├── novel.ts         # Zod schema + TS 类型（Novel/Chapter/Volume 等）
│       └── architectureProfile.ts
│
├── desktop/                 # Electron 桌面壳
│   ├── src/
│   │   ├── main.ts          # Electron main process（启动内嵌服务器 + 窗口管理）
│   │   ├── preload.ts       # IPC 桥接
│   │   └── runtime/         # 服务器生命周期/更新器/数据导入/状态管理
│   └── builder/             # Electron Builder 打包配置
│
├── docs/                    # 项目文档
│   └── agents/              # Agent 指南（issue tracker / triage / domain）
│
├── package.json             # Monorepo 根（pnpm workspace）
├── pnpm-workspace.yaml
└── dev.db                   # 开发数据库（SQLite 文件）
```

---

## 三、运行模式

| 模式 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| **Web** | Vite dev server → Express `/api` 代理 | Express 独立进程 | SQLite（`dev.db`） |
| **Desktop** | Electron 加载本地 HTML 或 Vite URL | Express 内嵌进程（同机器） | SQLite（`%APPDATA%/One2Novel/data.db`） |

判断依据：`client/src/lib/constants.ts` 中的 `APP_RUNTIME` 变量 → `"web"` 或 `"desktop"`。

---

## 四、核心数据流

```
用户输入灵感
    │
    ▼
创建 Novel（shared/types/novel.ts Zod 校验 → server 入库）
    │
    ▼
规划流水线（Planning Hub）
  Step 1: Foundation  → AI 生成故事核心/商业定位
  Step 2: Architecture → AI 分析参考书 + 选择架构/生成金手指
  Step 3: Characters  → AI 生成角色阵容
  Step 4: Outline     → AI 生成回环骨架 → 逐卷展开 → 创建章节计划
    │
    ▼
进入写作模式（Novel Workspace）
  手动写作：ChapterWritePanel → SSE token 流 → chapterPipeline
  自动写作：DirectorPanel → DirectorService（批量循环）
    │
    ▼
每章写入 pipeline：
  assembleChapterBlocks → compileAsset → LLM.stream → processChapter
    │                                                    │
    │                                    ┌───────────────┤
    │                                    ▼               ▼
    │                              qualityGate      持久化到 DB
    │                                    │
    │                              分数<阈值?
    │                                    │
    │                                    ▼
    │                              repair（patch/heavy）
    │                                    │
    │                                    ▼
    │                              重新 qualityGate → 持久化
    │
    ▼
事后副作用（fire-and-forget）：
  - payoffService：扫描伏笔埋设/回收
  - timelineService：提取时间线事件 + 冲突检测
  - characterDynamics：角色动态更新
  - openConflict：冲突扫描
  - entityLifecycle：实体生命周期追踪
  - postWriteBus：后续处理总线
```

---

## 五、关键模块详解

### 5.1 创作流水线（CreationPipeline）

**职责**：小说从 0 到 1 的规划阶段，4 步串行 AI 生成。

**入口**：`server/src/modules/novel/planning/creationPipeline.ts`

**对外接口**：
- `runFoundation(novelId)` → 故事核心（简介/核心悬念/结局方向）
- `runArchitecture(novelId, params)` → 架构选择 + 金手指 + 参考书分析
- `runCharacters(novelId)` → 角色阵容
- `runOutline(novelId, mode)` → 回环骨架 + 逐卷展开 + 章节计划创建
- `expandVolume(novelId, volumeOrder)` → 单卷展开

**串行上下文**：`buildSerialContext()` 方法将前序步骤的输出注入后续 AI 调用的 userPrompt，保证每一步都基于上一步结果。

**状态跟踪**：`server/src/modules/novel/planning/pipelineState.ts` — PipelineState 对象存储在 Novel 表的 `pipelineState` JSON 字段。

**前端对应**：`PlanningHubPage.tsx` → `FoundationDomain.tsx` / `WorldDomain.tsx` / `CharactersDomain.tsx` / `BlueprintDomain.tsx`

**依赖链**：
```
creationPipeline
  ├─ storyCoreService     → AI 调用 (novel.story_core.framing)
  ├─ referenceDeepAnalysis/index.ts → 参考书深度分析（解析→标注→架构/金手指/写法）
  │     ├─ parse.ts       → 章节分割
  │     ├─ annotate.ts    → AI 逐章标注
  │     └─ modules.ts     → 回环检测/节奏分析/期待链
  ├─ characterPrep/characterService  → AI 生成角色
  ├─ architectureEngine/loopTemplateService → 回环骨架生成
  └─ referenceBookService → 参考书 CRUD + 写作资产提取
```

### 5.2 章节生成管道（Chapter Pipeline）

**职责**：单章内容从 AI 生成到质量过关的全流程。

**入口**：`server/src/modules/novel/production/writing/chapterPipeline.ts`

**核心函数**：`processChapter(novelId, chapterId, content, order)`

**流程**：
1. 收集上下文（类型/期望/角色禁令/上一章摘要/角色状态）
2. **Quality Gate**（`qualityGate.ts`）→ LLM 评审 10 个维度
3. 总分 ≥ 阈值 → PASS；否则触发 **Repair**
4. Repair 分两级：`patchRepair`（轻度）/ `heavyRepair`（重度）
5. 修复后重新 Quality Gate
6. 持久化到 DB
7. Fire-and-forget：Finalization 检查 + Workspace 诊断

**手动写作路径**：`ChapterWritePanel.tsx` → SSE → `chapterWriter.ts` → `generateChapterContentCore` → `processChapter`

**自动写作路径**：`DirectorService` → `generateChapterContentCore` → `processChapter`

**上下文组装**：`server/src/modules/novel/production/context/contextAssembler.ts`
- 这是**全系统最重的模块**，汇聚 12+ 子模块
- 产出 `PromptContextBlock[]`，每个 block 有优先级/分组/新鲜度/必需性
- 下游通过 `selectContextBlocks` 做上下文选择（截断到 token 预算）

### 5.3 AI 调用统一接口（aiService）

**入口**：`server/src/platform/llm/aiService.ts`

**核心原则**：所有 AI 调用必须走 `aiInvoke({ assetId })` 或 `invokeAsset({ assetId })`。系统提示词统一注册在 `promptRegistry`，不在代码中内联。

**两个入口**：
- `aiInvoke(opts)` — 自定义 userPrompt，带 Zod schema 结构化输出
- `invokeAsset(opts)` — 带上下文块选择，自动裁剪到 token 预算

**Prompt 注册**：`server/src/modules/novel/prompts/index.ts`（side-effect import 注册）
- `planningPrompts.ts` — 规划阶段提示词
- `productionPrompts.ts` — 写作/质检/修复提示词
- `postWritePrompts.ts` — 写后处理提示词
- `referencePrompts.ts` — 参考书分析提示词
- `worldPrompts.ts` — 世界规则提示词
- `payoffPrompts.ts` — 伏笔提示词
- `timelinePrompts.ts` — 时间线提示词

**模型路由**：按 taskType 自动分配 temperature/maxTokens：
```
writer:    0.85 / 8192
reviewer:  0.30 / 2048
planner:   0.80 / 8192
extractor: 0.50 / 4096
compiler:  0.30 / 2048
repairer:  0.50 / 8192
```

**Provider**：默认 `deepseek`，可从设置页切换（OpenAI/Anthropic/Gemini/通义千问/月之暗面）。

### 5.4 Director（自动写作）

**入口**：`server/src/modules/novel/director/directorService.ts`

**职责**：批量自动写章。从第一个未完成章节开始，逐章调用 `generateChapterContentCore` + `processChapter`。

**特性**：
- 每章最多 120 秒超时（AbortController）
- 每章完成持久化 Checkpoint（崩溃恢复）
- 检测到 `stopRequested` 则暂停
- 到达回环结算阶段自动暂停
- 最大批量 30 章
- 通过 `directorEmitter` 发射 SSE 事件（token/chapter/error/done）

**前端对应**：`DirectorPanel.tsx` — 连接 SSE 事件流展示进度

### 5.5 质量门禁（Quality Gate）

**入口**：`server/src/modules/novel/production/quality/qualityGate.ts`

**职责**：LLM 评审章节内容，10 个维度打分。

**维度**：开篇/剧情/角色/对话/悬念/节奏/展示而非讲述/语言/题材适配/连贯性

**特色**：
- 题材自适应：悬疑/言情/奇幻/科幻/成长/动作各有专属检查维度
- 角色禁令扫描：正则规则检测角色 OOC 行为
- 总分 ≥ 阈值 → PASS，否则 → NEEDS_FIX 触发修复

### 5.6 参考书深度分析（Deep Analysis）

**入口**：`server/src/modules/novel/planning/referenceDeepAnalysis/index.ts`

**职责**：对标书进行 AI 驱动的结构化分析，产出可被写作阶段直接消费的洞察。

**流程**：
1. **Parse**：章节分割（支持 JSON 或纯文本）
2. **Annotate**：AI 逐章标注（类型/爽点/钩子/开场方式/摘要等）
3. **Module A**：回环检测 + 叙事分析 + 节奏画像
4. **Module C**：金手指提取（进化时间线）
5. **Module D**：写法技法 + 工艺统计 + 期待链

**产出**：`AnalysisResultV3` → 存入 `ReferenceProfile.analysisResult`

**写作阶段消费**：`contextAssembler.ts` 中注入 reference_exemplars / expectation_chain / reference_style_hints / reference_counterpart

### 5.7 风格引擎（Style Service）

**入口**：`server/src/modules/style/styleService.ts`

**职责**：从参考文本提取写作风格规则，绑定到小说/章节，注入上下文。

**流程**：
1. 创建 StyleProfile（上传参考文本）
2. `extractStyle()` → AI 提取 5 类规则（叙事/语言/角色/节奏/反AI）
3. `bindStyle()` → 绑定到 Novel 或 Chapter
4. `resolveStyleContext()` → 写作时组装为 context block

### 5.8 伏笔管理系统（Payoff Service）

**入口**：`server/src/modules/payoff/payoffService.ts`

**职责**：管理伏笔的埋设→追踪→回收全生命周期。

**流程**：
1. 用户在 UI 创建伏笔（title + summary + scopeType）
2. 每章写完后 `scanChapterForPayoffs()` 自动扫描
3. LLM 识别伏笔被触碰（touched）或被回收（paid_off）
4. 更新状态机：setup → hinted → pending_payoff → paid_off

### 5.9 时间线服务（Timeline Service）

**入口**：`server/src/modules/timeline/timelineService.ts`

**职责**：从章节内容提取时间线事件，检测序列/逻辑/截止期限冲突。

**流程**：
1. `afterChapterSave()` 触发
2. LLM 提取 ≤10 个时间线事件（event/deadline/milestone/constraint）
3. 持久化为 TimelineItem
4. `detectTimelineConflicts()` 检测冲突

### 5.10 事件总线（EventBus）

**入口**：`server/src/platform/events/bus.ts`

**职责**：章节生命周期事件的发布订阅。

**事件**：
- `chapter.drafted` → 触发 payoff 扫描/角色动态/冲突扫描
- `chapter.completed` → 检查是否全部完成

**注册**：`server/src/modules/novel/production/events.ts`（side-effect import 自动注册）

---

## 六、前端架构

### 6.1 路由

```
/                     → StartPage（输入灵感，创建小说）
/novels               → NovelsPage（小说列表）
/novels/:id           → NovelRedirect（重定向到 plan 或 write）
/novels/:id/plan      → PlanningHubPage（规划阶段）
/novels/:id/write     → NovelWorkspacePage（写作阶段）
/reference-profiles   → ReferenceProfilesPage
/reference-profiles/:id → ReferenceCockpitPage（参考书详情）
/settings             → SettingsPage（API Key/模型/偏好）
```

### 6.2 数据获取

- **TanStack Query** 统一管理服务端状态
- `client/src/api/` 目录按领域拆分 hooks（architecture.ts / characters.ts / chapters.ts / rhythm.ts / world.ts 等）
- 所有 hooks 通过 `factory.ts` 中的 `createQueryHook`/`createMutationHook` 统一生成

### 6.3 核心页面

| 页面 | 职责 |
|------|------|
| **StartPage** | 输入灵感 → 创建 Novel |
| **PlanningHubPage** | 4 步流水线导航（Foundation/World/Characters/Blueprint） |
| **NovelWorkspacePage** | 写作工作台：左栏上下文面板 + 中栏写作面板 + 右栏诊断面板 |
| **SettingsPage** | AI Provider/API Key/默认参数/参考书管理 |

### 6.4 核心组件

| 组件 | 位置 | 职责 |
|------|------|------|
| **ChapterWritePanel** | `workspace/` | 单章写作：预览/AI生成/SSE流式/保存 |
| **ContextPanel** | `workspace/` | 上下文面板：折叠式展示各 block |
| **DirectorPanel** | `workspace/` | 自动写作控制面板 |
| **RevisionWorkbench** | `workspace/` | 修订工作台：质量评审/修复 |
| **FoundationDomain** | `planning/` | 故事核心编辑 |
| **BlueprintDomain** | `planning/` | 章节大纲/回环骨架/卷展开 |
| **ArchitectureDomain** | `planning/` | 架构选择/参考书/金手指 |
| **PowerSystemTree** | `pipeline/` | 力量体系可视化树 |

---

## 七、数据库（Prisma + SQLite）

**Schema**：`server/prisma/schema.prisma`

**核心模型**：
- `Novel` — 小说主表（含大量 JSON 字段存储结构化数据）
- `Chapter` — 章节（内容/状态/期望/钩子/时间线快照）
- `Volume` — 卷
- `VolumeChapterPlan` — 卷内章节计划（purpose/exclusiveEvent/endingState/loopPhase/coolPointType 等）
- `NovelCharacter` — 角色
- `ReferenceProfile` — 参考书（含 deepAnalysisResult）
- `StyleProfile` / `StyleBinding` — 风格规则
- `PayoffLedgerItem` — 伏笔
- `TimelineItem` — 时间线事件
- `WorldRule` — 世界规则
- `AuditReport` — 审计记录
- `Checkpoint` — Director 断点

**JSON 字段存储**：SQLite 中所有复杂类型均以 JSON 字符串存储（`loopSkeleton`/`goldenFinger`/`pipelineState`/`expectationProfile` 等），读取时需手动 `JSON.parse`。

---

## 八、TODO / FIXME / 临时实现

### 明确标记

| 位置 | 内容 |
|------|------|
| `contentGuides.ts:136` | `TODO: Structural loop-based mapping (phase-aligned) for more accurate counterpart selection.` — 参考书对标章节映射目前仅用线性比例，未按回环结构对齐 |
| `planningPrompts.ts:272` | 硬编码的 few-shot 示例 — 示例1/示例2 直接写在 prompt 字符串中，随代码膨胀越来越难维护 |

### 隐含的临时实现

| 位置 | 说明 |
|------|------|
| `shared/types/novel.ts` 中 `[key: string]: unknown` | 多处使用索引签名绕过 Zod 校验，说明 schema 与前端传参存在脱节 |
| `pipelineState.ts` 中 `result?: unknown` | PipelineState 的 step result 类型为 `unknown`，缺少结构化定义 |
| `contextAssembler.ts` 多处 `try { ... } catch { /* best-effort */ }` | 12+ 个 block 的获取都是 best-effort，任一失败不影响整体但缺乏降级策略 |
| `referenceDeepAnalysis/index.ts` 中 `(ar.annotations as any)` | 类型断言绕过，说明 AnalysisResultV3 的 annotations 字段实际存的是 ChapterAnnotation[] |
| `contentGuides.ts` 中 `(annotations as any)` | 同样的类型断言问题 |
| `server/src/app.ts` 中 `loadApiKeysFromPreferences()` | 启动时恢复 API Key — 因为桌面端重启丢失 `process.env`，这是一个 workaround |
| `template.db` 机制 | 首次启动从模板拷贝数据库，而非运行 Prisma migrate — 说明 schema 变更需要手动同步模板 |
| `novelRepository.ts` 中大量 `as unknown as` 类型转换 | JSON 字段从 SQLite 读出为 string，与 TS 类型不匹配 |
| `qualityGate.ts` 中 `RawQualitySchema.passthrough()` | Zod schema 使用 passthrough 允许额外字段，说明 LLM 返回格式不完全可控 |
| `planningPrompts.ts` 中巨大的 prompt 字符串拼接 | 规划提示词 41KB 单文件，全部是模板字符串拼接，难以测试和维护 |

---

## 九、模块间调用关系图

```
                    ┌─────────────────────────────────────────────┐
                    │              Frontend (React)                │
                    │  PlanningHub / NovelWorkspace / Settings     │
                    └────────────────┬────────────────────────────┘
                                     │ REST API (Axios / TanStack Query)
                    ┌────────────────▼────────────────────────────┐
                    │           Express Server (routes.ts)         │
                    │  /novels  /styles  /payoff  /timeline        │
                    │  /director  /settings  /world                │
                    └───────┬──────────────┬──────────────┬───────┘
                            │              │              │
          ┌─────────────────┘              │              └─────────────────┐
          ▼                                 ▼                              ▼
  ┌─────────────────┐          ┌─────────────────────┐          ┌─────────────────┐
  │  Planning Module │          │  Production Module   │          │  Infrastructure  │
  │                  │          │                      │          │                  │
  │ creationPipeline │          │ chapterPipeline      │          │ aiService        │
  │   ├─ storyCore   │          │   ├─ chapterGenerator│          │   ├─ promptReg   │
  │   ├─ deepAnalysis│          │   ├─ qualityGate     │          │   ├─ modelRouter │
  │   ├─ characters  │          │   ├─ repair          │          │   └─ invoke      │
  │   └─ loopTemplate│          │   └─ contextAssembler│          │                  │
  └─────────────────┘          │       (12+ modules)  │          ┌─────────────────┐
                               │                      │          │  Data Layer      │
                               │  directorService     │          │                  │
                               │  payoffService       │          │  Prisma + SQLite │
                               │  timelineService     │          │  Repository      │
                               │  styleService        │          │  (novelRepo etc) │
                               │  events (EventBus)   │          └─────────────────┘
                               └──────────────────────┘                         │
                                                                      ┌─────────▼─────────┐
                                                                      │  Prisma Schema    │
                                                                      │  schema.prisma    │
                                                                      └───────────────────┘
```
