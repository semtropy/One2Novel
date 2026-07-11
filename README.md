# One2Novel

<div align="center">

**从一句灵感到一本小说**

AI 驱动的中文长篇小说创作工作台

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescript.dev/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-35-47848f.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## 快速开始

### 下载桌面应用（推荐，零代码经验也能用）

1. 从 [GitHub Releases](https://github.com/semtropy/One2Novel/releases) 下载最新版
2. 安装后打开，进入 **设置** 页填入 AI 厂商的 API Key
3. 在首页输入一句话灵感，点击「开始创作」

> 支持 DeepSeek、OpenAI、Anthropic Claude、Google Gemini、通义千问、Moonshot

### 从源码运行（需要 Node.js >= 20 + pnpm >= 10.6）

```bash
git clone https://github.com/semtropy/One2Novel.git
cd One2Novel
pnpm install
pnpm dev          # 后端 :7456 + 前端 :7457
```

---

## 它能做什么

One2Novel 把专业网文编辑的工作方式编码成一条 **串行流水线** —— 每一步的产出都会成为下一步的上下文。你只需要在每个决策节点做最小判断。

### 创作管线（Planning Hub）

四步规划流程，自由跳转，不强制线性：

| 步骤 | 做什么 | AI 帮你 |
|------|--------|---------|
| **故事核心** | 输入一句话灵感 | 生成故事摘要、核心悬念、结局方向、题材定位、商业标签、前30章承诺 |
| **世界构建** | 选择架构类型 / 上传参考书 | 世界规则、力量体系树、金手指设定、回环阶段定义 |
| **角色阵容** | 确认角色 | AI 从故事核心提取角色，生成性格、弧线、关系网、资源台账、信息差档案 |
| **章节大纲** | 确认结构 | 按回环展开卷章计划，标注节拍类型、爽点位置、钩子策略 |

### 参考书分析（Reference Analysis）

上传一本对标网络小说（txt / epub，百万字以上），AI 自动分析其 **结构 DNA**：

- **回环检测** — 自动识别全书回环边界，逐轮分析叙事功能（setup/escalation/turn/climax/denouement）、核心冲突、主角变化、结算内容、与上轮的递进关系
- **节奏曲线** — 计算高潮间隔、冷却段长度、张力曲线，判定节奏模板（密集高潮 / 波浪式 / 渐进爬坡）
- **章节热力图** — 每章标注爽点等级（高/中/低）、章节类型（推进/过渡/冷却/高潮）、钩子类型、内容节拍
- **金手指设计模式** — 提取能力体系、限制条件、进化路径、获取方式、叙事融合策略
- **写法技法** — 从五个维度提取可模仿规则：叙事技法、语言风格、角色塑造、节奏控制、反 AI 特征（带置信度）
- **写作手法统计** — 开场方式分布、对话比率、描写分布
- **读者期待链** — 每轮回环的期待建立→维持→兑现→新期待的完整模式
- **架构蓝图** — 综合以上分析，生成 ArchitectureProfile：章节类型分布、每回环平均章数、爽点配方、钩子策略、内容节拍配方、角色系统参数、伏笔回收模式

分析结果可应用到任意小说，也可作为架构引擎的输入。

### 写作工作台（Workspace）

三栏布局：左侧章节列表、中间编辑器、右侧工具箱（9 个面板）。

每章经历完整的生产管线：

1. **深度上下文组装** — `assembleChapterBlocks()` 从 12+ 个模块采集上下文：书籍合约、章节任务、前章内容、角色硬事实、实体生命周期、语义记忆、角色动力学、风格约束、参考书范例、伏笔指令、开放冲突、RAG 语义检索、分层压缩章节、当前卷上下文、时间线、世界规则、期望配置文件、内容节拍、分镜计划
2. **AI 生成正文** — 通过 prompt 注册中心调用 LLM，注入写作 Skill 规则，SSE 流式输出
3. **九维质检** — 开头吸引力、情节推进、人物塑造、对话质量、悬念设置、节奏控制、展示而非讲述、语言质量、题材适配（+ 跨章连贯性），按题材动态切换检查维度
4. **自动修复** — 低分触发 patch repair（轻度，temperature 0.5）或 heavy repair（深度，temperature 0.7），重新评分
5. **持久化 + Commit** — 生成不可变的 ChapterCommit 记录，含质量门快照
6. **异步 Projection** — 5 个 Projection Writer 并行消费 commit：state（角色状态更新）、index（卷章计划更新）、summary（章节摘要）、memory（语义记忆沉淀）、vector（RAG 存储）
7. **写后钩子** — 时间线提取、增量摘要压缩、角色状态更新、伏笔检测、完成度检查、债务计息、卷级压缩与跨卷审计

右侧工具箱提供 9 个面板：写法（风格档案绑定）、伏笔（状态管理）、分镜（SceneCard 编辑）、角色动态（出场调度 + 缺席提醒）、时间线（冲突检测 + 写前提醒）、审查详情（九维评分 + Skill 诊断）、统计（字数/质量趋势/伏笔完成率）、仪表盘（爽点节奏/钩子健康/写作提醒/角色状态）、编辑历史（版本对比）。

### 导演模式（Director）

不想一章一章操作？打开导演模式，批量自动写作：

- 从第一个未完成章节开始，逐章跑完整条管线（生成 → 质检 → 修复 → 持久化）
- 断点恢复：每次写入前保存 checkpoint，服务器崩溃重启后从断点继续
- 每章超时 120 秒自动 abort，防止卡死
- 到达回环结算阶段自动暂停，等待确认
- 最多单次 30 章，防止过长任务失控

### 语义记忆系统

一部百万字网文会产生数十万条叙事事实，如何让 AI 在写第 300 章时还记得第 5 章埋下的伏笔？

- **写前注入** — 从历史中按 7 类别（世界观、角色状态、关系、故事事实、未闭合悬念、读者承诺、时间线）精准检索相关片段，注入生成上下文
- **写后沉淀** — 每章完成后，零额外 LLM 成本从已有角色状态更新、章节摘要、增量摘要中提取结构化事实，upsert 到语义记忆库
- **预算控制** — 50 章时间窗口 + 每类别上限（25 语义记忆 + 10 硬约束），确保注入量可控

### Agent 化架构

写作管线的核心环节封装为三个独立 Agent，每个都有生命周期追踪、重试和降级：

- **ContextAgent** — 组装 12+ 模块上下文，浓缩为 5 部分写作任务书（故事目标、角色状态与动机、情节节点与约束、风格指导、结尾方向）
- **ReviewerAgent** — 九维质检，失败时自动降级为默认分数，不阻塞管线
- **DataAgent** — 从章节文本提取结构化事实（角色状态变化、实体新增/死亡、故事事件、场景拆解），统一输出供 Projection Writers 消费，减少重复 LLM 调用

### 辅助功能

- **伏笔追踪** — 自动扫描新设置/回收的伏笔，完整生命周期追踪，逾期提醒
- **时间线** — 自动提取事件，冲突检测（同人异地、顺序颠倒）
- **世界规则** — 按章节激活/停用，写作时自动校验
- **改写工具** — 选中段落一键润色/扩写/压缩/去 AI 痕迹/调整视角/调整基调，带 diff 预览
- **章节诊断** — AI 扫描整章，输出 severity-ranked 诊断卡片，推荐改写操作
- **草稿优化** — AI 优化当前草稿，保留钩子、伏笔和角色状态
- **内联建议** — 选中文字，弹出 AI 建议浮窗（pass/fail 指示）
- **导出** — EPUB 3.0 / TXT / Markdown / JSON
- **跨卷审计** — 选择卷，点击审计，获取一致性报告（按类型/严重度分类）

---

## 技术架构

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite 7 + Tailwind CSS + Tiptap 编辑器 + TanStack Query |
| 后端 | Express 5 + Prisma 7 + SQLite (better-sqlite3) |
| AI | LangChain 适配器（OpenAI-compatible / Anthropic / Google） |
| 桌面 | Electron 35 + electron-builder（内嵌 Express 服务器，数据本地存储） |
| 类型 | TypeScript 5.9 + Zod 4（全栈 schema 校验） |
| 架构 | pnpm monorepo（4 个 workspace） |

### 项目结构

```
One2Novel/
├── client/                  # React 前端
│   └── src/
│       ├── pages/           # 6 个页面：Start / Novels / PlanningHub / Workspace / Settings / ReferenceProfiles
│       └── components/      # workspace / planning / pipeline / settings 等域组件
├── server/                  # Express 后端
│   ├── src/
│   │   ├── modules/
│   │   │   ├── novel/           # 核心创作管线
│   │   │   │   ├── planning/    # 串行创作管线
│   │   │   │   │   ├── storyCoreService.ts      # 故事核心生成
│   │   │   │   │   ├── characterPrep/           # 角色预制（角色/关系/生命周期/资源台账/信息差）
│   │   │   │   │   ├── architectureEngine/      # 架构引擎（模板注册、回环骨架生成、卷展开）
│   │   │   │   │   ├── referenceBookService.ts  # 参考书分析（9 项独立分析模块）
│   │   │   │   │   ├── referenceDeepAnalysis/   # 参考书深度分析 V2（解析→标注→模块分析→合成）
│   │   │   │   │   ├── storyMacro/              # 节拍表、约束引擎、再平衡
│   │   │   │   │   ├── worldFrameworkService.ts # 世界规则生成
│   │   │   │   │   ├── powerSystemService.ts    # 力量体系树
│   │   │   │   │   └── goldenFingerService.ts   # 金手指生成
│   │   │   │   ├── production/  # 章节写作管线
│   │   │   │   │   ├── writing/     # chapterPipeline, chapterWriter, chapterGenerator
│   │   │   │   │   ├── quality/     # 九维质检门 + Skill 诊断规则库
│   │   │   │   │   ├── repair/      # patch/heavy repair + 上下文组装
│   │   │   │   │   ├── commit/      # 不可变提交 + 5 个异步 projection writers
│   │   │   │   │   ├── agents/      # ContextAgent / ReviewerAgent / DataAgent
│   │   │   │   │   ├── context/     # 上下文组装：分层压缩、RAG、语义记忆、卷压缩
│   │   │   │   │   └── post/        # 写后钩子：时间线、摘要、角色、记忆、债务
│   │   │   │   ├── director/    # 批量自动写作（断点恢复、超时控制、回环暂停）
│   │   │   │   └── prompts/     # Prompt 注册中心（7 个文件，按领域注册）
│   │   │   ├── payoff/        # 伏笔/回收账本
│   │   │   ├── timeline/      # 时间线冲突检测
│   │   │   └── style/         # 写法引擎（风格档案 + 绑定）
│   │   └── platform/          # 基础设施层
│   │       ├── llm/           # aiService, structuredInvoke (5阶段修复), contextSelection, provider
│   │       ├── config/        # PROVIDER_REGISTRY（单一真相源）
│   │       └── db/            # Prisma 单例 + WAL 管理
│   └── prisma/
│       └── schema.prisma        # 30+ 实体模型
├── shared/              # 前后端共享类型和 Zod schemas
│   └── types/
│       ├── novel.ts             # 小说/章节/角色 schemas + 长篇小说类型
│       └── architectureProfile.ts  # 架构引擎完整类型定义
└── desktop/             # Electron 桌面运行时（内嵌 Express 服务器）
```

### 核心设计亮点

**Prompt Registry** — 所有 AI 调用禁止内联 prompt 字符串，必须通过注册中心调用。6 种 TaskType（writer/reviewer/planner/extractor/compiler/repairer）各有独立的 temperature 和 maxTokens 默认值。System prompt 支持模板变量注入 + 写作 Skill 规则动态拼接。

**多阶段输出修复** — `structuredInvoke` 实现了 5 阶段修复管线：JSON 截断修复（补括号）→ 类型归一化（字符串转数字等）→ 字段名修复（LLM 用错键名时自动恢复）→ 程序化包装（裸数组包裹）→ 重试 prompt。LLM 经常返回 null 代替 undefined、用错字段名、输出裸数组而非包裹对象，系统自动修复。

**Token 预算感知上下文选择** — 每章写作前，系统从数十个上下文块中按优先级 + 新鲜度排序，在 token 预算内选择保留/摘要/丢弃。中文 ~1.5 token/字，英文 ~4 字符/token。三级策略：强制保留（priority >= 90）→ 摘要截断（60-89）→ 丢弃（< 60）。

**不可变 Commit + 异步 Projection** — 借鉴事件溯源模式，每章生成不可变的 ChapterCommit 记录，5 个 Projection Writer（state/index/summary/memory/vector）并行消费，崩溃后可重放。每个 writer 独立失败不影响其他 writer。

**Chase Debt 债务系统** — 将悬念、爽点、微 payoff 建模为债务：设置伏笔 = 产生债务，回收 = 偿还，逾期自动计息（10%/章）。支持 override contract（临时豁免 + 延期计划）。

**Architecture Profile** — 针对中文网文特有的「回环」结构（副本循环、境界突破循环），设计了完整的架构描述语言：Loop Skeleton、Golden Finger、Power System Tree、Content Beat DNA、Cool Point Recipe、Hook Profile。

**Skill 诊断规则库** — qualityGate 内置了覆盖 10 个维度的 Skill 诊断规则（来自写作 Skill 指南），低分维度自动触发规则-based 诊断，给出具体症状、修复建议和示例对比。

**参考书深度分析 V2** — 模块化分析管线：解析章节目录 → 批量 LLM 标注（每章 8 个维度）→ 6 个独立模块并行分析（回环检测、节奏曲线、金手指、写法技法、期待链、架构合成）→ 统一输出 ArchitectureProfile。支持进度追踪和断点恢复。

### 数据模型

30+ 实体模型，核心包括：

- **Novel** — 小说元信息 + 架构配置（回环骨架、金手指、力量体系、内容节拍）
- **Chapter** — 正文 + 7 种状态 + 10 维质量分 + 场景计划 + 诊断 + 修复历史
- **NovelCharacter** — 角色硬事实 + 弧线 + 资源台账 + 信息差档案 + 生命周期
- **MemoryItem** — 语义记忆库（7 类别，去重 upsert）
- **ChaseDebt / DebtEvent** — 伏笔债务追踪 + 利息累积
- **ChapterCommit / ProjectionRun** — 不可变提交 + 异步投影执行记录
- **StoryEvent** — 从 commit 提取的故事事件（角色死亡/复活/关系变更等）
- **ReferenceProfile / ReferenceBook** — 参考书档案 + 上传文本 + 分析结果

---

## 开发指南

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 类型检查（全栈）
pnpm typecheck

# 数据库
pnpm db:push          # 推送 schema 到 dev.db
pnpm db:studio        # Prisma Studio 图形界面

# 测试
pnpm test

# 构建桌面安装包
pnpm dist:desktop:nsis
```

### 环境配置

在项目根目录创建 `.env` 文件，配置至少一个 AI 厂商的 API Key：

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

也支持 OpenAI、Anthropic、Gemini、通义千问、Moonshot。详见 `server/src/platform/config/providers.ts`。

### 贡献指南

1. 所有 AI 调用必须通过 `aiInvoke({ assetId })` 或 `invokeAsset({ assetId })`，禁止内联 prompt
2. 所有数据变更先查 Zod schema（`shared/types/novel.ts`）和 Prisma schema
3. JSON 字段存储在数据库中，必须在服务层解析
4. 新 prompt 放入对应领域的 `server/src/modules/novel/prompts/` 文件

---

## License

MIT
