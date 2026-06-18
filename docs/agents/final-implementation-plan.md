# 最终实施计划

基于完整审计（few-shot、参考书产出、创作链路上下文流），以下所有改动按优先级排列。

---

## 一、删除内置架构模板

**原因**：6 个模板的 ArchitectureProfile 数据（章节分布、字数统计、角色体系）是编造的。用户选模板以为自己拿到了真实数据，但实际上不如手动编辑或上传参考书。

**改动**：
- 删除 `architectureRegistry.ts` 中的 `SKILL_SLOT_TEMPLATE` 等 6 个常量
- 删除 `toArchitectureProfile()` 转换函数
- 删除 `buildExpectationProfile()` 函数（模板唯一调用方）
- ArchitectureDomain 中移除内置模板卡片列表
- ArchitectureDomain 的"确认架构"不再传 `architectureType` 到 pipeline

**影响**：用户必须上传参考书或手动编辑回环阶段。ArchitectureProfile 只有两个来源：参考书分析、用户手动编辑。

---

## 二、Step 2 串行管道

**原因**：世界规则、力量体系、金手指当前是 3 个独立路由，互不知晓彼此产出。金手指是世界规则的例外，力量体系定义了所有人的路径——三者必须串行生成，后一步注入前一步的产出。

### 2.1 WorldDomain 改版

- 删除力量体系子标签（Module B 已移除，powerSystem 字段已废弃）
- 只保留 2 个子标签：架构选择、世界规则
- 金手指不再作为独立子标签——改为在世界规则生成后自动触发
- WorldDomain 顶部加一个「生成世界框架」按钮

### 2.2 串行生成逻辑

点击「生成世界框架」→ 三步串行：

```
Step 2a: 生成世界规则
  userPrompt = 故事核心 + 架构类型 + 参考书 ArchitectureProfile（如果 activeProfile 存在）
  产出 → worldRule 表

Step 2b: 生成力量体系树
  userPrompt = 架构类型 + 世界规则摘要 + 故事核心
  产出 → novel.powerSystemTree

Step 2c: 生成金手指
  userPrompt = 故事核心 + 世界规则摘要 + 力量体系摘要 + 参考书 designPattern
  产出 → novel.goldenFinger
```

每一步的 userPrompt 显式注入前序产出的结构化摘要。参考书 ArchitectureProfile/designPattern 在 Step 2a 和 2c 中注入。

### 2.3 后端路由

新增 `POST /novels/:id/pipeline/generate-world-framework`：
- 调 2a → 2b → 2c 串行
- 返回 `{ worldRules, powerSystemTree, goldenFinger }`
- 任一步失败，返回错误 + 已完成步骤的产出

### 2.4 前端

- WorldDomain 新增「生成世界框架」按钮
- 点击后依次显示进度（生成世界规则... → 生成力量体系... → 生成金手指...）
- 三个产出各自有确认/编辑按钮
- 金手指能力+限制直接在 WorldDomain 中编辑（当前就有的功能）

---

## 三、添加 Few-Shot 示例

以下 prompt 需要结构化 few-shot（输入→输出示例）：

### creation pipeline（创作链路）

| Prompt | Few-Shot | 说明 |
|---|---|---|
| `novel.character.extract` | 1 个完整示例 | 展示一个包含 6 个角色 + 关系的好阵容：角色名/角色/功能标签（副本触发器/奖励来源/伏笔载体/长期威胁/情感锚点）的分配。演示主角不是功能位，配角有独立动机，关系网络有冲突纽带 |
| `novel.loop-skeleton.generate` | 2 个示例 | 示例 1（修真型）：5 轮回环，展示 trigger→dungeon→settlement→scaleUp 的递进模式。示例 2（探案型）：展示 case-driven 循环的不同结构 |
| `novel.volume.expand` | 1 个示例 | 展示一个 12 章回环的展开：阶段分配、章节类型比例（advance 60%/transition 20%/cooldown 1-2 章/climax 1-2 章）、每章的 coreEvent + endingHook 格式 |
| `novel.scene-plan.generate` | 1 个示例 | 展示 3 个场景的因果推进：场景 1 结果触发场景 2 → 场景 3 设置钩子 |
| `world.rules.generate` | 1 个示例 | 展示按类别（势力格局/力量体系/资源规则/社会结构/地理环境/历史背景）生成的 6 条规则，含 priority 分配 |
| `novel.expectation-chain.extract` | 1 个示例 | 展示一个回环的完整期待链：建立(第X章: 主角获得新能力后立即遇到强敌)→维持(preview钩子+修炼节拍)→兑现(第Y章: 新能力碾压之前打不过的敌人)→新期待(下一轮回环的boss更强大) |
| `novel.golden-finger.generate` | 增强现有 | 当前 3 个原型改为完整输入→输出示例：输入=故事核心+架构类型，输出=name+abilities+limits+designPattern |

### reference analysis（参考书分析）

| Prompt | Few-Shot | 说明 |
|---|---|---|
| `reference.writing_assets.extract` | 1 个示例 | 展示一条完整的写作技法提取：category/observation(对标书做法)/rule(可模仿规则)/confidence |

### production（生产）

| Prompt | Few-Shot | 说明 |
|---|---|---|
| `novel.character.post-chapter` | 1 个示例 | 展示从章节正文提取的状态变化 + 关系变化，演示角色名必须与角色列表一致 |
| `novel.chapter.annotate` | 1 个示例 | 展示一章的完整标注：chapterType/clapPoint/hookType/contentBeat/conflictIntensity/openingType/summary |

---

## 四、写作 exemplar 匹配优化

**当前**：`contextBlockBuilders.ts` 中 exemplar 匹配只看 `chapterType`。

**改动**：增加 `loopPhase` 权重——优先匹配相同 `loopPhase` + 相同 `chapterType` 的章节。如果找不到，降级为只看 `chapterType`。

匹配逻辑：
1. 尝试匹配 `loopPhase` + `chapterType`（最精确）
2. 如果结果 < 2 个，降级为仅 `chapterType`
3. 取最多 3 个匹配结果

---

## 五、CockpitPage 清理

- 移除力量体系展示块（powerSystem 字段已从 AnalysisResultV3 中删除）
- 期待链展示已存在（`r.writing.expectations`），保留
- openingPattern 中文标签已修复，保留

---

## 六、不做的

- Module F（角色功能分布）——需要扩展 Phase 2 增加逐章角色出场追踪
- 内置模板恢复——删除后不再以任何形式提供假数据
- 力量体系从参考书提取——AI 编造境界树，不可靠

---

## 实施顺序

| 顺序 | 改动 | 依赖 |
|---|---|---|
| 1 | 删除内置模板 | 无 |
| 2 | 添加所有 few-shot 示例 | 无 |
| 3 | Step 2 串行管道（后端路由 + 前端） | 1, 2 |
| 4 | Exemplar 匹配优化 | 无 |
| 5 | CockpitPage 清理 | 3 |
