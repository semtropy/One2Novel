# One2Novel — AI 长篇小说创作工作台

从一句灵感到一本小说。

**你只需要提供想法，AI 帮你完成剩下的所有工作。**

---

## 快速开始

### 下载安装（推荐）

从 [GitHub Releases](https://github.com/semtropy/One2Novel/releases) 下载最新版 `One2Novel-x.x.x-setup-x64.exe`，双击安装。

打开后第一件事：进入**设置**页，填入你的 AI 服务 API Key，然后就可以开始创作了。

> 目前支持 DeepSeek、OpenAI、Anthropic Claude、Google Gemini、通义千问、月之暗面 Moonshot 等多个 AI 厂商。


---

## 它能做什么

### 核心创作管线

整个创作流程是一条完整的流水线，你只需要在每个节点做最小决策：

```
灵 感 → 故事种子 → 角色生成 → 卷纲蓝图 → 批量写章 → 质检修复 → 导出
```

<img width="2864" height="1536" alt="09a6585d4776ef1a4748925a9d37d567" src="https://github.com/user-attachments/assets/056ae4a7-9789-47d8-88ab-4a0629f34ac5" />

<img width="2864" height="1536" alt="2d716e3f2f9c48cb31b6fba948c7cf09" src="https://github.com/user-attachments/assets/70e9578a-204d-4843-886b-192e30840d38" />

<img width="2864" height="1536" alt="bae2da10f3e4e0463fe4a6880cfdc484" src="https://github.com/user-attachments/assets/3f3c170e-c3ab-4f0f-9266-332476c69c7d" />


#### 1. 灵感到故事种子

输入一句话，比如「一个退隐杀手为了救女儿不得不重返江湖」，AI 会：

- 分析你的想法，生成完整的故事设定
- 确定题材、目标读者、核心卖点
- 生成多套故事方向供你选择
- 给出配套的卷章结构

#### 2. 角色体系

AI 自动从故事大纲中提取所需角色阵容，每个角色包含：

- 性格核心、致命缺陷、发展弧线
- 外貌特征、说话风格
- 与主角的关系定位
- 角色资源台账（技能、物品、人际关系）

支持规划区草稿模式：AI 生成的草稿不直接覆盖已有角色，确认后才会生效。

#### 3. 卷纲蓝图

AI 根据故事方向和角色阵容，自动规划：

- 分卷策略
- 每卷的主题、冲突、转折点
- 卷间衔接和悬念承继
- 章节任务书（每章的具体目标和要求）

同样支持规划区草稿 → 确认生效的流程。

#### 4. 章节生成

逐章或批量生成正文，每章 3000-5000 字：

- **深度上下文组装**：每章写作时 AI 会拿到角色硬事实、前文悬念、卷级任务、风格约束等完整上下文
- **写法引擎驱动**：绑定风格档案后，AI 按你指定的写法生成正文
- **伏笔追踪**：自动扫描章节中的伏笔设置和回收情况
- **时间线提取**：写完自动提取时间线事件，检测时间冲突
- **世界规则校验**：自动检查是否违反已设定的世界规则

#### 5. 导演系统（批量自动写作）

不想一章一章点？打开导演模式：

- 一键批量生成前 10 章
- 支持断点恢复（中途关掉下次继续）
- 实时查看进度
- 支持三种推进方式：按阶段审核 / 自动推进 / 继续执行

#### 6. 质检与修复

每章写完后 AI 自动从 7 个维度打分（1-10）：

| 维度 | 检查内容 |
|------|---------|
| 开头吸引力 | 是否迅速进入情境 |
| 情节推进 | 是否有明确的事件进展 |
| 人物塑造 | 角色行为是否一致、有深度 |
| 对话质量 | 对话是否推动剧情、有信息量 |
| 悬念设置 | 章尾钩子是否吸引人 |
| 节奏控制 | 张弛是否合理 |
| 语言质量 | 是否流畅自然 |

**修复工具**：选中正文 → 可一键润色、扩写、压缩、去除 AI 痕迹。

#### 7. 导出

支持 4 种格式：

- **EPUB 3.0**：直接导入微信读书、Kindle 等阅读器
- **TXT**：纯文本格式
- **Markdown**：带目录和元数据
- **JSON**：结构化数据，便于二次开发

---

### 辅助功能

#### 写法引擎

- 从你的范文文本中提取写法特征（叙事节奏、对话风格、语言习惯等）
- 保存为独立的风格档案
- 将风格档案绑定到特定小说或章节
- 写作时 AI 自动按绑定风格调整输出

#### 伏笔系统

- 写完每章自动扫描伏笔设置
- 追踪伏笔状态：已设置 → 已回收 → 已逾期
- 逾期伏笔自动提醒
- 支持手动增删伏笔

#### 时间线

- 每章写完自动提取时间事件
- 检测时间冲突（如角色同时出现在两个地方）
- 写前提醒：写作时自动加载当前时间点之前应发生的逾期事件 + 未来 5 章内即将发生的事件

#### 世界规则

- 创建和管理世界观规则
- 按章节激活规则
- 写作时自动检查是否违反规则

#### 分镜系统

- 为每章创建场景卡片
- 规划每个场景的视角、冲突、情绪
- 可视化场景编排

#### 创作助手

- 内置对话式 AI 助手
- 用自然语言描述需求，AI 帮你完成各种创作任务
- 支持追问和细化

---

## 桌面版说明

### 数据存储

所有数据保存在你的电脑上：

```
C:\Users\<用户名>\AppData\Local\One2Novel\data\
```

- 小说、角色、章节等核心数据存在 `dev.db`（SQLite 数据库）
- API Key 和偏好设置存在 `user-preferences.json`
- 卸载时选择「保留数据」则不会删除这些文件

### 自动更新

桌面版启动时会自动检查更新。有新版时会在启动页提示下载。

---

## 开发说明

本节面向开发者。

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite + Tailwind CSS + Tiptap 编辑器 + Zustand + TanStack Query |
| 后端 | Express 5 + Prisma 7 + SQLite + LangGraph |
| AI | DeepSeek / OpenAI / Anthropic / Gemini / 通义千问 / Moonshot |
| 桌面 | Electron 35 + electron-builder |
| 包管理 | pnpm monorepo（client / server / shared / desktop） |

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发环境（server:7456 + client:7457）
pnpm dev

# 类型检查
pnpm typecheck

# 构建桌面安装包（本地）
pnpm dist:desktop:nsis

# 发布桌面 Beta 版到 GitHub
pnpm publish:desktop:beta
```

端口被占用时：`taskkill /F /IM node.exe`

### 项目结构

```
One2Novel/
├── client/          # React 前端
│   └── src/
│       ├── pages/       # 页面组件
│       ├── components/  # UI 组件
│       ├── api/         # API 调用
│       ├── lib/         # 工具函数
│       └── stores/      # 状态管理
├── server/          # Express 后端
│   └── src/
│       ├── app/         # 路由和 HTTP 层
│       ├── modules/     # 业务模块
│       │   ├── novel/       # 核心创作管线
│       │   ├── style/       # 写法引擎
│       │   ├── payoff/      # 伏笔系统
│       │   ├── timeline/    # 时间线
│       │   └── creativeHub/ # 创作助手
│       └── platform/    # 基础设施
├── shared/          # 共享类型和 Schema
├── desktop/         # Electron 桌面运行时
└── scripts/         # 构建和发布脚本
```

### LLM 配置

在项目根目录创建 `.env` 文件：

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

也支持 OpenAI、Anthropic、Gemini 等厂商，详见 `server/src/platform/config/env.ts`。

---

## License

MIT
