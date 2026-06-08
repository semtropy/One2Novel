# One2Novel

AI 长篇小说创作工作台。从一句灵感到一本小说。

## 参考来源

- **旧项目 (OP)**：`C:/Users/gaijinchao/Desktop/AI-Novel-Writing-Assistant-main/AI-Novel-Writing-Assistant-main/`
- **Skill (S)**：`C:/Users/gaijinchao/.claude/skills/chinese-novelist/`
- **记忆文件**：`C:/Users/gaijinchao/.claude/projects/C--Users-gaijinchao-Desktop-One2Novel/memory/`
- **架构计划**：`C:/Users/gaijinchao/.claude/plans/one2novel-next.md`
- **验收清单**：`docs/ACCEPTANCE.md`

## 核心架构规则（必读）

**规划区-写作区联动**（详见 `memory/planning-writing-linkage.md`）：

> 规划区是草稿，写作区是成品。草稿确认后变成品但不消失。成品改了草稿自动跟着改。AI 生成只改草稿。撤销就是成品变回草稿。

| 草稿表 | 成品表 | 确认 |
|------|------|------|
| `DraftPlan` (+synced) | `VolumeChapterPlan` + `Chapter` | upsert → synced=true |
| `DraftCharacter` (+synced) | `NovelCharacter` | upsert → synced=true |
| `Novel.draftSeed` | `Novel.structuredOutline` | 覆盖 |

**时间线架构**（详见 `memory/timeline-architecture.md`）：

> 所有写章路径（单章 SSE + 导演批量）统一调用 `afterChapterSave()` → 提取时间线事件 → 检测冲突 → 写入 AuditReport。同章重提幂等（先删旧再提取）。前端 ContextPanel 自动加载写前提醒 + 图例 + 手动重提按钮。

## 当前状态

核心管线完整可用：灵感 → AI 生成故事种子 → 角色/蓝图 → 批量生成章节 → 质检/修复 → 时间线提取/冲突检测 → 导出。

**最新改动（2026-06-07）**：
- 时间线功能架构级重构：合并 `timelineService` + `timelineConflictService` 为统一模块
- 新增 `afterChapterSave()` 统一写后入口，`directorService` 和 `chapterWriter` 共用
- 时间线提取幂等（同章重提前删旧）、冲突结果持久化到 `AuditReport`
- 前端 ContextPanel 新增：写前提醒自动加载、颜色图例、手动重提按钮、"检查"按钮
- 写前提醒过滤：只显示逾期事件 + 未来 5 章内即将发生的事件

## 技术栈

React 19 + Vite + Tailwind + Tiptap + Zustand + TanStack Query
Express 5 + Prisma 7 + SQLite + LangGraph (ChatOpenAI for DeepSeek)
pnpm monorepo (client/server/shared)

## 开发环境

| 服务 | 地址 |
|------|------|
| Server API | `http://localhost:7456` |
| Client Web | `http://localhost:7457` |
| LLM | DeepSeek `deepseek-chat` |

### 启动

```bash
pnpm dev             # 一键启动前后端（server:7456 + client:7457）
pnpm typecheck       # 零错误类型检查
```

端口被占用时：`taskkill /F /IM node.exe`

### 验收

1. `pnpm dev` 启动
2. 浏览器打开 **`http://localhost:7457`**

## 已完成功能

| 模块 | 功能 | 状态 |
|------|------|------|
| 核心管线 | Framing / StoryCore / 角色生成 / 蓝图 / 章节生成 / 质检 / 修复 / 导出 | ✅ |
| 分镜系统 | Scene Plan / SceneCardPanel | ✅ |
| 导演系统 | 批量自动写作 / 断点恢复 / SSE 流式 | ✅ |
| 伏笔系统 | 自动扫描 / 逾期检测 / 手动增删 | ✅ |
| 时间线 | 自动提取 / 冲突检测 / 写前提醒 / 手动重提 | ✅ |
| 写法引擎 | 范文提取 / StyleProfile CRUD / 书级+章级绑定 / 编译注入 | ✅ |
| 世界规则 | CRUD / 冲突检测 / 按章激活 | ✅ |
| 改写工具 | 选中正文 → 润色/扩写/压缩/去AI痕 / 章节诊断 | ✅ |
| 规划区-写作区联动 | DraftPlan ↔ Chapter 双向同步 / 确认+撤销 | ✅ |
| 设置 | 多厂商 API Key / 创作偏好 / 模型测试 | ✅ |
| 创作助手 | ChatPage 对话 | ✅ |

## 已知待完善

- `finalization.ts`：定稿前一致性检查已实现但未接入管线
- `storySeedService.ts`：与 `storyCoreService.ts` 功能重叠，待整合或删除
- 角色资源台账 / 信息差档案：API + Hook 已就绪，缺前端 UI
- 上下文组装器输出对创作者不可见（作者不知道 AI 拿了什么上下文）

## 每阶段完成必须

1. `pnpm typecheck` 零错误
2. 按 `docs/ACCEPTANCE.md` 逐项验收
3. 更新本文件
