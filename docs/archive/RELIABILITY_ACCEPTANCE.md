> 历史归档：仅供定点追溯，不作为当前规范或进度。当前入口见[开发约定](../../AGENTS.md)与[剩余清单](../../REMAINING_WORK.md)。

# 可靠性补强验收记录

## 2026-09-08：初始设定修改与State 0重建（P06继续）

- 已确认但有效链尚无正文时，工作区允许修改初始设定、保存待确认候选、刷新后确认重建。保存候选不替换正式事实；编辑使用打开表单时的revision，警告确认随候选版本重置。
- 复用opening-candidates/opening-confirmations接口。重建创建新Canon、初始事件和命题版本，重新映射事实及角色观察引用，实体身份保留；Book与前提重新绑定新State 0。旧快照、命题、正文历史和草稿不覆盖。
- 候选记录基础快照；确认重新检查基础、项目revision、执行锁、知识、警告与全部前提。原子提交新根快照和正式方案，同时推进chainEpoch，使旧任务及旧链滚动计划不能继续使用；确认记录保存新旧开篇关联。
- 有正式正文时接口返回REWRITE_REQUIRED，须通过已有重写预览/确认从第一章回退后再重建。提交事务失败不替换原开篇；同一过期候选不能重复确认。
- 项目响应保证包含当前正式开书版本，避免它被最近40项产物分页挤出。已提交正文时面板展示正式方案，而非未确认候选。

验证：类型检查、构建、全量Vitest 67项通过；`pnpm test:e2e`全部5项通过，包含新增的“修改候选→刷新→重建→保留草稿→首章提交”流程。未调用真实模型或修改用户小说数据。

剩余：初卷/Arc独立确认、四级计划编辑/依赖管理和完整语义开篇审核仍待实现，不将P06或完整V2标记全部完成。

## 2026-09-08：开书前提与State 0绑定（P06部分）

- 开书确认按初始事实及命题版本逐项检查Book前提；HARD/SOFT的MISMATCH或UNKNOWN均要求修订候选，不能仅确认警告绕过。
- 选择器限定合法集合、字段和实体键；EXISTS要求布尔值，CONTAINS校验类型，已知null与缺失事实分别处理；重复前提ID被拒绝。
- 预分配State 0 ID，正式OPENING中的Book及全部前提绑定该ID；快照、命题版本、首章、正式开书版本、OPENING_CONFIRMATION追溯记录和项目指针在同一事务写入。原候选保持不变。
- 确认记录保存原候选ID/hash、正式版本ID、State 0 ID和逐项检查结果，可通过项目产物列表读取。Book逻辑节点ID保留，产物ID区分候选与正式版本。
- 本次变更只影响新的开书确认，不迁移已有小说。State 0重建、初卷/Arc确认和完整计划编辑仍未实现。

验证：新增前提语义、HARD/SOFT拒绝、未知事实、外来快照、事务故障回滚及确认后生产测试。`pnpm typecheck`、`pnpm build`通过，`pnpm test`全量64项通过，`pnpm test:e2e`浏览器4项通过。测试使用隔离SQLite与FakeModel，未调用真实模型或修改现有小说数据。

## 2026-09-07：等待处理与新输入解困（O03最小闭环）

- 修复批次`WAITING_USER`子章不被`retryBatch`接受的问题。恢复仍使用同一子任务、候选和冻结配置，不清零已用HTTP/修复次数；HTTP或明确耗尽的正文/状态修复额度须先增加。
- 进入`WAITING_USER`时，与失败状态及释放锁同事务保存不可变`RECOVERY`产物：失败阶段、根因代码/说明、候选正文ID、可调整输入（额度、草稿、知识、引用授权）。
- `GET /api/v1/jobs/:id/recovery`返回根任务及待处理子章、失败记录、`canResume/canRestart/needsBudget/reason`。面板按服务端资格显示恢复状态；这不是所有Job的完整allowedActions实现。
- 新命令冻结当前`openingId`；恢复核对全书版本、基础快照/epoch、知识与引用授权。手稿审核还核对原草稿revision，修改后返回STALE_INPUT，不替换旧冻结文本。
- `POST /api/v1/jobs/:id/restart`接收`expectedRevision/projectRevision/mode/draftRevision`和幂等键。只允许未完成、已停止的顶层章节/批次任务；新建当前head+1的单章命令，同时结束旧任务及未完成子章、记录新旧Job关联，并获取小说锁。整个事务失败则旧任务不变；重复请求返回同一新Job。
- 工作区支持「查看失败候选」→「载入此候选到草稿」→修改→「审核并提交草稿」，以及「按当前输入重新生成」。新输入仍走规划、审核、抽取和唯一原子提交；旧候选、原输入、用量保留，旧批次不自动续写。

验证：`pnpm typecheck`、`pnpm test`（58项）、`pnpm build`和`pnpm test:e2e`（4项）通过。新增集成断言涵盖增额门禁、原计数/配置保留、草稿过期、重启事务故障回滚与幂等、WAITING_USER批次恢复、HTTP重新开始保留前章且不续写后章。原MINOR修复耗尽用例同步增加“先显式增额”的检查，符合开发细则默认预算规则。

独立Python Playwright解困流程`tests/e2e/recovery_flow.py`已通过，截图为Git忽略的`test-results/recovery-completed.png`。执行前先构建，再单独启动`pnpm exec tsx tests/e2e/server.ts`，另一终端运行`python tests/e2e/recovery_flow.py`（需要Python Playwright及本机Chrome）。该脚本只能对隔离测试服务运行；测试用世界规则标记与失败注入仅在`tests/e2e/server.ts`中生效，生产没有假模型开关。首次脚本运行的最终API断言因缺少绝对URL失败，修正后完整通过。

限制：全书/未来计划编辑及联动仍待P01；已确认Canon不能通过此入口直接修改。新命令按当前配置重新计预算，旧任务消耗完整保留，不表示免费恢复。模型语义效果未做真实API验收。本轮没有修改用户数据库或重启生产服务。

## 2026-09-07：历史状态审核与复活许可回放（F05）

本次延续现有未提交工作，仅补历史状态校验，不修改用户数据库、不重启生产服务、不调用真实模型。

- `story-state/validation.ts`统一检查状态审核覆盖、PASS、遗漏、精确Span及逐项复活授权。服务端保存输入绑定，模型不能自行声明审核的是另一份正文；唯一提交入口再次核对。
- `loadSnapshot`读取快照关联的审核记录，并检查项目、基础快照、正文、事件、Delta与CommitReceipt归属。坏Schema、哈希、引用或证据返回STATE_CORRUPTED；未实现的规则/快照版本返回CONFIG_VERSION_UNAVAILABLE。
- 回放转换器收到具体允许复活的变更序号，不再无条件允许全部复活。每个许可必须引用基础状态中已生效的具体规则，并提供对应正文的有效证据。
- 已存在V2记录未保存新输入绑定时，读取匹配的原始抽取产物和提交凭据进行验证；不追加虚构审核，不改旧正文/状态哈希，不涉及工作区外旧项目兼容。
- Checkpoint也核对本章审核来源；若本章包含复活，则额外读取前一状态核验规则并复算Checkpoint。缺失审核不能借Checkpoint绕过。
- 新增纠错冷回放测试确认客观命题改为FALSE后，旧TRUE版本、角色KNOWS观察和State 0仍保持原值。该测试验证存储与回放，不证明模型语义判断正确。

验证：`pnpm typecheck`、`pnpm test`（54项）、`pnpm build`与`pnpm test:e2e`（4项Chrome流程）通过；测试使用临时SQLite及FakeModel。构建仍有已有Zod依赖注释警告。初次全量运行发现新增纠错测试只修改Delta、未同步事件断言，触发状态修复；修正测试提案一致性后全量通过。

限制：注册表目前仅实现规则1；后续规则需保留对应读取实现。Checkpoint复活许可核验增加前一状态读取，总转换次数可能超过常规19条Delta预算；300/3000章及连续Checkpoint复活的性能尚未验收。真实模型复活/纠错语义仍未验收。F02剩余事件义务、O03解困与其他剩余工作继续按清单推进。

日期：2026-09-06。范围：Batch A 的第一项、第二项局部、第三项和第四项基础分流，数据目录级单实例保护（F01）、跨层级可判定硬约束（F02局部）、引用豁免用户授权（F03）和状态根因分流（F04局部）。

## 已交付

- 服务启动在创建数据库连接、初始化配置和执行`recover()`之前获取数据目录锁。
- 锁文件位于数据库文件同目录，名称为`<database>.lock`，内容包含PID、nonce、启动时间和数据库路径。
- 第二个进程若指向同一数据库路径且原PID仍可探测，启动会被拒绝，不会运行恢复逻辑。
- 原持有进程确认不存在时，旧锁可被回收并重新获取。
- 不同数据库路径使用不同锁文件，互不影响。
- 释放锁时校验PID和nonce，避免误删其他进程新建的锁。
- 项目级授权引用通过`/api/v1/projects/:id/authorized-quotes`管理，写入要求项目revision、引用文本和已发布参考分析来源。
- 授权保存前校验来源分析属于当前绑定知识链，且引用文本确实存在于对应参考原文。
- 章节规划不会信任模型返回的`allowedQuotes`，而是以任务开始时服务端冻结的授权引用覆盖；批次父任务和子章共享同一份冻结授权上下文。
- 未授权的参考原文80字符连续重复仍被程序门禁拦截；授权后的对应片段可通过，重复Issue包含正文与来源文本双方Span。
- 章节执行会汇总Book、当前Volume、当前Arc和Chapter的有效硬约束，交给required审核覆盖检查。
- 可程序判定的上层TEXT_RULE会进入本地门禁；当前已覆盖禁用词和长度区间。
- STATE_EQUALS会在状态模拟后按白名单读取状态字段并深比较；PRESERVE_FACT会校验基础命题与模拟后命题真值保持一致。
- 状态约束定位元数据必须与value一致；同一状态字段的硬等值约束冲突会被拒绝。
- 当前Volume/Arc随章节上下文进入正文生成和审核输入；中断恢复或复用滚动窗口时使用同一份ROLLING产物恢复父级约束。
- 未来章节才到期的MUST_EVENT不会提前成为当前章义务。
- 批次暂停允许使用旧面板上的任务revision登记暂停，避免快速调度时暂停请求被良性进度更新误拒绝。
- Delta格式、引用、expected与独立状态校验类错误继续进入状态修复；正文导致的模拟后硬状态约束、不可变规则或复活授权冲突会转入正文修复并重新审核/抽取。
- 自动正文修复耗尽后任务进入`WAITING_USER`，释放小说执行资格；HTTP预算/恢复接口和前端任务面板可识别该状态。

## 验证

```powershell
pnpm --filter @one2novel/server typecheck
pnpm test tests/integration/data-lock.test.ts tests/integration/llm.test.ts
pnpm test tests/integration/library.test.ts tests/integration/migration.test.ts
pnpm test tests/integration/pipeline.test.ts
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm db:migrate
```

结果：服务端类型检查通过；引用授权与迁移聚焦测试10项通过；pipeline聚焦测试26项通过；全量Vitest 51项通过；完整构建通过；浏览器E2E 4项通过；本地SQLite迁移`20260908000000_authorized_quotes`已应用。

## 剩余限制

- 该能力是单实例保护，不是多实例或分布式Worker支持。
- PID状态无法可靠判断时会保守拒绝接管，需要用户检查本机进程或锁文件。
- F02当前完成可判定文本硬约束、STATE_EQUALS/PRESERVE_FACT模拟后求值、约束冲突防线和未来MUST_EVENT不过早触发；完整事件语义义务、正文否定PRESERVE_FACT的语义判定和目标达成证据仍待补齐。
- F04当前完成基础根因分流和WAITING_USER执行状态；完整O03解困入口、用户可调输入记录、正文/Book/绑定变化必须新命令，以及真实语义“正文违背Canon后修正文成功”的反例仍待补齐。
- 本轮完成真实ChatAnyWhere连通测试和浏览器E2E，但尚未运行带用户样例的真实模型完整小说生产闭环；后续继续按Batch A补F02剩余、F05、O03、V01/V02关键反例。
