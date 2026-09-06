# One2Novel V2 业务架构与核心流程

## 一、核心业务域

One2Novel V2 只保留以下 8 个一级模块：

```text
reference/
knowledge/
planning/
production/
story-state/
evaluation/
orchestrator/
platform/
```

---

## 1. Reference

长篇分析使用版本化Reference Entity Registry，保存稳定身份、名称/别名、来源片段和最近出现位置。每个单元按名称命中、近期实体和历史检索构造有界候选，不把全量历史实体摘要逐章塞入Prompt。同名歧义保留待整理，恢复固定输入Registry版本，禁止读取未来分析结果。

职责：

> 将外部参考作品解析为系统可理解的结构化模型。

核心流程：

```text
参考小说
↓
导入 / 切分
↓
章节解析
↓
章节级理解
↓
跨章节聚合
↓
Reference Model
```

Reference Model 主要包含：

```text
章节
剧情事件
内容节拍
人物
场景
道具
设定
关系变化
状态变化
伏笔
时间线
钩子
情绪变化
结构信息
```

Reference 不负责直接生成新小说。

---

## 2. Knowledge

职责：

> 管理所有可复用、可影响创作，但不属于当前小说事实的知识。

包含：

```text
Knowledge
├── Framework
├── Asset Pack
├── Skill
├── Style
└── Template
```

### Framework

描述参考小说“怎么写”。

可以包含原小说剧情，同时保存：

```text
结构节点
事件序列
内容节拍
叙事功能
前置条件
后续影响
情绪变化
高潮分布
钩子分布
循环结构
结构曲线
统计规律
原剧情摘要
```

Framework 可以直接保留原小说剧情，生成新小说时由 Planning 控制不要机械照搬。

### Asset Pack

描述参考小说中“可以复用什么”。

包含：

```text
人物
场景
道具
组织
能力
世界规则
特殊设定
关系
台词
概念
其他内容资产
```

资产流程：

```text
Reference Model
↓
Raw Asset Pack
↓
资产清洗
↓
资产改编
↓
Adapted Asset Pack
```

Framework 与 Asset Pack 相互独立。

### Skill

Skill 是系统内部可插拔能力。SkillDefinition由代码注册，定义指令、参数schema和审核绑定；SkillConfig通过独立本机后台版本化配置启停、参数和适用条件。后台不进入普通工作区，不能上传任意代码。任务冻结配置版本，修改只影响新任务。

普通用户不直接操作。

Skill 只能通过：

```text
代码注册
或
后台管理系统配置
```

进行：

```text
Register
Enable
Disable
Configure
```

Skill 可以作用于：

```text
Planning
Production
Evaluation
```

例如：

```text
章节末钩子
对话去解释化
情绪递进
爽点设计
悬疑信息差
战斗节奏
伏笔设计
```

### Style

描述长期稳定的文字表达风格。

例如：

```text
第一人称
简洁
少修辞
高对白密度
冷峻
轻松
```

---

## 3. Planning

计划必须声明PlanAssumption：以状态集合、实体键、字段、比较操作和预期值表达成立前提。PlanDependency是这些前提的反向索引；Constraint表示剧情必须满足的义务，二者分离。每章提交后检查变化影响：硬前提失配使计划失效，软前提失配要求复核；下一章使用计划前必须完成检查。

职责：

> 描述未来准备发生什么。

输入：

```text
Idea
Genre
User Requirements
Current Story State
Knowledge Context
```

其中 Knowledge Context 可以包含：

```text
Framework
Adapted Asset Pack
Planning Skills
Style
Templates
```

规划层级：

```text
Book Plan
↓
Volume Plan
↓
Major Event / Arc Plan
↓
Chapter Plan
```

采用滚动规划：

```text
全书方向
↓
分卷方向
↓
当前卷主要事件
↓
近期章节详细规划
↓
当前章节
```

越高层越稳定，越低层越动态。

Planning 保存的是未来计划，不属于小说事实。

---

## 4. Production

职责：

> 根据当前 Plan、Story State 和 Knowledge 生产当前章节。

核心流程：

```text
Chapter Plan
+
Current Story State
+
Knowledge Context
↓
Context Builder
↓
Chapter Generation
↓
Draft
↓
Revision
↓
Candidate Chapter
```

Production 内部包含：

```text
context/
generation/
revision/
commit/
```

### Context Builder

StateContextResolver先从本章角色、事件、地点、计划前提、required Promise、活动冲突/目标及近期事件提取必要事实闭包，再由Context Builder按预算装配。角色当前观察版本与客观当前版本同时保留；硬事实超预算明确失败，不静默删减。

负责动态组装当前章节需要的上下文。

可能包含：

```text
小说核心设定
当前卷目标
当前主要事件
本章大纲
人物当前状态
人物关系
相关场景
世界规则
Narrative Promise
上一章
近期正文
历史相关正文
RAG 检索结果
Style
Writing Skills
```

RAG 只是 Context Builder 的检索机制，不是独立业务域。

---

## 5. Story State

职责：

> 保存小说当前真实状态。

Story State 与 Planning 必须严格分离。

```text
Plan
= 未来准备发生什么

Story State
= 到当前章节为止真正发生了什么
```

核心对象：

```text
StoryStateSnapshot
StoryStateDelta
```

Snapshot是每章可寻址的逻辑状态，不要求每章复制完整JSON。物理存储采用State 0与每20章的Checkpoint，加逐章不可变Delta；读取沿该快照父链重放并验证哈希。Checkpoint、Delta和正式正文在同一提交事务生效。

Story State 可以包含：

```text
Canon
Character State
Relationship State
World State
Location State
Item State
Organization State
Knowledge State
Timeline
Narrative Promise
Active Conflict
Active Goal
Custom State
```

### Narrative Promise

Promise是正文已建立的读者期待。Planning中的dueChapter只提供软期限提醒和重规划信号，不直接导致审核失败。只有ChapterPlan中required的推进/兑现动作，以及BookPlan显式最终兑现义务构成门禁；修改规划期限不修改事实状态。

统一管理：

```text
伏笔
悬念
秘密
未完成任务
待解决冲突
读者期待
```

### Knowledge State

记录角色在何时获知命题的哪个版本，以及KNOWS/BELIEVES/SUSPECTS/REJECTS态度。客观命题版本与角色观察版本分离。

例如：

```text
E10：门开，客观版本V1；角色A观察V1，learnedAtEvent=E10，attitude=KNOWS
E11：门关，客观版本V2；角色A未观察，仍引用V1，派生标记OUTDATED
角色B没有认知记录，不等于知道门关
```

避免角色获得不应知道的信息。

---

## 6. Evaluation

职责：

> 判断当前结果是否允许进入下一阶段。

Evaluation 是强制质量门禁，不是可选审核。

Evaluator由代码注册，EvaluationPolicy配置required/optional和参数，结果使用通用列表。默认策略包含下列八项；新增审核器不修改公共结果枚举。硬约束及状态一致性Core必须required且不能关闭，独立Delta验证同样不可关闭。

默认包含：

```text
Chapter Quality
Continuity
Plan Adherence
Logic
Character Consistency
Style
Repetition
State Consistency
```

统一输出：

```text
EvaluationResult

status:
PASS
FAIL

issues

suggestions

metrics
```

只有 PASS 才允许继续。

required中的BLOCKER、MAJOR、MINOR或低于阈值均FAIL，INFO可通过；required执行错误使任务失败，不补默认分数。optional只提供建议和诊断，不阻断提交。正文修改后重新执行冻结策略的审核。

---

## 7. Orchestrator

职责：

> 严格控制整个小说生产流程。

Orchestrator 不负责具体业务逻辑，只负责：

```text
当前执行到哪一步
下一步应该执行什么
是否满足进入下一步的条件
```

所有核心流程必须由 Orchestrator 串行控制。

单本小说禁止并行生产章节。

允许异步等待，但不允许并行修改小说状态。

原则：

```text
One Novel
=
One Sequential Execution Chain
```

---

## 8. Platform

职责：

> 提供底层技术能力。

包含：

```text
LLM
Embedding
RAG
Vector Store
Database
Storage
Queue
Cache
Job
Observability
Config
```

业务模块不直接依赖具体厂商或实现。

---

# 二、参考小说解析流程

```text
┌────────────────────┐
│      参考小说      │
└─────────┬──────────┘
          ↓
     Reference
          ↓
  Reference Model
          │
     ┌────┴────┐
     ↓         ↓
Framework   Raw Asset Pack
                │
                ↓
         Asset Clean / Adapt
                │
                ↓
        Adapted Asset Pack
```

输出进入 Knowledge。

---

# 三、新小说创建流程

```text
用户输入一句灵感
        │
        ↓
      题材
        │
        ↓
   用户创作要求
        │
        ↓
  创建 Novel Project
        │
   ┌────┴─────┐
   ↓          ↓
Framework   Asset Pack
 可选          可选
   │          │
   └────┬─────┘
        ↓
Knowledge Context
        │
        ↓
     Planning
```

Skill 不由普通用户选择。

Skill 由系统配置自动生效。

---

# 四、规划流程

```text
Idea
+
Genre
+
User Requirements
+
Current Story State
+
Knowledge Context
        │
        ↓
    Planning Engine
        │
        ↓
      Book Plan
        │
        ↓
     Volume Plan
        │
        ↓
 Major Event / Arc Plan
        │
        ↓
    Chapter Plan
        │
        ↓
  Rolling Planning
```

Framework 和 Asset Pack 在 Planning 阶段完成应用和改编。

---

# 五、核心写作流程

每一章必须作为一个完整事务执行。

```text
Chapter N
   │
   ↓
读取 Story State N-1
   │
   ↓
读取 Chapter Plan
   │
   ↓
解析当前有效 Knowledge
   │
   ↓
Context Builder
   │
   ↓
Chapter Generation
   │
   ↓
Draft
   │
   ↓
Evaluation
   │
 ┌─┴─────────────┐
 ↓               ↓
FAIL             PASS
 │                │
 ↓                ↓
Revision        Commit Content
 │                │
 └──→ Evaluation  ↓
             Event Extraction
                   │
                   ↓
              State Delta
                   │
                   ↓
             State Validation
                   │
             ┌─────┴─────┐
             ↓           ↓
           FAIL         PASS
             │           │
             ↓           ↓
        Repair State   Atomic Commit
                         │
                         ↓
                Story State N
                         │
                         ↓
                 Chapter Complete
                         │
                         ↓
                    Chapter N+1
```

---

# 六、章节完成条件

正文生成完成不等于章节完成。

章节必须同时满足：

```text
正文生成完成
+
正文质量审核通过
+
规划执行审核通过
+
连续性审核通过
+
事件抽取完成
+
Story State Delta 生成完成
+
State Validation 通过
+
Story State 更新成功
```

才允许：

```text
Chapter Status = COMPLETED
```

只有 `COMPLETED` 才能启动下一章。

---

# 七、Story State 更新流程

```text
Story State N-1
        +
Chapter N 正文
        ↓
Event Extraction
        ↓
Story Events
        ↓
State Transition
        ↓
StoryStateDelta
        ↓
State Validation
        ↓
Atomic Commit
        ↓
Story State N
```

原则：

```text
Event
↓
State Change
```

不直接让模型任意覆盖当前状态。

---

# 八、章节状态机

```text
PLANNED
↓
CONTEXT_BUILDING
↓
WRITING
↓
EVALUATING
↓
REVISING
↓
APPROVED
↓
EXTRACTING_STATE_DELTA
↓
VALIDATING_STATE
↓
COMMITTING
↓
COMPLETED
```

失败时：

```text
FAILED
```

允许从对应阶段重试。

---

# 九、严格串行原则

单本小说禁止：

```text
Chapter 100
Chapter 101
Chapter 102
```

同时生成。

必须：

```text
Chapter 100
↓
Evaluation PASS
↓
Story State 100 更新成功
↓
Chapter 100 COMPLETED
↓
Chapter 101
```

允许异步：

```text
等待 LLM
等待审核
等待用户
等待后台任务
```

但不允许多个章节并发修改 Story State。

---

# 十、状态更新原子性

一章可能同时改变：

```text
人物状态
人物关系
道具状态
世界状态
时间线
角色知识
伏笔
任务
冲突
```

这些变化先统一形成：

```text
StoryStateDelta
```

完整验证后再一次性提交。

不允许分别写入形成半完成状态。

```text
State Snapshot N-1
        +
State Delta N
        ↓
Atomic Commit
        ↓
State Snapshot N
```

如果失败：

```text
State Snapshot N-1
```

仍然是当前有效状态。

---

# 十一、版本机制

核心对象必须支持版本化：

```text
Reference Model
Knowledge
Plan
Content
Story State
Evaluation
```

例如重写第 81 章：

```text
Chapter 81 v1
↓
State 81 v1

重新生成

Chapter 81 v2
↓
State 81 v2
```

旧版本不直接覆盖。

当前版本通过 active version 指向。

---

# 十二、模块关系

```text
Reference
   │
   ↓
Knowledge
   │
   ├───────────────┐
   ↓               ↓
Planning       Production
   │               ↑
   ↓               │
 Plan         Story State
   │               │
   └──────┬────────┘
          ↓
      Production
          ↓
        Content
          ↓
      Evaluation
      ↑       │
      │ FAIL  │ PASS
      └───────┘
              ↓
        State Delta
              ↓
        Story State
              ↓
         Next Chapter
```

所有流程切换由：

```text
Orchestrator
```

控制。

---

# 十三、最终完整流程

```text
                           Reference Novel
                                 │
                                 ↓
                             Reference
                                 │
                                 ↓
                         Reference Model
                                 │
                     ┌───────────┴───────────┐
                     ↓                       ↓
                 Framework              Raw Assets
                                             │
                                             ↓
                                      Asset Adaptation
                                             │
                                             ↓
                                      Adapted Assets
                     └───────────┬───────────┘
                                 ↓
                             Knowledge


User Idea ───────────────────────┐
Genre ───────────────────────────┤
User Requirements ───────────────┤
Current Story State ─────────────┤
Knowledge ───────────────────────┘
                                 │
                                 ↓
                             Planning
                                 │
                                 ↓
                              Book Plan
                                 │
                                 ↓
                            Volume Plan
                                 │
                                 ↓
                         Major Event Plan
                                 │
                                 ↓
                           Chapter Plan
                                 │
                                 ↓
                         ┌───────────────┐
                         │ Orchestrator  │
                         └───────┬───────┘
                                 ↓
                         Read Story State
                                 │
                                 ↓
                         Context Builder
                                 │
                                 ↓
                           Production
                                 │
                                 ↓
                               Draft
                                 │
                                 ↓
                           Evaluation
                          ↙          ↘
                       FAIL          PASS
                        │              │
                        ↓              ↓
                    Revision      Commit Content
                        │              │
                        └───────→      ↓
                                 Event Extraction
                                        │
                                        ↓
                                   State Delta
                                        │
                                        ↓
                                 State Validation
                                  ↙            ↘
                               FAIL            PASS
                                │                │
                                ↓                ↓
                             Repair        Atomic Commit
                                                  │
                                                  ↓
                                          New Story State
                                                  │
                                                  ↓
                                          Chapter Complete
                                                  │
                                                  ↓
                                         Rolling Replanning
                                                  │
                                                  ↓
                                             Next Chapter
```

---

# 十四、最终一级目录

```text
one2novel/
│
├── reference/
│
├── knowledge/
│   ├── framework/
│   ├── asset/
│   ├── skill/
│   ├── style/
│   └── template/
│
├── planning/
│
├── production/
│   ├── context/
│   ├── generation/
│   ├── revision/
│   └── commit/
│
├── story-state/
│   ├── snapshot/
│   ├── delta/
│   ├── events/
│   └── validation/
│
├── evaluation/
│
├── orchestrator/
│
└── platform/
    ├── llm/
    ├── embedding/
    ├── rag/
    ├── vector-store/
    ├── database/
    ├── storage/
    ├── queue/
    ├── cache/
    ├── jobs/
    └── observability/
```
