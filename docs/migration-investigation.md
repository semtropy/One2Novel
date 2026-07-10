# One2Novel vs webnovel-writer 迁移调查报告

## 一、项目定位对比

| | **One2Novel** | **webnovel-writer** |
|---|---|---|
| 形态 | 桌面/Web 应用（React + Express + SQLite） | Claude Code 插件（Python 脚本 + Claude Agents） |
| 运行方式 | 自托管服务 + 前端 UI | 跑在 Claude Code REPL 里的 Skill + Agent |
| 持久化 | Prisma + SQLite（结构化数据库） | 文件系统 JSON + SQLite（index.db）+ .webnovel/ 目录 |
| AI 调用 | 服务端 `aiService.ts` → LangChain → 多模型 | Claude Code LLM 本身 + Python CLI 脚本辅助 |
| 核心差异 | **全栈应用，有 UI，有 SSE 流式写作** | **纯 CLI/Agent 工作流，无 UI，靠 Claude 对话驱动** |

一句话：One2Novel 是一个**产品**，webnovel-writer 是一套**操作手册**（用 Claude Code 的能力编排的写作 SOP）。两者互补而非互斥。

---

## 二、webnovel-writer 三大核心系统

### 2.1 章节写作系统

**流程（6 Steps）：**

```
/webnovel-write {章号}
  ├─ 预检：preflight + placeholder-scan
  ├─ 刷新合同：story-system 生成 MASTER_SETTING + chapter + volume + review contracts
  ├─ Step 1: context-agent → 写作任务书（五段）
  ├─ Step 2: 根据任务书起草正文
  ├─ Step 3: reviewer agent → 五维审查 JSON（setting/timeline/continuity/character/logic）
  ├─ Step 4: 润色（非 blocking 修复 → 风格适配 → 排版 → Anti-AI 终检）
  ├─ Step 5: 提交
  │   ├─ 5.1 data-agent → 三份 artifact（fulfillment/disambiguation/extraction）
  │   ├─ 5.2 precommit gate → chapter-commit → 投影（state/index/summary/memory/vector）
  │   └─ 5.3 postcommit gate → 投影验证
  └─ Step 6: Git 备份
```

**关键设计原则：**
- **写前查合同**：每章动笔前必须加载 MASTER_SETTING.json、volume_brief.json、chapter_brief.json、review.json
- **写后必须提交**：正文写完不等于结束，必须经过 data-agent 提取事实 → chapter-commit 入账 → 投影更新所有下游 read model
- **审查只跑一轮**：blocking issue 定点修复或用户裁决，不循环
- **失败只补跑失败步骤**，不回退到 Step 1

### 2.2 记忆系统

**三层记忆架构：**

```
┌─────────────────────────────────────────────────┐
│              Working Memory（工作记忆）            │
│  • 章纲摘要（当前章）                              │
│  • 最近3章剧情摘要（.webnovel/summaries/chNNNN.md）│
│  • state.json 导出的主角状态                       │
├─────────────────────────────────────────────────┤
│              Episodic Memory（情景记忆）           │
│  • 最近状态变更记录（index.db.state_changes）      │
│  • 最近关系变化（index.db.relationships）          │
│  • 最近实体出场（index.db.appearances）            │
├─────────────────────────────────────────────────┤
│              Semantic Memory（语义记忆）           │
│  • .webnovel/memory_scratchpad.json              │
│    ├── character_state                           │
│    ├── story_facts                               │
│    ├── world_rules                               │
│    ├── timeline                                  │
│    ├── open_loops                                │
│    ├── reader_promises                           │
│    └── relationships                             │
└─────────────────────────────────────────────────┘
```

**MemoryOrchestrator 工作机制（写前注入）：**

```python
memory_pack = orchestrator.build_memory_pack(chapter=100, task_type="write")
# 返回：
{
  "working_memory": [...],       # 章纲 + 近3章摘要 + 主角状态
  "episodic_memory": [...],      # 最近状态变更/关系/出场
  "semantic_memory": [...],      # 筛选后的长期记忆项
  "long_term_facts": [...],      # 注入到 LLM prompt 的记忆
  "active_constraints": [...],   # world_rule + open_loop
  "recent_changes": [...],       # 最近状态变化
  "stats": {...}                 # 注入统计
}
```

**记忆过滤策略：**
1. 按章纲关键词匹配（subject/field/value 是否在章纲中出现）
2. 时间窗口过滤（来源章节 ≤ 当前章 - 20）
3. 优先级排序（world_rule > character_state > relationship > story_fact > open_loop > reader_promise > timeline）
4. 预算限制（semantic 最多 N 条，working 最多 N 条，episodic 最多 N 条）

**MemoryWriter（写后沉淀）：**

从 data-agent 的 extraction_result 中提取事实，映射为 MemoryItem：
- `state_changes` → character_state
- `entities_new` → character_state.first_seen
- `relationships_new` → relationship
- `memory_facts.timeline_events` → timeline
- `memory_facts.world_rules` → world_rule
- `memory_facts.open_loops` → open_loop
- `memory_facts.reader_promises` → reader_promise

**去重策略：** 按 `(category, subject, field)` 计算 key，同 key 旧值标记为 `outdated`，新值 upsert。

### 2.3 子 Agent 系统

webnovel-writer 定义了 4 个 Claude Code Agent（`.claude/agents/`）：

| Agent | 职责 | 工具 | 输出 |
|-------|------|------|------|
| **context-agent** | 写前 research，生成写作任务书 | Read, Grep, Bash | 五段写作任务书（不落地） |
| **reviewer** | 五维事实审查 | Read, Grep, Bash | 结构化 JSON（issues + dimension_results） |
| **data-agent** | 从正文提取结构化事实 | Read, Write, Bash | 三份 JSON artifact |
| **deconstruction-agent** | 拆文学习 | Read, Grep, Bash | 题材写法笔记 |

**Agent 编排方式：**

在 `SKILL.md` 中用 `Agent` 工具调用：
```
Use the Agent tool to run `webnovel-writer:context-agent`.
```

每个 Agent 有独立的 `.md` 定义文件，包含：身份、工具、流程、边界、校验清单、输出 schema、错误处理、SubagentRun 汇总信号。

**SubagentRun 汇总：** 主流程在每个 Agent 调用后记录：
```json
{
  "name": "context-agent",
  "status": "completed | partial | failed | skipped",
  "problems": ["上下文不足"],
  "auto_handled": ["legacy fallback"],
  "needs_user_action": false,
  "duration_ms": 12000,
  "outputs": ["写作任务书"]
}
```

---

## 三、One2Novel 现有能力对照

| webnovel-writer 能力 | One2Novel 对应实现 | 差距 |
|---------------------|-------------------|------|
| 合同系统（.story-system/*.json） | DirectorCheckpoint + pipelineState（Novel 表 JSON 列） | One2Novel 用 DB 字段存，wNW 用文件存 |
| Context Agent（写前 research） | assembleChapterContext() 已做类似事 | ✅ 已有，但 wNW 的 context_manager.py 更分层 |
| Memory Orchestrator（三层记忆） | EntityStateJournal + IncrementalSummary + memory_scratchpad 概念 | One2Novel 用 DB 表，wNW 用 JSON scratchpad + SQLite index.db |
| Memory Writer（写后沉淀） | runPostWriteHooks() 中有 character state update、summary compression | ✅ 已有，但 wNW 的 MemoryWriter 有更细的 category 映射 |
| Reviewer Agent（五维审查） | runQualityGate() 10维度评分 | One2Novel 评分制，wNW 问题清单制 |
| Data Agent（事实提取） | generateChapterContentCore 包含 extraction？ | ❌ One2Novel 无独立 data-agent |
| Chapter Commit + Projection | processChapter() 直接更新 DB | One2Novel 直接写，wNW 有 commit→projection 链 |
| 5 个 Projection Writers | Prisma 直接更新 | wNW 是 read-model 投影，One2Novel 是单一 DB |
| Sub-Agent 编排 | 同步函数链（processChapter） | wNW 用 Claude Agent 工具，One2Novel 是代码调用 |
| Story System Engine（CSV 题材路由） | architectureType 枚举 | wNW 有 37 个题材模板 + CSV 检索 |
| RAG 上下文增强 | contextSelection.ts 有 context block selection | ✅ 已有类似机制 |
| 追读力债务系统 | ChaseDebt + OverrideContract 表 | ✅ One2Novel 甚至更完整（有 DebtEvent 日志） |
| 写章恢复断点 | checkpointService.ts | ✅ 两者都有 |
| Git 备份 | ❌ 无 | wNW 有 backup_manager |
| Dashboard | StatisticsDashboard 组件 | wNW 有独立只读前端 |

---

## 四、迁移建议

### 4.1 可直接借鉴（高价值、低改造成本）

#### A. 记忆系统的 Scratchpad 架构

**现状：** One2Novel 用 EntityStateJournal（DB 表）记录状态变更，用 IncrementalSummary 做章节摘要压缩。

**可借鉴：** wNW 的 `memory_scratchpad.json` 提供了**结构化分类记忆**（character_state / world_rule / open_loop / reader_promise / timeline），比 One2Novel 的通用 journal 更利于**写前精准注入**。

**迁移方案：**
1. 在 One2Novel 新增一张 `MemoryItem` 表（对应 ScratchpadManager 的存储），字段：`category, subject, field, value, status, source_chapter`
2. 新增 `MemoryOrchestrator` 服务（复用现有的 contextSelection.ts 框架），在写章前构建 memory_pack
3. 在 `assembleChapterContext()` 中注入 semantic_memory 和 working_memory
4. 在 `processChapter()` 的 post-write hooks 中增加 MemoryWriter 步骤

#### B. Reviewer 的问题清单模式

**现状：** One2Novel 的 qualityGate 返回 10 个维度的分数 + verdict（PASS/WARNING/NEEDS_FIX）。

**可借鉴：** wNW 的 reviewer 返回**具体问题清单**（每个 issue 有 severity/category/evidence/fix_hint/blocking），比单纯打分更有可操作性。

**迁移方案：**
1. 在 qualityGate 的输出中增加 `issues[]` 数组（类似 AuditIssue 但更结构化）
2. 增加 `dimension_results` 字段（5 个维度各一个 pass/发现问题结论）
3. 区分 blocking vs non-blocking，blocking 必须定点修复或用户裁决

#### C. Chapter Commit + Projection 模式

**现状：** One2Novel 的 `processChapter()` 生成内容 → 质量门 → 修复 → 直接写 DB。

**可借鉴：** wNW 的 commit 是**不可变的事实账本**，projection 是**派生 read model**。这样即使 projection 失败也不影响正文。

**迁移方案：**
1. 在 Novel 表或新建 Commit 表中增加 `ChapterCommit` 记录（含 review_result, extraction_result, projection_status）
2. 将现有的直接 DB 更新改为 commit → 异步 projection
3. 投影目标：state（主角快照）、index（实体索引）、summary（章节摘要）、memory（语义记忆）、vector（RAG 向量）

### 4.2 需要重构（中等成本）

#### D. 子 Agent 化

**现状：** One2Novel 的 pipeline 是同步函数链（generate → quality → repair → persist → hooks）。

**可借鉴：** wNW 把 context-research、review、data-extraction 拆成独立 Agent，每个有明确的输入/输出/边界。

**迁移方案：**
1. 在 One2Novel server 中定义 Agent 接口（类似现有的 AIService 接口）
2. 将 `assembleChapterContext()` 拆为 ContextAgent（独立 LLM 调用，返回写作任务书）
3. 将 qualityGate 拆为 ReviewerAgent（返回问题清单而非分数）
4. 新增 DataAgent（从正文提取实体/关系/状态变更/伏笔）
5. 主 pipeline 改为编排这些 Agent，而非直接调用函数

#### E. 合同系统

**现状：** One2Novel 的设定信息分散在 Novel 表的多个 JSON 列中（loopSkeleton, goldenFinger, powerSystemTree, architectureProfile）。

**可借鉴：** wNW 的 `.story-system/` 目录将合同分层（MASTER_SETTING / volume_brief / chapter_brief / review_contract），每层有明确的锁定/追加/可覆盖策略。

**迁移方案：**
1. 新建 `StoryContract` 表族（master_contract, volume_contract, chapter_contract, review_contract）
2. 实现 contract merge 逻辑（locked / append_only / override_allowed）
3. 在写章前加载 chapter_contract 作为上下文的一部分

### 4.3 暂不迁移（不适用场景）

| wNW 特性 | 原因 |
|----------|------|
| Python CLI 脚本 | One2Novel 是 TS/JS 栈，不需要 Python 中间层 |
| CSV 题材路由 | One2Novel 已有 architectureType 枚举 + 丰富的 Novel 字段 |
| Git 备份 | One2Novel 有 DB 级持久化 + checkpoint，不需要文件级 git 备份 |
| SubagentRun 汇总信号 | 这是 Claude Code 插件特有的，One2Novel 有自己的 event bus |
| 写前占位符扫描 | One2Novel 有 prewrite validation（prewrite_validator 等价物在 qualityGate） |

---

## 五、推荐实施路线

### Phase 1：记忆系统增强（2-3 周）

1. 新增 `MemoryItem` Prisma 模型
2. 实现 `MemoryOrchestrator` 服务（写前构建 memory_pack）
3. 实现 `MemoryWriter` 服务（写后从 extraction 沉淀记忆）
4. 在 `assembleChapterContext()` 中注入 memory_pack
5. 在 `runPostWriteHooks()` 中增加 memory writer 步骤

**收益：** 写到第 50+ 章时，LLM 仍能精准召回相关设定和伏笔。

### Phase 2：Reviewer 升级（1-2 周）

1. qualityGate 输出增加 `issues[]` 数组
2. 增加 dimension_results（5 维度 pass/fail）
3. 区分 blocking vs non-blocking
4. 前端 ReviewPanel 显示问题清单而非仅分数

**收益：** 作者能看到具体问题（"萧炎此刻应该在云岚城，但正文写成了帝都"）而非抽象分数。

### Phase 3：Commit + Projection 模式（2-3 周）

1. 新增 ChapterCommit Prisma 模型
2. 将 processChapter 改为 commit → 异步 projection
3. 实现 5 个 projection writer（state/index/summary/memory/vector）
4. 实现 projection retry/replay

**收益：** 事实账本不可篡改，投影可独立修复；支持章节回滚和重放。

### Phase 4：子 Agent 化（3-4 周）

1. 定义 Agent 接口和编排器
2. 实现 ContextAgent（独立 LLM 调用，返回写作任务书）
3. 实现 ReviewerAgent（独立 LLM 调用，返回问题清单）
4. 实现 DataAgent（独立 LLM 调用，返回结构化事实）
5. 重构 pipeline 为 Agent 编排

**收益：** 每个 Agent 可独立优化、替换模型、并行执行；代码更模块化。

---

## 六、架构对比图

### webnovel-writer 架构

```
用户: /webnovel-write 45
  │
  ├─ preflight ──→ 检查项目健康
  ├─ story-system ──→ 生成 contracts (MASTER/volume/chapter/review)
  │
  ├─ [Agent: context-agent] ──→ 写作任务书 (五段)
  │     ├─ load-context (基础包: contracts + summaries + memory)
  │     ├─ query-entity / query-rules / get-timeline (按需)
  │     └─ 组装五段任务书
  │
  ├─ 起草正文 (根据任务书)
  │
  ├─ [Agent: reviewer] ──→ 五维审查 JSON
  │     ├─ setting / timeline / continuity / character / logic
  │     └─ issues[] + dimension_results[]
  │
  ├─ 润色 (非 blocking 修复 → 风格 → 排版 → Anti-AI)
  │
  ├─ [Agent: data-agent] ──→ 三份 artifact
  │     ├─ fulfillment_result.json
  │     ├─ disambiguation_result.json
  │     └─ extraction_result.json
  │
  ├─ write-gate (precommit)
  ├─ chapter-commit ──→ accepted/rejected
  │     └─ apply_projections ──→ state/index/summary/memory/vector
  │
  └─ backup (git)
```

### One2Novel 当前架构

```
用户: POST /api/novels/:id/chapters/:id/stream 或 /director
  │
  ├─ generateChapterContentCore() ──→ 正文文本 (SSE token stream)
  │     └─ invokeAsset() → contextSelection → LLM
  │
  └─ processChapter() ──→ pipeline
        ├─ buildCharacterProhibitions()
        ├─ runQualityGate() ──→ 10维度分数 + verdict
        ├─ patchRepair() / heavyRepair() (if NEEDS_FIX)
        ├─ runQualityGate() (recheck)
        ├─ persistQualityScores()
        ├─ runPostWriteHooks() (fire-and-forget)
        │     ├─ reExtractChapterTimeline()
        │     ├─ compressIncrementalSummary()
        │     └─ updateCharacterState()
        └─ finalizeChapter() + diagnoseWorkspace() (fire-and-forget)
```

### One2Novel 目标架构（迁移后）

```
用户: POST /api/novels/:id/chapters/:id/stream 或 /director
  │
  ├─ [Agent: ContextAgent] ──→ 写作任务书
  │     ├─ load contracts (master/volume/chapter/review)
  │     ├─ load memory_pack (working + episodic + semantic)
  │     ├─ RAG query (按需)
  │     └─ 组装任务书
  │
  ├─ generateChapterContentCore() ──→ 正文文本
  │
  ├─ [Agent: ReviewerAgent] ──→ 问题清单 JSON
  │     ├─ setting / timeline / continuity / character / logic
  │     └─ issues[] (blocking/non-blocking)
  │
  ├─ 润色 (非 blocking 修复 → 风格 → Anti-AI)
  │
  ├─ [Agent: DataAgent] ──→ 结构化事实
  │     ├─ entity_deltas
  │     ├─ state_deltas
  │     ├─ accepted_events
  │     └─ summary + scenes
  │
  ├─ ChapterCommit ──→ accepted/rejected
  │     └─ Projections (async)
  │           ├─ StateProjectionWriter
  │           ├─ IndexProjectionWriter
  │           ├─ SummaryProjectionWriter
  │           ├─ MemoryProjectionWriter
  │           └─ VectorProjectionWriter
  │
  └─ 更新 chapterStatus + SSE complete
```

---

## 七、关键技术决策

### Q1: 记忆存储用 DB 还是文件？
**建议：DB（Prisma）**。One2Novel 已有完整的 Prisma 模型和 ORM，用 DB 可获得更好的查询能力和事务保证。wNW 用 JSON 文件是因为它跑在 Claude Code 里，没有持久化数据库。

### Q2: Agent 用代码调用还是 Claude Code Agent 工具？
**建议：代码调用**。One2Novel 是服务端应用，不是 Claude Code 插件。所谓的 "Agent" 是指**职责分离的服务模块**，通过 AIService 调用 LLM，而非 Claude Code 的 Agent 工具。

### Q3: 是否保留现有的 qualityGate 分数制？
**建议：保留 + 增强**。分数制适合自动化决策（是否 repair），问题清单制适合人类阅读。两者并存：qualityGate 返回 `{score, verdict, issues[], dimensionResults[]}`。

### Q4: Commit 模式是否值得引入？
**建议：值得**。对于长篇创作（200+ 章），不可变的事实账本能有效防止数据漂移。即使不引入完整的 projection 链，至少增加 ChapterCommit 表记录每章的最终状态。

---

## 八、风险与注意事项

1. **Token 预算**：引入 memory_pack 会增加写章前的 context 长度，需要控制 semantic_memory 的注入量（建议 ≤ 30 条）
2. **性能**：ReviewerAgent 和 DataAgent 各增加一次 LLM 调用，写章时间可能增加 30-60 秒
3. **数据迁移**：现有项目的 EntityStateJournal 和 IncrementalSummary 可以逐步迁移到新的 MemoryItem 模型
4. **兼容性**：新的 commit 模式应支持回退到旧的直接写入模式（通过配置开关）
5. **wNW 的 GPL v3 许可证**：其代码不能直接复制到 One2Novel（MIT/Apache），但架构思路和算法逻辑可以借鉴
