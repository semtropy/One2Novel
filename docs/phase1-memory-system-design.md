# Phase 1：记忆系统增强 — 设计

## Context

**为什么需要这个改动？**

One2Novel 当前的上下文组装（`contextAssembler.ts`）做得很好——它按 priority 组装了 15+ 个 context block，包括 book_contract、chapter_mission、character_hard_facts、tiered compression、RAG 等。但有一个关键缺口：

**它没有"写前语义记忆注入"。**

写到第 50 章时，LLM 能看到：
- 当前章的任务（chapter_mission）
- 前 3 章的详细摘要（tier 1 adjacent）
- 前 10 章的关键事件（tier 2 recent）
- 上一卷的概要（tier 3）
- RAG 语义检索的相关片段

但它**看不到**的是：
- 第 5 章埋下的伏笔（open_loop）现在到了回收窗口
- 第 12 章确立的"角色 A 绝不信任角色 B"这条规则
- 第 30 章新揭示的世界规则"灵力只在夜间生效"
- 读者承诺（reader_promise）："说好要在这卷揭露身世"

webnovel-writer 的 MemoryOrchestrator 解决了这个问题——它在写前从**分类记忆库**中筛选出与当前章相关的语义记忆项，注入到 context 中。这不是简单的"前 N 章摘要"，而是**按 category 分类、按相关性过滤、按预算限制**的记忆注入。

One2Novel 已经有了大量相关基础设施：
- `EntityStateJournal` — 角色状态变更审计轨迹 ✅
- `EntityLifecycle` — 角色生死追踪 ✅
- `IncrementalSummary` — 每 10 章的结构化摘要 ✅
- `ChaseDebt` / `OverrideContract` — 追读力债务系统 ✅
- `PayoffLedgerItem` — 伏笔登记 ✅
- `WorldRule` — 世界规则 ✅
- `assembleChapterBlocks()` — 上下文组装管线 ✅

**差距在于**：这些数据结构是**被动查询**的（由各自的 block builder 按需读取），没有被**主动聚合**成一个写前记忆包（memory pack）。

## 设计目标

1. **对齐 wNW 的记忆注入能力**：写前从分类记忆中筛选相关项注入 context
2. **超越 wNW 的地方**：
   - 利用 One2Novel 已有的丰富 DB 模型（ChaseDebt、PayoffLedger、EntityLifecycle 等）
   - 利用已有的 tiered compression 做第一层过滤
   - 利用 RAG 做语义增强
3. **不照搬 wNW 的文件系统方案**：用 Prisma + DB 原生查询，不用 JSON scratchpad
4. **零破坏性**：不改现有 assembleChapterBlocks 的任何 block，新增独立的 `semantic_memory` block

## 架构设计

### 数据层：记忆项模型

新增 Prisma 模型 `MemoryItem`，对应 wNW 的 `memory_scratchpad.json` 但存储在 DB 中：

```prisma
model MemoryItem {
  id          String   @id @default(cuid())
  novelId     String
  category    String   // world_rule | character_state | relationship | story_fact | open_loop | reader_promise | timeline
  subject     String   // 主体：角色名/事件名/规则名
  field       String   // 字段：currentStatus | first_seen | rule_content 等
  value       String   // 值：具体的记忆内容
  payload     String?  // JSON: 扩展数据（urgency, source_chapter, evidence 等）
  status      String   @default("active") // active | outdated | contradicted | tentative
  sourceChapter Int
  evidence    String?  // JSON: 证据列表（哪些章节支持这条记忆）
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())

  @@index([novelId, category, status])
  @@index([novelId, sourceChapter])
  @@unique([novelId, category, subject, field])  // 去重 key
}
```

**为什么用 DB 而不是文件？**
- One2Novel 已经有完整的 Prisma 模型和查询能力
- 可以做 JOIN、WHERE、ORDER BY，不需要在应用层做 JSON 解析
- 事务保证一致性
- 和现有模型（EntityStateJournal、ChaseDebt 等）无缝集成

**与现有模型的映射关系：**

| wNW MemoryItem category | One2Novel 现有数据源 | 迁移方式 |
|------------------------|---------------------|---------|
| `character_state` | EntityStateJournal + NovelCharacter | 自动从 journal 迁移 |
| `world_rule` | WorldRule | 自动映射 |
| `open_loop` | PayoffLedgerItem (pending_payoff/overdue) + ChaseDebt | 自动映射 |
| `reader_promise` | PayoffLedgerItem (setup/hinted) | 自动映射 |
| `story_fact` | IncrementalSummary.keyEvents | 写入时抽取 |
| `timeline` | TimelineItem | 自动映射 |
| `relationship` | NovelCharacterRelation | 写入时抽取 |

### 服务层：三个新服务

#### 1. MemoryWriter（写后沉淀）

在 `processChapter()` 的 post-write hooks 中，新增 `handleMemoryWrite`：

```
processChapter()
  ├─ generateChapterContentCore()
  ├─ runQualityGate()
  ├─ repair (if needed)
  ├─ persist to DB
  └─ runPostWriteHooks()  ← 在这里新增
        ├─ ... existing handlers ...
        + handleMemoryWrite()  ← NEW
```

**职责：** 从已完成的章节内容中提取结构化事实，写入 MemoryItem 表。

**输入来源：** 利用现有的 `characterStateUpdater`（已提取 state_changes）和 `generateChapterSummary`（已提取 key_events），不再新增 LLM 调用。从这些 hook 的结果中抽取记忆项。

**具体映射：**
```typescript
// 从 characterStateUpdater 的 result 中提取
for (const update of result.updates) {
  upsertMemoryItem({
    category: "character_state",
    subject: update.characterName,
    field: update.currentStatus ? "currentStatus" : "currentLocation",
    value: update.currentStatus ?? update.currentLocation,
    sourceChapter: chapterOrder,
  });
}

// 从 chapterSummary 中提取 keyEvents
for (const event of summary.keyEvents) {
  upsertMemoryItem({
    category: "story_fact",
    subject: event,
    field: "event",
    value: event,
    sourceChapter: chapterOrder,
  });
}

// 从 IncrementalSummary 中提取 unresolvedPayoffs
for (const payoff of summary.unresolvedPayoffs) {
  upsertMemoryItem({
    category: "open_loop",
    subject: payoff,
    field: "status",
    value: "pending",
    sourceChapter: chapterOrder,
  });
}
```

**超越 wNW 的点：** wNW 需要 data-agent 单独调 LLM 提取事实；One2Novel 可以直接复用已有的 post-write hook 结果，零额外 LLM 调用。

#### 2. MemoryOrchestrator（写前注入）

在 `assembleChapterBlocks()` 中新增一个 block builder：

```typescript
// 在 assembleChapterBlocks() 中，在 tiered compression 之后添加
const memoryPack = await buildMemoryPack(novelId, chapterOrder);
if (memoryPack.injected.length > 0) {
  blocks.push(createContextBlock({
    id: "semantic_memory",
    group: "semantic_memory",
    priority: 92,  // 高于 tiered compression，低于 character_hard_facts
    content: compileMemoryPackContent(memoryPack),
    freshness: 1,
  }));
}
```

**职责：** 为指定章节构建记忆注入包。

**过滤策略（对齐 wNW 但更精细）：**

1. **时间窗口过滤**：只取 `sourceChapter >= currentChapter - 50` 的记忆（wNW 是 20，我们放宽到 50 因为已有 tiered compression 覆盖更早的内容）
2. **分类优先级**：`world_rule(0) > open_loop(1) > character_state(2) > relationship(3) > reader_promise(4) > story_fact(5) > timeline(6)`
3. **预算限制**：
   - working_memory（章纲 + 主角状态）：不限（已有 chapter_mission block）
   - semantic_memory：最多 25 条
   - active_constraints（world_rule + open_loop）：最多 10 条
4. **相关性过滤**：利用已有的 RAG 检索结果作为辅助信号（如果 RAG 检索到了某个主题，优先注入该主题的语义记忆）

**输出格式（注入到 context block）：**
```
【语义记忆 — 以下事实从历史章节沉淀，本章创作必须遵守】

== 世界规则（硬约束）==
• 灵力只在夜间生效（第30章揭示）
• 修炼者突破时需经历雷劫（第5章确立）

== 待回收伏笔（紧急）==
• 三年之约：已埋设15章，进入回收窗口（第30章埋设）
• 红衣女子的身份：读者承诺，预计在第80章前揭晓（第12章埋设）

== 角色状态（最近50章）==
• 萧炎：斗皇 → 斗宗（第45章突破，第48章确认）
• 药老：灵魂体 → 短暂凝聚（第42章）

== 角色关系变化 ==
• 萧炎 ↔ 云韵：信任度下降（第38章背叛事件后）
```

#### 3. MemoryBootstrap（一次性迁移）

启动时或首次写章时，从现有数据源批量迁移：

```typescript
async function bootstrapMemoryItems(novelId: string): Promise<void> {
  // 1. 从 WorldRule → world_rule 记忆项
  // 2. 从 EntityStateJournal → character_state 记忆项（取最新的）
  // 3. 从 PayoffLedgerItem → open_loop / reader_promise 记忆项
  // 4. 从 IncrementalSummary.keyEvents → story_fact 记忆项
  // 5. 从 NovelCharacterRelation → relationship 记忆项
  // 6. 从 TimelineItem → timeline 记忆项
}
```

### 预算控制

wNW 的 MemoryOrchestrator 有一个 `allocate_limits()` 函数按 task_type 分配预算：

```
write → semantic: 20, working: 5, episodic: 10
repair → semantic: 10, working: 3, episodic: 5
review → semantic: 5, working: 2, episodic: 3
```

One2Novel 的预算策略：

| 场景 | semantic 上限 | active_constraints 上限 | 说明 |
|------|-------------|----------------------|------|
| 正常写章 | 25 | 10 | 平衡注入量和 token 消耗 |
| 修复模式 | 15 | 8 | 修复时只需要关键约束 |
| 审查模式 | 8 | 5 | 审查时只需要事实核对 |

### 与现有系统的集成

```
                    ┌─────────────────────────────────────┐
                    │     assembleChapterBlocks()          │
                    │                                      │
                    │  book_contract (pri 104) ← 不变       │
                    │  chapter_mission (pri 100) ← 不变     │
                    │  character_hard_facts (pri 99) ← 不变  │
                    │  entity_lifecycle (pri 95) ← 不变     │
                    │  ★ semantic_memory (pri 92) ← 新增   │
                    │  payoff_directives (pri 98) ← 不变    │
                    │  story_macro (pri 98) ← 不变          │
                    │  tiered compression ← 不变            │
                    │  RAG context ← 不变                   │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │     processChapter()                  │
                    │                                      │
                    │  generateContent()                   │
                    │  qualityGate()                       │
                    │  repair()                            │
                    │  persist()                           │
                    │  runPostWriteHooks()                  │
                    │    ├─ handleTimeline ← 不变           │
                    │    ├─ handleChapterSummary ← 不变     │
                    │    ├─ handleRagIndex ← 不变           │
                    │    ├─ handleVolumeCompress ← 不变     │
                    │    ├─ handleCharacterState ← 不变     │
                    │    ├─ ★ handleMemoryWrite ← 新增     │
                    │    └─ ... 其他不变                   │
                    └─────────────────────────────────────┘
```

## 实施步骤

### Step 1: Prisma 模型 + 迁移（1h）
- 新增 `MemoryItem` 模型到 `schema.prisma`
- `pnpm db:push`
- 编写 `MemoryBootstrap` 服务，从现有数据源迁移

### Step 2: MemoryWriter 服务（2h）
- 实现 `memoryWriter.ts`：从 post-write hook 结果中提取记忆项
- 实现 `upsertMemoryItem()`：带去重和 outdated 标记
- 在 `postWriteBus.ts` 中注册新 handler

### Step 3: MemoryOrchestrator 服务（2h）
- 实现 `memoryOrchestrator.ts`：构建 memory pack
- 实现过滤策略（时间窗口 + 优先级 + 预算）
- 实现 `compileMemoryPackContent()`：格式化输出

### Step 4: 集成到 context assembler（1h）
- 在 `assembleChapterBlocks()` 中调用 MemoryOrchestrator
- 新增 `semantic_memory` context block
- 调整 priority 顺序

### Step 5: 测试和调优（1h）
- 验证 memory pack 内容准确性
- 调整预算参数
- 验证对 token 消耗的影响

**总计：约 7 小时**

## 不做什么（明确排除）

1. **不引入 wNW 的 scratchpad.json 文件存储** — 我们用 DB
2. **不引入独立的 data-agent LLM 调用** — 我们复用已有的 post-write hooks
3. **不引入 wNW 的 episodic memory（最近状态变更记录）** — 我们有 EntityStateJournal + entity_lifecycle block
4. **不做 wNW 的 memory compactor（超过阈值自动压缩）** — 我们的 IncrementalSummary 和 tiered compression 已经做了更细粒度的压缩
5. **不改现有的 qualityGate 分数体系** — memory 注入是 context 层的增强，不影响评分逻辑
