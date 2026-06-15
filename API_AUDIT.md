# One2Novel API 完整审计报告

> 审计日期：2026-06-15

---

## 一、后端 API 端点总数：146

| 区域 | 端点数 |
|------|--------|
| Novel CRUD | 8 |
| Planning / Pipeline | 13 + 5个子路由 |
| Chapter Write | 11 |
| Chapter Edit | 7 |
| Volume/Chapter | 12 |
| Character Depth | 23 |
| Export / Statistics | 9 |
| Director | 5 |
| Payoff | 5 |
| Settings / Preferences | 7 |
| World Rules | 7 |
| Architecture | 9 |
| Beat Sheet | 2 |
| Rhythm | 5 |
| Reference Book | 15 |
| Audit-Cost | 10 |
| Style | 13 |
| 顶层 (health/probe/timeline) | 7 |
| **总计** | **146** |

---

## 二、前端暴露的端点：78

---

## 三、后端有但前端未暴露的端点（⚠️ 不可用）

以下端点后端已实现但前端**没有任何调用**：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/novels/:novelId/timeline/conflicts` | 时间线冲突检测 |
| GET | `/api/novels/:novelId/timeline/reminders/:chapterOrder` | 写前提醒 |
| POST | `/api/novels/:novelId/chapters/:chapterId/timeline/re-extract` | 重提时间线 |
| POST | `/api/novels/:id/volumes/:sortOrder/refine` | 精炼章节细节 |
| GET | `/api/novels/:id/snapshots` | 状态快照 |
| POST | `/api/novels/:id/titles` | AI 起名（TitleEditor 中用到，但路径不同） |
| POST | `/api/novels/:novelId/pipeline/init` | 初始化流水线 |
| GET | `/api/novels/:novelId/pipeline/state` | 获取流水线状态 |
| POST | `/api/novels/:novelId/pipeline/step/:stepName` | 执行单步 |
| POST | `/api/novels/:novelId/pipeline/generate-skeleton` | 生成骨架 |
| POST | `/api/novels/:novelId/pipeline/expand-volume/:volumeOrder` | 展开卷 |
| POST | `/api/novels/:novelId/pipeline/generate-all-volumes` | 生成全部卷 |
| POST | `/api/novels/:novelId/blueprint/restore` | 从写作还原蓝图 |
| POST | `/api/novels/:novelId/volumes/:volumeId/chapters/:chapterOrder/contract` | 章节执行合约 |
| POST | `/api/novels/:novelId/world-rules/reference` | 从参考描述生成世界规则 |
| POST | `/api/novels/:novelId/chapters/:chapterId/undo` | 撤销编辑 |
| POST | `/api/novels/:novelId/chapters/:chapterId/revision/cascade` | 级联修订 |
| PATCH | `/api/novels/:novelId/characters/:charId` | 更新角色 |
| DELETE | `/api/novels/:novelId/characters/:charId` | 删除角色 |
| POST | `/api/novels/:novelId/characters` | 创建角色 |
| PATCH | `/api/novels/:novelId/draft-characters/:charId` | 更新 draft 角色 |
| DELETE | `/api/novels/:novelId/draft-characters/:charId` | 删除 draft 角色 |
| POST | `/api/novels/:novelId/draft-characters` | 创建 draft 角色 |
| PATCH | `/api/novels/:novelId/resources/:id` | 更新资源 |
| DELETE | `/api/novels/:novelId/resources/:id` | 删除资源 |
| GET | `/api/novels/:novelId/resources/summary` | 资源摘要 |
| GET | `/api/novels/:novelId/resources/check` | 资源一致性检查 |
| PATCH | `/api/novels/:novelId/info-profiles/:id` | 更新信息档案 |
| DELETE | `/api/novels/:novelId/info-profiles/:id` | 删除信息档案 |
| GET | `/api/novels/:novelId/irony-report` | 戏剧性反讽报告 |
| DELETE | `/api/novels/:novelId/draft-relations/:id` | 删除 draft 关系 |
| DELETE | `/api/novels/:novelId/relations/:id` | 删除生产关系 |
| POST | `/api/novels/:novelId/chapters` | 创建章节（向后兼容） |
| PATCH | `/api/novels/:novelId/chapters/:chapterId` | 更新章节 |
| POST | `/api/novels/:novelId/volumes` | 创建空卷 |
| PATCH | `/api/novels/:novelId/volumes/:sortOrder` | 更新卷 |
| PATCH | `/api/novels/:novelId/volumes/:sortOrder/chapters/:planId` | 更新卷章计划 |
| DELETE | `/api/novels/:novelId/volumes/:sortOrder/chapters/:planId` | 删除卷章计划 |
| POST | `/api/novels/:novelId/volumes/:sortOrder/beat-sheet` | 生成节拍表 |
| POST | `/api/novels/:novelId/volumes/:sortOrder/rebalance` | 卷重平衡 |
| POST | `/api/novels/:novelId/chapters/:chapterId/payoffs/scan` | 扫描伏笔 |
| PATCH | `/api/novels/:novelId/payoffs/:id` | 更新伏笔 |
| DELETE | `/api/novels/:novelId/payoffs/:id` | 删除伏笔 |
| GET | `/api/novels/:novelId/export` | 导出（前端在hook中调用了） |
| GET | `/api/novels/:novelId/statistics/daily` | 每日产出（前端未显示） |
| GET | `/api/styles/:id` | 获取单个style |
| DELETE | `/api/styles/:id` | 删除style |
| PATCH | `/api/styles/:id` | 更新style名 |
| DELETE | `/api/styles/:id/bind/:bindingId` | 解绑 |
| GET | `/api/styles/bindings/:targetType/:targetId` | 获取绑定列表 |
| PATCH | `/api/styles/:id/rules` | 更新单条规则 |
| POST | `/api/styles/:id/rules/add` | 添加规则 |
| DELETE | `/api/styles/:id/rules/:index` | 删除规则 |
| PUT | `/api/novels/:novelId/architecture` | 保存架构 |
| PUT | `/api/novels/:novelId/loop-definition` | 保存回环定义 |
| GET | `/api/novels/:novelId/loop-definition` | 获取回环定义 |
| PATCH | `/api/novels/:novelId/loops` | 编辑回环 |
| GET | `/api/novels/:novelId/volumes/:sortOrder/beats` | 获取节拍表 |
| GET | `/api/novels/:novelId/expectation-summary` | 期待管理摘要 |
| PUT | `/api/novels/:novelId/reference-book/annotations` | 保存参考书标注 |
| GET | `/api/novels/:novelId/reference-book/chapters` | 参考书章节列表 |
| GET | `/api/novels/:novelId/reference-book/chapters/:chapterIndex` | 参考书单章内容 |
| POST | `/api/novels/:novelId/reference-book/infer-loops` | 推断回环 |
| POST | `/api/novels/:novelId/reference-book/infer-coolpoints` | 推断爽点 |
| GET | `/api/novels/:novelId/reference-book/statistics` | 参考书统计 |
| POST | `/api/novels/:novelId/reference-book/detect-architecture` | 检测架构 |
| POST | `/api/novels/:novelId/reference-book/extract-hook-patterns` | 提取钩子模式 |
| POST | `/api/novels/:novelId/reference-book/extract-golden-finger` | 提取金手指 |
| POST | `/api/novels/:novelId/reference-book/extract-setting-timeline` | 提取设定时间线 |
| GET | `/api/novels/:novelId/characters/volume-presence/:volumeOrder` | 角色卷存在状态 |
| PUT | `/api/novels/:novelId/characters/:characterId/presence` | 设置角色存在状态 |
| GET | `/api/novels/:novelId/compression-summary` | 压缩摘要 |
| GET | `/api/novels/:novelId/completion-readiness` | 完本准备度 |
| GET | `/api/llm/probe` | LLM 连通性探测 |

**共 70 个后端端点未在前端暴露**——其中多数是规划/流水线/深度编辑功能。

---

## 四、隐式 Prompt 模板（46个）

所有 assetId 编译在 `server/src/platform/llm/aiService.ts`，运行时通过 `compileAsset()` 函数加载系统提示词。

| 类别 | assetId | 调用方 |
|------|---------|--------|
| **故事核心** | `novel.story-core.generate` | step1 |
| | `novel.blueprint.generate` | step5 |
| | `novel.framing.generate` | step6 |
| | `novel.title.generate` | TitleEditor |
| **章节写作** | `novel.chapter.writer` | chapterGenerator |
| | `novel.chapter.review` | qualityGate |
| | `novel.chapter.repair.patch` | repairService |
| | `novel.chapter.repair.heavy` | repairService |
| | `novel.chapter.optimize` | draftOptimize |
| | `novel.chapter.summarize` | chapterSummary |
| **章节诊断** | `novel.chapter.diagnose` | revisionService |
| | `novel.chapter.inline-suggest` | inline suggest |
| | `novel.chapter.next-preview` | next-chapter preview |
| | `novel.chapter.refine` | chapterDetail |
| **角色** | `novel.character.extract` | characterService |
| | `novel.character.dynamics.volume` | dynamicsService |
| | `novel.character.dynamics.chapter` | dynamicsService |
| | `novel.character.dynamics.post` | characterDynamics |
| | `novel.character.state-update` | stateUpdater |
| **回环/蓝图** | `novel.loop-skeleton.generate` | loopTemplate |
| | `novel.volume.expand` | loopTemplate |
| | `novel.volume.beat-sheet` | beatSheet |
| | `novel.volume.chapter-contract` | chapterDetail |
| | `novel.volume.rebalance` | rebalance |
| | `novel.volume.compress` | tieredCompression |
| **修订** | `novel.chapter.rewrite.polish` | revisionService |
| | `novel.chapter.rewrite.expand` | revisionService |
| | `novel.chapter.rewrite.compress` | revisionService |
| | `novel.chapter.rewrite.perspective` | revisionService |
| | `novel.chapter.rewrite.tone` | revisionService |
| | `novel.chapter.rewrite.fix-ai` | revisionService |
| **场景** | `novel.scene-plan.generate` | scenePlan |
| **冲突/伏笔** | `novel.conflict.scan` | openConflict |
| | `novel.payoff.scan` | payoffService |
| **时间线** | `novel.timeline.extract` | timelineService |
| | `novel.timeline.conflict` | timelineService |
| **参考书** | `reference.loop.infer` | referenceBook |
| | `reference.coolpoint.infer` | referenceBook |
| | `reference.architecture.detect` | referenceBook |
| | `reference.hook.extract` | referenceBook |
| | `reference.golden-finger.extract` | referenceBook |
| | `reference.setting-timeline.extract` | referenceBook |
| | `reference.writing_assets.extract` | referenceBook |
| **世界规则** | `world.rules.generate` | worldRule |
| | `world.rules.conflict-check` | worldRule |
| | `world.reference` | worldReference |
| **风格** | `style.extract` | styleService |

---

## 五、前端调用但无对应后端端点（🔴 断裂点）

以下 hooks 调用了不存在的端点：

| 前端 hook | 调用路径 | 状态 |
|-----------|----------|------|
| `useGenerateOutline` | `POST /novels/:id/outline` | ✅ 已删除（Phase 0） |

---

## 六、判断与建议

### 6.1 应该暴露但未暴露的功能

| 功能 | 端点 | 理由 |
|------|------|------|
| AI 起名 | `POST /novels/:id/titles` | TitleEditor 的"AI起名"功能调用，实际上前端用的是 `api.post('/novels/${id}/titles')` 而 TitleEditor 里有此调用——需要确认 |
| 参考书多步分析 | infer-loops/coolpoints/hook-patterns/golden-finger/setting-timeline | ReferenceDomain 只调了 `extract-writing-assets` 和 `create-style-profile`，其他5个推断端点未暴露 |
| Pipeline 步进 | pipeline/init, state, step | PlanningHub 改为7步流水线后，应该调用流水线 API 来持久化进度 |
| 角色编辑 | PATCH/DELETE /characters/:charId | CharactersDomain 里有直接编辑角色的UI，但未暴露更新/删除 |
| 节拍表 | GET/POST beats | BlueprintDomain 展开卷后应有节拍表展示 |
| 完本准备度 | completion-readiness | 写作进度>80%时提示 |
| 回环定义 | loop-definition | ArchitectureDomain 的自定义回环编辑器需要 |

### 6.2 冗余端点（可考虑精简）

| 端点 | 理由 |
|------|------|
| `draft-characters/*` (3个) | Draft 模型已被移除，这些路由是空的别名 |
| `draft-relations/*` (2个) | 同上，与 `relations/*` 功能重复 |
| `POST /novels/:novelId/chapters` | 已有 `POST /volumes/:sortOrder/chapters` |

### 6.3 隐藏 Prompts 问题

46 个 prompt 模板全部硬编码在 `aiService.ts` 中，**用户无法查看或修改**。这是设计决策——"面向创作者而非开发者"意味着不应暴露这些给用户。但应该：
1. 文档化每个 prompt 的用途（写作者面向的描述）
2. 考虑未来支持"自定义提示词"的高级模式

### 6.4 流水线 API 未与前端对齐

`PlanningHub` 改为7步流水线后，步骤完成状态仅存前端内存（`useState`），未调用 `pipeline/step/:stepName` 持久化。刷新页面后进度丢失。

---

## 七、优先修复项

| 优先级 | 项 | 工作量 |
|--------|-----|--------|
| 🔴 P0 | Pipeline 状态持久化（调用 `/pipeline/step/:stepName`） | 中 |
| 🔴 P0 | 角色编辑 CRUD 前端暴露 | 小 |
| 🟡 P1 | 参考书多步分析 UI 暴露 | 中 |
| 🟡 P1 | 回环定义编辑暴露（loop-definition endpoint） | 小 |
| 🟡 P1 | 完本准备度前端接入 | 小 |
| 🟢 P2 | draft-* 冗余路由清理 | 小 |
| 🟢 P2 | Prompt 模板文档化 | 中 |
