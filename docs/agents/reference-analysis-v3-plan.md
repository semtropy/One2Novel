# 参考书分析 V3 — 模块化重构

## 架构问题

当前 `deepAnalyze()` 是一个 500 行的巨型函数，Phase 1-7 串行执行。任何模块失败或需要修改，都要动整个函数。模块之间无显式边界——Phase 3 的 loopNarrative 被 Phase 4 的 synthesize 使用，但依赖是隐式的。

## 新架构

```
deepAnalyze(profileId)
  │
  ├─ Phase 1: parseChapters(text) → chapters[]
  ├─ Phase 2: batchAnnotate(chapters, text) → annotationMatrix
  │
  └─ 独立模块（顺序执行，互不阻塞。任一失败不影响其他模块）
       │
       ├─ Module A: ArchitectureSynthesis（需 AI：回环检测 + 逐回环叙事分析）
       │   Output: loopBoundaries, loopNarratives[], rhythmProfile, architectureProfile
       │   Inject: Step 2 架构选择, Step 4 回环骨架
       │
       ├─ Module B: PowerSystemExtraction（需 AI：从标注矩阵 + 修炼章样本推断境界树）
       │   Output: powerSystemTree, expectationNodes[]
       │   Inject: Step 2 力量体系树
       │
       ├─ Module C: GoldenFingerAnalysis（需 AI：提取 + 设计模式 + 进化时间线）
       │   Output: goldenFingerData, designPattern, evolutionTimeline
       │   Inject: Step 2 金手指
       │
       └─ Module D: WritingCraftAndExpectations（需 AI：技法提取 + 期待链分析）
           Input:  annotationMatrix, text, loopNarratives (from Module A)
           Output: writingTechniques, craftStats, expectationTemplates[]
           Inject: 写作 context, Step 4 卷展开
```

## 模块详情

### Module A: Architecture Synthesis
合并当前 Phase 3 + Phase 4。
- detectLoopBoundaries(annotations) → AI 推断回环边界
- analyzeLoopNarrative(loop, annotations, text) → AI 逐回环深度分析
- computeRhythmProfile(annotations) → 纯统计
- synthesizeArchitectureProfile(annotations, chapters, loops) → 纯统计
输出：loopBoundaries, loopNarratives[], rhythmProfile, architectureProfile

### Module B: Power System Extraction（新）
- **需要 AI**。仅从 contentBeat 标签无法推断境界结构——"修炼"章可能是不同境界。
- AI 调用：输入 annotationMatrix 摘要（每章 type/beat/coolPoint）+ 修炼章的内容样本 → AI 推断境界结构
- 从 coolPoint=high 的修炼章推断境界突破节点
- 每个境界标注"读者期待"：达到这个境界能让主角做什么（来自章节内容推断）
输出：powerSystemTree, expectationNodes[]
注入 Step 2 力量体系树

### Module C: Golden Finger Analysis
增强当前 Phase 6。
- AI 调用：从 text 提取金手指本身 + 设计模式（已有）
- 从 annotationMatrix 找金手指首次使用章（summary 关键词匹配）和进化章（coolPoint=high）
- 构建 evolutionTimeline: [{chapter, ability, trigger}]
输出：goldenFingerData, designPattern, evolutionTimeline
注入 Step 2 金手指

### Module D: Writing Craft + Expectation Chain
合并 Phase 5 + Phase 7 + 新期待分析。
- extractWritingTechniques(text, annotations) → AI（已有）
- computeCraftStats(annotations, text) → 纯统计（已有）
- **期待链分析需要 AI**：对每个回环，从 annotationMatrix + loopNarrative 推断期待建立/维持/兑现模式
输出：writingTechniques, craftStats, expectationTemplates[]
注入写作 context + Step 4 卷展开

### Module F: Character Function → 标记为待实现
- annotationMatrix 不追踪每章的角色出场，无法从现有数据推断角色功能分布
- 需要扩展 Phase 2 增加 "charactersInChapter" 字段 → 未来单独做

## 数据流

```
analysisResult = {
  totalChapters, completedAt,
  annotationMatrix: ChapterAnnotation[],  // Phase 2 产出，所有模块的输入

  // Module A
  architecture: {
    loopBoundaries, loopNarratives, rhythmProfile, architectureProfile,
  },

  // Module B
  powerSystem: {
    tree: PowerNode[], expectationNodes: ExpectationNode[],
  },

  // Module C
  goldenFinger: {
    data: GoldenFingerData, designPattern: DesignPattern,
    evolutionTimeline: EvolutionNode[],
  },

  // Module D
  writing: {
    techniques: WritingTechniques, craftStats: CraftStats,
    sceneStructure: SceneStructure,
  },

  // Module E
  expectations: ExpectationTemplate[],

  // Module F
  characters: CharacterFunctionDistribution,
}
```

## 文件结构

不拆成 9 个文件——当前 pipeline 总共 ~600 行，拆太碎反而不利于理解。按职责拆 4 个文件：

```
referenceDeepAnalysis/
  index.ts       — orchestrator (deepAnalyze) + types
  parse.ts       — Phase 1: chapter parser
  annotate.ts    — Phase 2: batch annotation + exemplar capture + resume
  modules.ts     — Module A + B + C + D (每个模块一个导出函数)
```

## 对 4 步创作链路的影响

| 步骤 | 接收的新数据 | 来源模块 |
|---|---|---|
| Step 2 架构选择 | architectureProfile（同上） | A |
| Step 2 力量体系 | powerSystemTree + expectationNodes | B |
| Step 2 金手指 | designPattern + evolutionTimeline | C |
| Step 3 角色 | characterFunctionDistribution | F |
| Step 4 回环骨架 | architectureProfile + expectationTemplates | A + E |
| 写作 | techniques + craftStats + exemplars + expectationTemplates + sceneStructure | D + E |

## 实现顺序

1. 拆分目录结构 + types.ts
2. parse.ts + annotate.ts（从当前文件提取）
3. architecture.ts（合并 Phase 3 + 4）
4. Module B, C, D, E, F（每个新增/增强一个模块）
5. index.ts orchestrator
6. 更新 contextBlockBuilders 注入点
7. 更新 CockpitPage 展示
8. Prisma: analysisResult → 匹配新的嵌套 JSON 结构
