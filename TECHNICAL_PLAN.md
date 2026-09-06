# One2Novel V2 技术方案

> 日期：2026-09-05。用途：作为后续开发的统一依据。
> 实施状态（2026-09-06）：第一版 MVP、P5 连续生产与 P6 参考/知识闭环已建立，实际范围、启动方法与验收见 README.md、docs/MVP_ACCEPTANCE.md、docs/P5_ACCEPTANCE.md 和 docs/P6_ACCEPTANCE.md。本文仍描述完整 V2 目标，不能将所有目标视为已实现。
> 更具体的默认数据结构、算法、状态机、接口与验收见 `DEVELOPMENT_SPEC.md`；用户可直接修改该文档。两份设计细节不一致时以开发细则及用户最新修改为准。

## 1. 项目目标与范围

从一句灵感出发，通过滚动规划、章节生成、强制审核与事实状态更新，持续生产可编辑、可追溯的中文长篇小说。

已确定约束：

- 仅面向本人使用，仅提供 Web；默认在本机运行，通过浏览器访问。
- 从零实现；旧代码只作为问题、行为和领域知识的参考，禁止复制文件、函数、Prompt 或旧数据模型后改名使用。
- 不迁移旧小说、数据库、参考分析结果、用户配置或旧 API；新数据库从空白开始。
- 所有模型服务调用统一通过 ChatAnyWhere；切换模型通过配置完成。
- 产品需求以 `PRD.md` 为准；本方案补充工程实现和默认行为。新增需求不得由历史代码反向推导。
- 简洁纯白界面，正文编辑优先；不开发 Electron、账户体系、多租户、协作、支付和插件管理后台。
- 首个可用版本必须完成连续两章的可靠生产闭环；完整 V2 再补齐参考作品、知识资产与长篇检索。分阶段交付不改变最终 PRD 范围。

成功标准：第 N 章只有在正文审核 PASS、事件抽取与状态验证完成、原子提交成功后才标记 COMPLETED；第 N+1 章只能读取已提交的第 N 章事实状态。

## 2. 旧代码归档与新仓库基线

| 项目 | 位置或处理方式 |
| --- | --- |
| 当前工作区 | `C:/Users/gaijinchao/Desktop/code/One2Novel` |
| 新开发分支 | `rewrite/v2-web` |
| 原分支 | `fix/all-phases-1-5` |
| 原提交 | `14771e4`；完整 ID 见归档清单 |
| 归档目录 | `C:/Users/gaijinchao/Desktop/code/tmp/One2Novel-legacy-20260905-124250/workspace` |
| 归档清单 | 上述目录的父目录下 `archive-manifest.json` |
| Git 历史 | `.git` 留在当前仓库；旧历史保留，新分支工作树清空旧实现 |
| PRD | 完整归档后复制回当前根目录，内容未修改 |

归档包含原工作区除 `.git` 外的 28 个根条目，包括源码、隐藏配置、依赖、构建产物和本地数据。原未提交的 `server/src/user-preferences.json` 也随原文件保存。301 个原受 Git 跟踪文件的 SHA-256 已核对一致。

归档是本地参考快照，不是新的依赖包，也不是可直接启动的独立 Git 仓库。迁移后的依赖链接和旧 worktree 元数据可能仍指向原路径；不要直接运行归档内服务。归档中的真实凭据与本地数据不复制回新仓库、不提交到新基线。

当前根目录仅保留 PRD、新技术方案、新开发约定和新的忽略规则；不预建空业务目录。后续按阶段创建真实实现。新分支采用普通分支而非 orphan 分支，清空的是当前代码树，不删除历史。

## 3. 技术栈与运行方式

| 层 | 选择 | 理由与边界 |
| --- | --- | --- |
| 运行时 | Node.js 24 LTS、TypeScript 5.9、pnpm 10 workspace | 延续熟悉工具；Windows 原生开发 |
| 前端 | React 19、Vite 7、React Router 7 | 独立 SPA，无 SSR 需求 |
| 样式 | Tailwind CSS 3、Lucide | 白底、灰阶、细边框、少量强调色 |
| 编辑器 | TipTap 2 | 正文编辑、选区操作；以统一正文格式转换边界控制复杂度 |
| 服务端状态 | TanStack Query 5；浏览器 fetch | 缓存 API 结果；编辑草稿保持局部状态，不增加 Redux |
| 服务端 | Express 5、Zod 4 | 路由薄，运行时验证明确 |
| 数据库 | SQLite + Prisma 7 + better-sqlite3 adapter | 个人、单进程、低并发；使用正式 migration |
| 模型调用 | `openai` JavaScript SDK，仅配置 ChatAnyWhere | 利用现成流解析与取消能力；不引入 LangChain、Agent 框架和多厂商 SDK |
| 长任务 | SQLite 持久化 Job + 同进程 Worker | 无 Redis/BullMQ；后台任务独立于浏览器连接 |
| 推送 | REST + SSE | HTTP 发命令，SSE 观察任务；状态始终可查询 |
| 检索 | SQLite 文本检索起步，按需增加本地向量索引 | 不单独部署向量数据库；Embedding 仍走 ChatAnyWhere |
| 测试 | Vitest、Playwright | 纯逻辑、真实临时 SQLite 集成、浏览器流程 |

这是有意选择的版本基线，不是“全部使用最新版”。P1 安装时验证这些主版本与 Node 24 的兼容性，选择各主版本内的适用补丁并写入全新 lockfile；Prisma CLI、client、adapter 保持同版本。不得复制旧 lockfile 或旧 node_modules。

默认前后端同源：开发时 Vite 代理 `/api`；生产时 Express 提供 Web 静态产物和 API。开发端口前端 7457、后端 7456，生产入口 7456，默认绑定 `127.0.0.1`。不对公网监听，不加入无需求的登录系统；写接口校验 Origin，并拒绝跨站浏览器请求。将来开放远程访问时再单独设计认证。

SQLite 启用 WAL、外键和合理 busy timeout；单写事务保持短小。新数据存放 `data/`，日志和导出不进入 Git。数据库升级使用 Prisma migration，禁止模板数据库补列或运行时自动 db push。[SQLite 适用场景](https://www.sqlite.org/whentouse.html)、[Prisma 7 migration 文档](https://docs.prisma.io/docs/cli/v7/migrate)。

## 4. 目标目录结构

PRD 的八个一级模块解释为服务端业务/基础设施一级边界；仓库外层仍按 web、server、contracts 组织工程。它们不是八个服务，也不对应八个导航项。

```text
One2Novel/
├── PRD.md
├── TECHNICAL_PLAN.md
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .env.example
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/                 # 路由、QueryClient、API 与 SSE 客户端
│   │       ├── pages/               # 小说、知识、设置、单本工作区
│   │       ├── features/            # 按用户任务组织组件与 hooks
│   │       ├── components/ui/       # 少量通用交互组件
│   │       └── styles/
│   └── server/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── src/
│           ├── main.ts             # 进程生命周期、单实例与 Worker
│           ├── http.ts             # HTTP 装配，不包含业务决策
│           ├── reference/          # 导入、切章、解析、聚合与来源
│           ├── knowledge/          # framework/asset/skill/style/template
│           ├── planning/           # 全书、卷、事件、章节、滚动规划
│           ├── production/         # context/generation/revision/commit
│           ├── story-state/        # events/delta/snapshot/validation
│           ├── evaluation/         # 门禁、问题、建议、评估版本
│           ├── orchestrator/       # 状态转移、执行资格、重试和取消
│           └── platform/           # llm/embedding/rag/database/storage/jobs/config/observability
├── packages/
│   └── contracts/src/              # 前后端公共 Zod schema、DTO、事件类型
├── tests/
│   ├── fixtures/                   # 全新小型样本，不复制旧小说与测试
│   ├── integration/                # 临时数据库与故障注入
│   └── e2e/                        # Playwright
├── docs/                           # 后续 ADR、接口与验收记录
└── data/                           # 新数据库、原文、索引、备份；忽略提交
```

模块起步采用 `schema.ts`、`service.ts`、必要的 `routes.ts`、`prompts.ts` 与测试；只在文件确实变复杂时拆子目录。不得为每个实体生成无业务逻辑的 controller/service/repository 三层包装。

### 依赖与写入边界

- HTTP 入口验证请求、调用用例、返回结果；不在路由中拼 Prompt 或绕过门禁写正式正文。
- Orchestrator 调用领域能力，领域模块不反向依赖 Orchestrator。跨领域操作由用例协调。
- 各领域拥有自己的数据和校验；模块对外提供显式函数，不深层导入别的模块实现。
- Platform 不依赖业务模块，不能从 llm 基础设施反向加载小说或用户偏好服务。
- contracts 仅放对外协议，不暴露 Prisma 类型、服务器环境变量或 SDK 类型。
- `production/commit` 是正式章节与故事状态联合提交的唯一入口；允许它使用同一数据库事务调用参与模块的提交函数。这是有意的原子边界，不能拆成事件监听器。
- 搜索索引、派生摘要可异步更新；权威故事事实不得通过 fire-and-forget 更新。

## 5. ChatAnyWhere 统一调用方案

### 5.1 连接与配置

ChatAnyWhere 官方说明其统一接入采用 OpenAI 标准协议；官方 Chat Completions 示例使用 `https://api.chatanywhere.tech/v1`。[官方说明](https://github.com/chatanywhere/GPT_API_free)、[官方调用示例](https://github.com/chatanywhere/GPT_API_free/blob/main/demo/openai_chat_completion_demo.py)。

工程统一使用 Chat Completions 接口。不要因模型品牌不同引入另一套供应商 SDK；本项目只选择 ChatAnyWhere 在该协议下实际支持的模型。

```dotenv
# 未来 .env.example 的字段；此处不是实际凭据
CHATANYWHERE_BASE_URL=https://api.chatanywhere.tech/v1
CHATANYWHERE_API_KEY=
```

- Base URL 与密钥只在服务端环境配置，禁止 `VITE_` 前缀和 localStorage 存密钥。
- 默认域名为 `.tech`，可显式切换到官方 `.org`，不自动更换域名或供应商重发请求。
- 设置页保存默认模型和 planner/writer/reviewer/extractor/repairer 的模型覆盖项；这些非敏感设置存在数据库中。
- 不预填臆造的模型 ID。首次配置由用户填写 ChatAnyWhere 可用模型；可尝试拉取模型列表作为辅助，失败时保留手动输入。
- 模型能力档案记录上下文窗口、输出上限、支持的结构化输出方式和参数；不能由模型名字猜测支持 temperature 或 JSON Schema。
- 在模型能力未配置完成前阻止生产任务启动。没有密钥仍可编辑、阅读、导出和运行假模型测试。
- 每次任务固定实际模型、参数、Prompt 版本和知识版本；更改设置影响新任务。失败阶段需要换模型时显式创建新 attempt 并记录变化，不静默改写旧 attempt。

### 5.2 平台接口与错误行为

`platform/llm` 对业务暴露三个最小能力：`generateText`、`streamText`、`generateStructured`；接收任务类型、Prompt 资产、上下文、输出 schema 和 AbortSignal。Embedding 使用单独接口，同样只连接 ChatAnyWhere。

统一记录 requestId、jobId、attemptId、模型、延迟、用量和结束原因。缺少供应商 usage 时标记未知，不显示虚构费用。日志默认不保存密钥、完整 Prompt 或全文；诊断模式也必须脱敏。

结构化输出先按能力选择协议约束，再经 Zod 校验。每次结构化生成最多额外进行 1 次模型格式修复，不得把缺失必填事实补为空值后宣称成功。流中断、截断、拒绝或空输出保留为不完整产物，不能提交。

统一重试预算，关闭 SDK 隐式重试后由应用层管理：429、临时网络和 5xx 最多额外重试 2 次，遵守 Retry-After 和退避；401/403、无效模型与参数错误直接阻断。单次调用默认总超时 180 秒、流空闲超时 45 秒，可在配置中调整。已输出部分正文后的中断不自动拼接成完整正文；显式重试产生新 attempt，提示可能重复计费。

章节自动正文修复最多 2 轮，状态修复最多 2 轮；每轮结束重新审核或验证。超限进入 FAILED，等待用户编辑或重试。默认每个章节生产任务最多实际发送 40 次模型 HTTP 请求，规划/参考任务每个 Job 最多 100 次；批量生产按章节分别计数。供应商重试、结构修复和业务修复都计入该硬上限，发送前检查；达到上限以 BUDGET_EXHAUSTED 停止，保留进度。计数跨阶段、重启与普通 retry 不重置，只能由用户显式提高该任务预算后恢复。大规模参考解析可在启动前调高预算并展示估计请求数；不把调用次数虚构为确定的货币费用。

本次只核实公共文档，未调用真实账户；模型可用性、速率、JSON 能力和 Embedding 支持必须在后续配置阶段实测，不承诺更换 model 字符串后所有参数都兼容。

## 6. 核心数据与业务流程

### 6.1 三种信息严格分离

| 类型 | 表示什么 | 写入条件 |
| --- | --- | --- |
| Knowledge | 可复用的结构、资产、技巧、风格和模板 | 显式发布知识版本 |
| Plan | 未来准备发生什么 | 新规划版本通过校验并被启用 |
| Story State | 截止某章已经成立的事实 | 初始事实确认，或正文事件验证后原子提交 |

规划中的死亡、关系变化、角色知情等不得提前写入事实。初始 Canon 来自用户确认的世界与人物初始事实，形成 State 0；不能直接把整个 Book Plan 当 State 0。

Framework 与 Asset Pack 独立绑定。原始资产须经过清洗/改编并发布 Adapted Asset Pack 后才能供规划使用。知识升级不会自动改写已生成章节，项目显式选择新版本后影响后续规划。

### 6.2 必要实体与版本关系

按阶段建立以下概念，不一次性预建全量字段：

- NovelProject：项目身份、创作要求、当前连续完成章号与当前状态指针。
- ReferenceSource / ReferenceModelVersion：完整原文、文件校验和、切章与分析来源、覆盖度和版本。
- KnowledgeItem / KnowledgeVersion / ProjectKnowledgeBinding：知识分类、发布版本与项目绑定。
- PlanVersion：Book、Volume、Arc、Chapter 层级，父计划和依赖版本；规划结果不可覆盖。
- Chapter / ContentVersion：章节身份与追加保存的候选正文版本。编辑器自动保存可更新工作草稿，但不修改已审核版本。
- EvaluationRun：绑定正文版本及审核策略/模型版本，输出 PASS / FAIL、issues、suggestions、metrics。
- StoryEvent / StoryStateDelta / StoryStateSnapshot：正文证据、状态变更与历史事实快照。
- Job / JobAttempt / JobEvent：任务、阶段尝试、顺序事件；与章节业务状态分开。

实体使用稳定 ID，名字仅用于显示。Delta 使用有类型的操作和旧值前置条件；禁止让 LLM 直接生成 SQL、任意 JSON Patch 或整份当前状态覆盖。

人物状态、关系、地点、物品、组织、世界规则、角色知识、时间线、Narrative Promise、冲突与目标按类型校验。Custom State 也必须有显式 schema。每个事实可追溯到初始 Canon 或正文版本与来源片段。

每章保存逻辑 Snapshot 元数据和 Delta；State 0 及每 20 章保存压缩 Checkpoint。读取严格沿父链重放并核对哈希；Checkpoint 与正文/Delta 同事务生效，序列化压缩在事务外准备。常用身份、状态、顺序、引用使用关系字段和索引，JSON 不替代所有数据约束。

正文持久化采用规范化纯文本作为生成、审核、抽取和版本哈希的共同输入；TipTap 文档经单一转换器映射为段落文本。首版不支持任意富文本、图片与复杂排版，避免审核文本与编辑文本不一致。

### 6.3 章节执行与原子提交

评审修订以 `DEVELOPMENT_SPEC.md` v0.2 为执行契约：命题保存不可变时间版本，角色认知引用获知事件与观察版本；客观世界变化不自动改写角色态度。PlanAssumption/PlanDependency追踪计划前提，硬失配使计划失效，软失配需复核。PromiseSchedule的章号是软提示，显式required动作才进入门禁。

审核采用代码注册Evaluator、版本化EvaluationPolicy与通用results列表，默认八项可扩展，硬约束/状态Core不可关闭。SkillDefinition与后台SkillConfig分离，Job冻结策略和配置。Reference采用版本化实体Registry与有界检索，Production通过StateContextResolver组装必要事实。提交同步保存规划重查标记，下一章必须消费；可丢失的派生索引不能承担此职责。P2实现逻辑快照与时间语义，P3实现计划前提，P4实现审核注册/配置后台，P6实现Reference Registry，P7仅优化规模与检索。

```text
PLANNED → CONTEXT_BUILDING → WRITING → EVALUATING
                                      ├─ FAIL → REVISING → EVALUATING
                                      └─ PASS → APPROVED
APPROVED → EXTRACTING_STATE_DELTA → VALIDATING_STATE
                                   ├─ 不通过 → 修复 Delta → 再验证
                                   └─ PASS → COMMITTING → COMPLETED
```

任何阶段失败进入 FAILED，并保留 failedStage、attempt、输入版本和已完成产物；取消进入任务 CANCELLED，不把章节改成 COMPLETED。只有 PASS 放行；required 检查出现 MINOR 也为 FAIL；optional 只提供诊断，Core 不可关闭。

PRD 中的 `Commit Content` 在最终提交前解释为保存不可变候选正文，不移动正式 active 指针。事件抽取失败时可以重用该候选正文，不要求重写全文。

LLM 调用全部在数据库事务外执行。最终短事务一次完成：检查预期基础状态/项目修订号、写入正文版本关联与评价结果关联、事件、Delta、Snapshot、移动 active 指针、更新连续完成章号、标记章节 COMPLETED、记录任务完成事件及派生索引待办。任何一步失败均回滚；下一章不得看到半完成事实。

修复事实只能纠正抽取错误或提出状态变更；如果正文与既有事实矛盾，必须回到正文修复和审核，不能篡改历史状态迎合正文。

### 6.4 互斥、恢复和幂等

- 首版 Platform 部署一个服务进程、一个后台执行器，modelConcurrency=1；这是可调整的部署策略。领域独立按小说维护独占活动任务约束和串行权威链。单用户多标签页仍需要数据库约束。
- 开始任务在短事务中检查活动任务并登记。重复点击使用 Idempotency-Key 返回同一个 job；手动、批量、修复入口共用用例。
- 活动任务期间拒绝外部同小说的计划启用、正式正文修改、事实修订等影响输入的命令；任务自身的规划更新须由同一执行链校验并记录依赖版本。允许另存私人工作草稿。仅在无活动任务时可将工作草稿应用为新候选版本；修改已完成章节必须走历史重写与后续失效命令。
- 单实例锁防止同一 data 目录启动第二个 Worker；锁失效清理由启动检测验证，不因超时自动启动另一生产链。
- 服务重启后把遗留 RUNNING attempt 标记 INTERRUPTED，用户点击恢复后从最后一个持久化阶段继续；默认不自动产生新费用。
- 中断流只保存不完整草稿，重试 WRITING；完整候选已保存则可从 EVALUATING 或抽取阶段恢复。基础版本变化时拒绝复用旧产物。
- 提交使用固定提交标识和唯一约束；状态写入成功但响应丢失时，再次提交读取已有结果，不追加重复事实。
- 停止请求先持久化 cancelRequested，再传递 AbortSignal。取消命令和最终提交都通过 SQLite 写事务串行裁决；最终事务必须检查取消标记。取消先写入则不得提交，提交先成功则取消返回 COMPLETED，不能覆盖已提交事实。该竞态必须有集成测试。
- 派生索引待办与完成事务一起持久化，后台按版本幂等消费。正文/状态已经完成时索引失败显示降级，不能再次执行事实提交。

### 6.5 历史重写默认规则

首版采用单条有效故事链，不开发并列分支 UI。

用户重写第 N 章前，明确展示将影响 N 到当前末章。确认后通过小说级命令把 active 状态回退到 N-1，将 N 及后续有效内容从当前链撤下并标记待重审，保留旧版本供查看。规划依赖旧状态的部分标记过期。

新 N 章通过完整闭环后，后续章节逐章重新审核/抽取/提交，或由用户选择重新生成；不自动认定旧后续章节仍然有效。操作失败时仍停留在最后一个有效状态，旧历史不删除。

## 7. API、前端和任务交互

API 前缀 `/api/v1`。共享 contracts 先定义请求、响应、错误和事件类型，再写前后端；不维持旧 API 兼容。

| 接口组 | 最小职责 |
| --- | --- |
| `/projects` | 创建、列表、详情、删除项目 |
| `/projects/:id/plans` | 生成规划任务、保存/启用规划版本 |
| `/projects/:id/chapters/:chapterId/draft` | 保存工作草稿，使用 revision 防止覆盖 |
| `/projects/:id/production-runs` | 创建手动或批量生产任务；重复请求幂等 |
| `/jobs/:id` 与 `/jobs/:id/events` | 查询持久化状态、SSE 订阅 |
| `/jobs/:id/cancel`、`/jobs/:id/retry` | 停止及恢复指定失败阶段 |
| `/projects/:id/story-state` | 查看 active 或指定历史状态与来源 |
| `/projects/:id/rewrites` | 显式启动历史重写与后续失效流程 |
| `/references`、`/knowledge` | 导入、分析、发布知识版本与项目绑定 |
| `/settings/models` | 模型名称、能力、角色映射；不返回密钥 |

长任务创建返回 HTTP 202 与 jobId；普通错误返回 `{ error: { code, message, details? }, requestId }`。冲突为 409，参数校验为 422。服务器返回 canGenerate、canRetry 等执行资格，前端不能通过“已有正文/角色数量”推断完成状态。

SSE 事件包含 eventId、jobId、stage 和时间。阶段事件持久化，支持 Last-Event-ID；正文 token 只用于实时预览，断线后从持久化草稿及任务快照重建，不保证逐 token 重放。刷新、关闭页面不取消后台任务；取消使用显式命令。跨数据块 SSE 解析由统一客户端处理，不散落在页面组件中。

页面组织：

- 顶层：我的小说、参考与知识、设置；新建小说由小说列表进入。
- 单本：规划、写作、故事状态；质量与任务进度作为上下文侧栏。
- 写作：章节目录 + 居中正文 + 默认折叠辅助面板；宽屏三栏，窄屏切换抽屉。
- 白底、灰阶、一个强调色；正文 16px、约 1.9 行高、约 760px 阅读宽度作为起点，实测调整。
- 自动保存显示待保存/保存中/已保存/失败；切章前处理未保存输入；生成结果不能覆盖用户正在编辑的草稿。
- 普通工作区不注册或启停 Skill；SkillDefinition 由代码注册，SkillConfig 由独立本机 /admin 后台版本化配置，使用独立管理员会话，任务冻结配置；后台不提供任意代码上传。
- UI 不展示内部模块目录、Prompt 拼接、队列实现等技术细节；失败界面展示原因、当前阶段和可用操作。

## 8. 开发顺序与阶段验收

按以下顺序推进，每阶段有可运行、可验证的结果；不同时铺开八个模块。阶段内提交保持单一目标，当前操作不包含业务实现。

| 阶段 | 工作内容 | 完成标准 |
| --- | --- | --- |
| P0 基线 | 归档、分支、PRD、技术方案、AGENTS | 当前树不含旧源码与数据；归档可定位且校验完成 |
| P1 工程骨架 | web/server/contracts、迁移、配置、HTTP、空白页面、测试入口 | Windows 下 dev/build/typecheck/test 可执行；全新临时数据库可迁移；不需要真实 Key |
| P2 执行内核 | Job、阶段转换、小说互斥、候选版本、EvaluationResult、State 0/Delta/Snapshot、原子提交 | 假模型连续提交两章；所有失败点回滚；重复提交与重启恢复测试通过 |
| P3 模型与最小规划 | ChatAnyWhere 适配、Prompt 注册、能力配置；Book/Volume/Arc/Chapter 最小滚动规划 | 配置真实模型后跑通文本/流式/结构化契约；计划与初始事实分离；近期 5 章详细化 |
| P4 可用写作闭环 | Context、正文生成、审核/修复、抽取/验证、草稿编辑、SSE、TXT/Markdown 导出 | 从灵感创建项目并完成连续两章；只有 PASS + 状态提交才放行；浏览器断线可恢复观察 |
| P5 版本与连续生产 | 历史重写、后续失效、人工修改后重审、批量生产、滚动重规划 | 重写前章不污染当前链；失败停在当章；批量最多 10 章；批次结束不等于全书完结 |
| P6 Reference / Knowledge | TXT/EPUB 导入、逐章分析聚合、来源与覆盖度；Framework、资产清洗改编、Style、Template | 全文不截断；失败章节可重试；知识独立版本与绑定；不能把参考事实直接写入新状态 |
| P7 长篇上下文 | 全部状态类型在 P2 定义并验证；本阶段优化中文检索、分层摘要、StateContextResolver 与 Checkpoint 性能，按需启用 ChatAnyWhere Embedding | 跨远距离事实、角色信息差、未兑现伏笔可召回；排除未来/失效版本；可测成本与耗时 |
| P8 收尾验收 | 页面可用性、键盘/窄屏、备份恢复、启动说明、长篇基准、故障恢复 | 固定样本验收；干净环境可启动；新数据可备份恢复；无桌面依赖与旧代码复制 |

P2 使用与生产相同的模型接口注入假模型；P3/P4 替换适配器，不绕过已建立的状态机。P3 全书方向稳定、当前卷及 Arc 有概要、近期默认 5 章详细化；每章完成后检查规划依赖，默认剩余详细计划不足 2 章时补足到 5 章，发生关键偏离时先重规划再继续。

P2 的最小状态先覆盖 Canon、人物状态和事件；P7 扩展到 PRD 全部状态类型。任何尚未支持的 Delta 类型必须明确拒绝，不能静默忽略后完成章节。

P6 导入默认上限 20 MiB 压缩文件、100 MiB 解压总量、5000 个条目；原文完整保存，超过上限明确拒绝，不截断。TXT 显式选择 UTF-8/GB18030 并提供预览；EPUB 在服务端按 spine 提取文本、拒绝越界路径并限制解压资源。批次失败标记 PARTIAL，不能发布为完整 Reference Model。预算不足先停止等待用户处理，不自动抽样冒充全量分析。

P7 先实现中文文本检索与版本过滤。Embedding 为显式启用项；不可用时显示文本检索降级，不切换到其他供应商。向量记录模型、维度和内容版本；更换模型重建索引，不能混用维度。RAG 属于 Context Builder 的检索机制，不新增第九业务域。

## 9. 核心开发原则

1. **先定义不变量，再实现页面。** 页面和批量任务共用业务入口，禁止隐藏的第二条提交路径。
2. **只用当前仓库事实。** 不存在的文件、API、表、测试不得描述为已实现；文档中的目标目录不等于真实目录。
3. **先独立设计，再定点参考。** 仅带着具体问题打开第 11 节列出的旧文件；输出行为结论后关闭，重新写实现与测试。
4. **不搬旧抽象。** 不复制旧 Prompt、Schema、组件、测试和配置；框架惯用写法可以依据官方文档重新编写。
5. **计划、知识、事实隔离。** 输入版本固定，可追溯；模型无权直接覆盖当前事实。
6. **失败真实可见。** 不用默认分数、空事件和静默 catch 将失败包装为成功。
7. **唯一提交点。** 权威状态完整验证后一次提交；网络等待不进入数据库事务。
8. **串行是数据约束。** 不能只靠前端按钮禁用、内存 Map 或 for 循环宣称互斥。
9. **按需抽象。** 函数和清晰模块优先；不预建工厂、插件系统、消息总线和通用工作流平台。
10. **真实测试替代接口幻想。** 正常路径、恢复、冲突、幂等和版本失效都验证；不能只测 mock 是否被调用。
11. **模型输入可审计。** 固定 Prompt/配置版本，记录上下文选择与截断；必要事实放不下时阻断或重新组织，不硬塞超窗。
12. **当前阶段做完再扩展。** 不因为旧系统曾有债务面板、复杂回环或统计图，就自动恢复这些功能。

## 10. 风险点、注意事项与验证

| 风险 | 处理方式 | 核心验证 |
| --- | --- | --- |
| ChatAnyWhere 模型参数差异 | 能力档案、明确错误、固定配置版本 | 不支持参数、模型失效、JSON 不合法、空流/截断 |
| 多轮审核成本放大 | 有限重试/修复、用量统计、可取消 | 429 与格式错误叠加仍有总调用边界 |
| SQLite 写锁与进程中断 | 单进程 Worker、短事务、持久化阶段 | 提交各写入点故障注入；重启后不半提交 |
| 审核违规或异常被放行 | 统一 EvaluationResult 与完成判定 | FAIL/审核超时都不进入下一章 |
| 错误事实累积 | 证据定位、旧值前置条件、角色知识状态 | 同名角色、角色死亡、异地、知识泄露、物品归属 |
| 重写造成旧后文失效 | 回退当前链、标记后续过期、逐章重审 | N 重写后不能使用旧 N+1 状态 |
| 编辑与生成相互覆盖 | 工作草稿/候选/正式版本隔离，revision 冲突 | 多标签页、切章、生成期间编辑与自动保存 |
| 导入完整性与资源占用 | 完整存原文、覆盖度、解压边界、分批检查点 | 百万字、失败批次、编码、EPUB 越界与膨胀 |
| 参考文本影响系统指令 | 参考内容按不可信数据封装，不授予工具权限 | 书中包含“忽略规则”仍仅作为作品内容 |
| 长篇上下文超窗 | 按模型预算，预留输出，索引按有效版本过滤 | 远古伏笔、未来章节污染、超窗、索引落后 |
| 重新引入旧代码债 | 归档在工作区外，禁止复制，review 检查 | 不存在旧路径依赖、旧 runtime 分支和兼容接口 |

测试分层：领域纯函数使用 Vitest；集成测试使用独立临时 SQLite 和假模型 HTTP/SSE 服务；Playwright 验证创建到提交两章、失败重试、历史重写和断线恢复。真实 ChatAnyWhere 测试默认关闭，显式配置后才运行，记录实际模型和耗时，不在普通测试中消耗额度。

质量基准使用新建的小型中文样本与自有参考作品，按人物一致性、角色知识、伏笔延续、重复率和规划执行人工标注，再比较不同模型。首轮基准后确定数值阈值；不在没有测量时承诺“百万字稳定”或固定生成成本。

新数据备份首版采用停止 Worker 并关闭数据库后复制数据库及原文目录；运行中备份后续再用 SQLite 在线备份机制，不直接复制正在写入的单个 db 文件。备份恢复必须在临时目录实测。

## 11. 可供定点参考的旧代码位置

下列路径全部相对于归档根目录：

`C:/Users/gaijinchao/Desktop/code/tmp/One2Novel-legacy-20260905-124250/workspace`

| 参考位置 | 可以学习什么 | 明确不能继承什么 |
| --- | --- | --- |
| `server/src/platform/llm/aiService.ts` | Prompt 注册、任务分类 | 反向加载业务配置、旧模型默认值与 Prompt 原文 |
| `server/src/platform/llm/contextSelection.ts` | 上下文优先级、去重与选入记录 | 高优先级无条件突破硬预算 |
| `server/src/platform/llm/structuredInvoke.ts` | 结构化输出异常类型 | 通过猜字段、补空值掩盖语义错误 |
| `server/src/modules/novel/planning/referenceDeepAnalysis/` | 切章、分批分析、来源处理问题 | 批次失败返回空结果后宣称完成 |
| `server/src/modules/novel/planning/storyMacro/chapterDetailService.ts` | 本章目的、mustHit/mustAvoid 等执行约束 | 将旧 Novel JSON 字段当新领域模型 |
| `server/src/modules/novel/production/quality/qualityGate.ts` | 审核维度、问题证据与位置 | WARNING 放行、默认分数兜底 |
| `server/src/modules/novel/production/agents/dataAgent.ts` | 从正文提取事件和变化的需求 | 让抽取结果未经状态验证直接写事实 |
| `server/src/modules/novel/production/writing/chapterPipeline.ts` | 反例：提前完成、多阶段提交、后台状态更新 | 不作为新主流程模板 |
| `server/src/modules/novel/production/commit/` | 反例：单章单 Commit、投影重放和幂等问题 | 不复制其提交与重试实现 |
| `server/src/modules/novel/director/` | 进度、停止和断点需求 | 仅内存互斥、失败继续、批次完成即小说完结 |
| `client/src/components/layout/AppShell.tsx`、`client/src/index.css` | 纯白、留白、中文字体 | 不复制布局组件和旧工具栏 |
| `client/src/components/workspace/ChapterEditor.tsx` | 阅读与编辑操作体验 | 不复制编辑状态、保存 API 和 SSE 解析 |
| `docs/one2novel-full-explanation.md`、`docs/simplification-plan.md` | 演进原因和历史教训 | 不将历史计划当作新需求或当前实现 |

旧 `CLAUDE.md` 已归档，不是新项目指令。旧数据库、`.env`、user-preferences、desktop 和旧构建脚本不作为开发输入。需要验证时查官方文档或编写最小新测试，不通过运行旧项目得出新系统已支持的结论。

## 12. 文档维护与本次交付边界

本方案的个人本地部署、技术栈、默认修复次数、规划窗口、导入限制和开发阶段作为后续起点；用户后续调整时同步更新本文件与必要的 ADR，不能只在聊天中形成隐含规则。

当前不包含应用骨架、依赖安装、新数据库、真实模型请求和业务代码。P0 完成后下一项是 P1，不能跳到堆叠 UI 或批量写作。

公共资料核对日期为 2026-09-05：

- [ChatAnyWhere 官方仓库](https://github.com/chatanywhere/GPT_API_free) 与 [Chat Completions 示例](https://github.com/chatanywhere/GPT_API_free/blob/main/demo/openai_chat_completion_demo.py)：连接协议和基础地址；具体模型能力以后续实测为准。
- [Node.js 发布计划](https://github.com/nodejs/Release)：Node 24 LTS 基线。
- [Vite 官方指南](https://vite.dev/guide/) 与 [React TypeScript 指南](https://react.dev/learn/typescript)：前端工程依据。
- [Prisma 7 迁移命令](https://docs.prisma.io/docs/cli/v7/migrate) 与 [SQLite 适用场景](https://www.sqlite.org/whentouse.html)：数据库运行和迁移依据。
