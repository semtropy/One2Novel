# One2Novel 代码简化计划

## Context

这个项目有大量"故弄玄虚"的深层封装——每个数据实体都有仓库或服务层包裹 Prisma，但零业务逻辑；工厂模式、单例类、事件总线、侧重点导入注册表……这些抽象从未被替代实现，只是"以防万一"。结果是约 40 个文件、~1300+ 行净删除量，功能完全不变。

核心原则：**直接 `getPrisma()` 访问**、**函数代替类**、**显式导入代替副作用注册表**、**移除零业务逻辑的包装**。

---

## Phase 1: 删除死代码 (风险极低, 净删 ~309 行)

### 1.1 删除 `architectureRegistry.ts`
- **文件**: `server/src/modules/novel/planning/architectureEngine/architectureRegistry.ts` (23 行)
- **问题**: 三个函数全部返回 `undefined`/`null`/`[]`，是空桩
- **变更**: 删除文件 + 清理 `creationPipeline.ts`、`loopTemplateService.ts`、`architecture.routes.ts` 中的死导入
- **影响**: ~33 行净删除

### 1.2 删除 `postWriteHooks.ts` 转发桶
- **文件**: `server/src/modules/novel/production/post/postWriteHooks.ts` (12 行)
- **问题**: 单行 `export { ... } from "./postWriteBus"`，纯转发
- **变更**: 删除文件 + 更新 `chapterPipeline.ts` 导入路径
- **影响**: ~13 行净删除

### 1.3 删除 `StoryCoreDomain.tsx`
- **文件**: `client/src/components/planning/StoryCoreDomain.tsx` (235 行)
- **问题**: `@deprecated`，UI 中不可达，选项列表与 `FoundationDomain.tsx` 重复
- **影响**: ~235 行净删除

### 1.4 删除 `NovelRedirect.tsx`
- **文件**: `client/src/pages/NovelRedirect.tsx` (28 行)
- **问题**: 页面组件只做一次 API 调用然后跳转，可用 router loader 替代
- **影响**: ~28 行净删除

---

## Phase 2: 扁平化仓库模式 (最大收益, 中等风险, 净删 ~600 行)

### 2.1 删除所有薄封装仓库文件
**待删除** (~619 行):
- `server/src/platform/data/repositories/worldRuleRepository.ts` (53 行)
- `server/src/platform/data/repositories/chapterRepository.ts` (89 行)
- `server/src/platform/data/repositories/volumeRepository.ts` (69 行)
- `server/src/platform/data/repositories/referenceBookRepository.ts` (83 行)
- `server/src/platform/data/repositories/novelRepository.ts` (382 行)
- `server/src/platform/data/repositories/index.ts` (24 行)

**待保留并整合到 `server/src/platform/data/jsonAccessors.ts`** (~200 行):
从上述文件中提取所有有实际逻辑的 JSON 类型访问器（带 Zod 校验的 `getScenePlan`/`setScenePlan`/`getLoopSkeleton`/`setLoopSkeleton`/`getGoldenFinger` 等），作为独立 async 函数导出。

**所有调用方 (~16 个文件) 改为直接使用 `getPrisma()`**:
| 调用方 | 变更 |
|--------|------|
| `creationPipeline.ts` | `createNovelRepo(prisma).findById(x)` → `getPrisma().novel.findUnique({where:{id:x}})` |
| `worldFrameworkService.ts` | `createWorldRuleRepo(prisma).deleteByNovel(x)` → `getPrisma().worldRule.deleteMany({where:{novelId:x}})` |
| `loopTemplateService.ts` | 同上模式 |
| `pipelineState.ts` | `createNovelRepo(getPrisma()).getPipelineState(x)` → `getPipelineState(getPrisma(), x)` |
| `novel.routes.ts` | 6 处 `createNovelRepo(getPrisma())` → 直接 `getPrisma()` |
| `chapterWrite.routes.ts` | 同上 |
| `architecture.routes.ts`、`rhythm.routes.ts`、`beat-sheet.routes.ts` | 直接 Prisma 调用 |

---

## Phase 3: 移除服务抽象层 (净删 ~260 行)

### 3.1 删除 `referenceBookService.ts` (270 行)
- **问题**: 15 方法接口，其中 7 个是直接函数引用到 `referenceAnalyzer.ts`，另 8 个是薄 CRUD 包装
- **变更**: 删除文件；在 `reference.routes.ts` 中直接 import `referenceAnalyzer` + 内联 CRUD 逻辑
- **影响**: ~255 行净删除

### 3.2 将 `DebtService` 类转为独立函数 (227 行)
- **问题**: `class` + `singleton` 模式，无构造函数参数，内部只是 `this.prisma.X.create(...)`
- **变更**: 类方法 → 导出函数；删除 `getDebtService()` 单例
- **影响**: 行数基本不变，认知开销大幅降低

### 3.3 清理 `commitService.ts` (240 行)
- **问题**: 每个函数是一行 Prisma 调用包一层
- **变更**: 合并到调用方或保留为精简函数（去掉错误处理包装，让路由层处理）

---

## Phase 4: 清理冗余工具层 (净删 ~55 行)

### 4.1 合并 `estimateTokens` 重复实现
- `server/src/platform/llm/tokenCounter.ts` (正则方式) + `contextSelection.ts` (码点方式)
- 保留 `contextSelection.ts` 的版本（更准确），删除另一个

### 4.2 提取共享 `stripHtml`
- 4 个文件各自有 `replace(/<[^>]*>/g, "")`
- 创建 `server/src/platform/utils/stringUtils.ts` 统一导出

### 4.3 删除 `probeLLM()` 遗留函数
- `server/src/platform/llm/connectivity.ts` 注释说 "replaced by probeAllLLM"

### 4.4 删除常量别名 (shadow variables)
- `freshnessDecay.ts`: `DEFAULT_DECAY_RATE = DEFAULT_FRESHNESS_DECAY_RATE`
- `structuredOutputHint.ts`: 3 个常量带 `_LOCAL` 后缀
- `annotate.ts`: `MAX_CHARS_PER_BATCH = REF_ANALYSIS_MAX_CHARS`

### 4.5 删除 `realAIService` 身份变换
- `server/src/platform/llm/aiService.ts` 273-293 行，1:1 映射无额外逻辑

### 4.6 删除 barrel 文件
- `commit/index.ts`、`agents/index.ts` — 纯重导出

---

## Phase 5: 客户端清理 (净删 ~130 行)

### 5.1 简化 `client/src/lib/constants.ts` (121 → ~30 行)
- 7 层嵌套函数 + 5 个 TypeScript 接口解析一个 URL
- 折叠为单个 `resolveApiBaseUrl()` 函数

### 5.2 删除 `client/src/lib/toast.ts` (11 行)
- 仅给 sonner 加硬编码 duration 的包装

### 5.3 删除 `client/src/lib/html.ts` 中的死代码
- `extractParagraphs` 无处使用；`escapeHtml` 移到使用它的组件

### 5.4 删除 `client/src/api/novel.ts` 中的 barrel 重导出 (lines 18-48)
- 鼓励单一导入点，但阻碍直接导入

### 5.5 删除 `client/src/api/factory.ts` 工厂模式 (113 行)
- 声称折叠 "30+ hooks"，但一半 hooks 因为不符合假设必须内联
- 替换为直接 `useQuery`/`useMutation`

---

## 总结

| 阶段 | 操作 | 影响文件数 | 净删行数 | 风险 |
|------|------|-----------|----------|------|
| 0 | 测试基线 | 0 | 0 | 无 |
| 1 | 删除死代码 | 6 | ~309 | 极低 |
| 2 | 扁平化仓库模式 | ~17 | ~600 | 中等 |
| 3 | 移除服务抽象 | 5 | ~260 | 中等 |
| 4 | 清理冗余工具 | 10 | ~55 | 低 |
| 5 | 客户端清理 | 7 | ~130 | 低 |
| **合计** | | **~45** | **~1354** | |

---

## 执行顺序建议

1. **Phase 1** — 先做，零风险即时收益
2. **Phase 5** — 客户端清理可并行，不影响服务端
3. **Phase 2** — 最大收益但需最多调用方更新，在 Phase 1 之后
4. **Phase 3** — 机械替换
5. **Phase 4** — 小修复，随时可做

每阶段完成后运行 `pnpm test` + 受影响路由的手动冒烟测试。

---

## 验证

- `pnpm test` 全绿
- `pnpm build` 全绿
- 手动测试: 创建小说 → 规划 → 写章节 → 质量审核 → 提交 完整流程
- 确认 AI 调用模式不变（仍通过 `aiInvoke` + prompt registry）
- 确认所有 API 端点响应格式不变
