> 历史归档：仅供定点追溯，不作为当前规范或进度。当前入口见[开发约定](../../AGENTS.md)与[剩余清单](../../REMAINING_WORK.md)。

# P6 参考作品与知识库闭环

日期：2026-09-06。基线：`e790e07`。本次优先交付资料到新小说的可执行闭环，沿用P5章节审核、唯一原子提交和串行执行。没有读取、复制或引入工作区外的旧实现。

## 用户流程

`/library`导入TXT/EPUB → 检查并发布切分 → 完整分析 → 处理同名身份 → 发布分析 → 提取框架/原始素材 → 发布 → 清洗 → 发布 → 改编 → 发布 → 小说工作区绑定知识版本 → 开书确认 → 单章或批次创作 → 导出。

风格、模板可独立创建和发布。导入、切分、确定性框架/原始素材提取及清洗不调用模型；单元分析、摘要聚合与素材改编通过现有服务端ChatAnyWhere适配层调用模型。未添加其他供应商或生产环境假模型回退。

## 本版定义与可执行规则

### 原文、切分和覆盖

`ReferenceSource`保存原文件字节、SHA-256、规范化全文及独立textId，同文件哈希去重。`ReferenceSplit`是不可覆盖的切分候选；修改追加版本，发布设置活动指针。章节区间采用Unicode code point左闭右开位置，连续完整覆盖全文。

```text
import(file):
    require 0 < size <= 20 MiB
    TXT -> 严格按UTF8/GB18030解码；无法解码则拒绝，不猜测替换乱码
    按中文章节标题切分；未识别则全文一章，标题前文本保留为序章
    EPUB -> ZIP逐条读取，按OPF spine顺序提取正文，剥离脚本/样式/页头
    require 条目<=5000，单条<=20 MiB，实际解压总量<=100 MiB
    reject 越界路径、符号链接、加密资源、重复文件路径、外部XML实体声明
    原文件+规范化全文+首份切分在同一SQLite事务保存

makeUnits(chapter):
    for start from chapter.start to chapter.end step 6000:
        end = min(start+6000, chapter.end)
        inputStart = max(chapter.start, start-300)
        inputHash = hash(text[inputStart:end], start, end, splitId, configHash)
        registryVersion = unitNumber-1

completeUnit(unit):
    require 每个quote精确对应原文区间且位于输入区间
    require 事件证据start >= unit.start（重叠区不重复计事件）
    require 身份唯一、引用存在、事件连续排序、时间关系无环
    transaction:
        require 未取消，registryHead == unit.registryVersion
        保存单元结果+hash及实体观察版本
        completedChars += unit.end-unit.start
        registryHead = unit.number
```

`ReferenceAnalysis`冻结原文、切分和配置。UNANALYZED表示尚无完成单元；PARTIAL表示已有单元但未完成全流程；COMPLETE要求全部单元、身份确认和聚合完成。COMPLETE与published分开。覆盖比例表示通过程序校验的文本区间，不证明模型没有遗漏剧情。

输出包含摘要、覆盖说明、实体、场景、事件、节拍、状态变化、钩子、时间线及伏笔；语义准确度仍需实际模型验收。

### 实体候选、同名与恢复

Registry按`analysisId + throughUnit`隔离，只读取`throughUnit <= registryVersion`的最后观察值。名称/别名命中必须保留；最近5章最多20项，BM25最多20项。去重后最多60实体、实体JSON累计不超过12000字符。必需名称命中超额明确失败，要求缩小切分，不静默丢弃。

候选、召回原因和文本哈希在调用前保存。恢复复用冻结候选与成功单元，不读取未来Registry，不重复计覆盖。聚合每组最多8份摘要，保留全部后代单元ID；超窗口缩组到2仍失败则停止，不能截断尾部后声称完整。

新ID与旧候选同名时记录unresolvedIdentities，不自动合并、不能发布。用户逐项选择KEEP_SEPARATE或MERGE(target)：

```text
resolveIdentities(old, decisions):
    require 每单元已完成且结果hash一致，文本覆盖完整
    require 每个歧义恰有一个决定，合并目标在允许候选中
    require 类型相同，合并关系不成环
    transaction:
        新建派生分析及记录决定的成功任务
        按单元顺序映射身份及后续引用，重验结构与证据
        记录原unitId和人工确认来源，重建独立Registry
        旧单元/旧hash不变；新版本仍需发布
```

采用人工确认整个派生版本的方式，不额外调用模型重分析。旧分析没有全书摘要时保留逐单元摘要并显示人工确认说明，用户检查后再发布。

### 知识类型和版本

| 类型 | 来源与校验 |
| --- | --- |
| FRAMEWORK | 仅完整已发布分析可提取。节拍形成节点、归一化章节位置和情绪曲线；高潮间距均值、钩子章占比、节拍分布由程序计算，手改统计拒绝。节点引用无环。 |
| RAW素材 | Registry实体另建素材ID，跨单元全部来源证据去重保留。 |
| CLEAN素材 | 来源为已发布RAW；按类型/名称/描述精确去重，合并证据与关系引用，可排除整理，不可借清洗改写名称/类型/描述。 |
| ADAPTED素材 | 来源为已发布CLEAN，按改编要求逐项生成新ID、originAssetId和mapping；原人物名不能沿用，来源证据不能伪造，关系引用必须有效。 |
| STYLE | 视角、时态、语气、句长、对白比例、禁用词和写作要求；禁用词进入确定性正文门禁。 |
| TEMPLATE | BOOK/VOLUME/ARC/CHAPTER已有描述字段默认值及指导；不扩展输出Schema、事实字段、身份或运行配置。 |

保存追加`KnowledgeVersion(number+1,payload,hash,sourceVersionId)`并增加资源revision。发布校验来源与hash，只设置发布标记及活动指针，不修改旧payload。转换任务与手工保存/发布互斥。

框架当前从已有节拍确定性派生，不额外运行knowledge.framework模型调用。自动产物cycles为空、默认无节点前置关系；用户可编辑有引用约束的候选。高级语义结构抽象、循环识别和复杂素材关系自动提取后续完善，不将空数组视为这些高级能力已经交付。

### 绑定、冻结与生产

```text
bind(project, versionIds, expectedRevision):
    transaction:
        require 无活动小说命令、revision一致
        require 每个版本已发布且hash正确
        require 框架<=1、改编素材包<=3、风格<=1、每种目标模板<=1
        reject RAW/CLEAN绑定及明显must/禁用词冲突
        替换固定版本绑定，递增revision；不写Story State

startOpeningOrProduction():
    冻结knowledge={items:[versionId,kind,hash,payload],hash}
    冻结authorizedQuotes={items:[text,sourceRef],hash}
    BATCH子任务继承父任务同一knowledge与authorizedQuotes
    knowledge进入开书、滚动规划、正文生成和规划审核
    框架使用须有来源节点到新计划节点的改编映射
    已绑定STYLE用于正文；知识身份不能直接成为新事实实体ID
    模型返回allowedQuotes无效；仅用户授权且服务端校验来源后的引用进入计划
    正文匹配参考原文连续80字符且不在授权引用中 -> Core FAIL
    出现STYLE禁用词 -> Core FAIL
    仅既有Evaluation PASS + 唯一事实原子提交才完成章节

retry():
    require 当前绑定hash == 任务冻结knowledge.hash
    require 当前授权引用hash == 任务冻结authorizedQuotes.hash
    require 原有head/epoch/配置等恢复条件仍成立
```

发布知识新版本不改变旧绑定；修改绑定使旧任务及开书候选过期，滚动窗口按绑定版本重新生成。绑定不追改已有章节、角色认知或故事事实。

## 接口与代码位置

- `/api/v1/references`：multipart导入、列表；`/:id`详情，`/text`有界区间预览，`/split`追加切分，`/split/:splitId/publish`发布。
- `/references/:id/analyze`：幂等分析任务；`/publish`发布完整分析；`/entity-resolutions`人工解释并派生版本。
- `/api/v1/knowledge`：列表、创建知识/转换任务；`/:id/versions`候选，`/publish`发布，`/clean`及`/adapt`转换。
- `/api/v1/projects/:id/knowledge-bindings`：读取、替换固定绑定；资料任务复用Job/SSE/取消/恢复/增额接口。
- `/api/v1/projects/:id/authorized-quotes`：读取、新增和删除用户授权引用；写入校验revision、绑定知识链、已发布参考分析和精确原文片段。
- `apps/server/src/reference`：解析、证据、Registry、身份确认。
- `apps/server/src/knowledge/library.ts`：知识校验、派生及绑定。
- `apps/server/src/orchestrator/library*.ts`：幂等、执行锁、冻结与分段恢复。
- `apps/web/src/pages/Library.tsx`、`features/KnowledgeBindings.tsx`：参考/知识工作台与小说绑定入口。

## 验证和升级

- `pnpm typecheck`：contracts、server、web通过。
- `pnpm test`：51项通过。原生产/状态/模型、资料闭环、导入、迁移和可靠性补强测试均通过。
- `pnpm build`：通过；Vite的两条Zod依赖注释标记警告不影响构建。
- `pnpm test:e2e`：4项Chrome流程通过，包括TXT上传到知识改编、绑定、两章提交和导出；原MVP重写、多标签草稿冲突及批次暂停/恢复回归通过。390px宽度无横向溢出。
- 同名两种决定、部分完成恢复、精确证据、超额候选、取消/重启不自动调用、来源伪造、固定绑定、统计防篡改、模型伪造引用豁免无效和用户授权引用放行均有集成断言。
- EPUB校验spine顺序、脚本剥离、实体解码；拒绝目录越界、符号链接、加密资源、外部XML实体、超限上传和膨胀条目。
- `20260907000000_library`正式迁移增加资料表，重建Job使projectId可空；`20260908000000_authorized_quotes`正式迁移增加授权引用表。已存在父子任务、执行锁、调用用量和事件逐项对照保留，外键与完整性检查通过。health schema=3；Story State规则/快照格式仍为1。
- Prompt版本提升至2。旧版本1未完成任务不会自动切换提示词续跑，需要新命令；已提交内容继续可读和回放。
- 本机现有数据库升级前备份至被Git忽略的`data/backups/pre-p6.db`；升级前后均为1个小说、无活动任务，SQLite完整性正常且无外键错误。生产服务已升级，书架、资料库、模型设置及资料API只读冒烟通过。
- 手工编辑开书候选、模型生成和正式确认共用知识绑定/身份隔离/改编映射校验；集成测试验证不能删除改编映射后直接确认。

自动化测试使用临时SQLite和测试目录FakeModel；本轮另完成一次真实ChatAnyWhere连通测试。截图在被Git忽略的`test-results/library-adapted.png`。离线通过和连通测试不能证明实际模型长文理解、身份识别、结构化输出稳定性或文学质量。

## 实施取舍及后续

1. 原文件采用SQLite BLOB与全文一起事务保存，未采用原方案独立文件目录；个人使用及20MiB上限下简化导入原子性。数据库体积、内存和大量作品性能尚未压测。
2. 实体模型上下文有界，但服务端Registry重建、资料详情与知识列表未分页；高级框架循环、复杂关系自动提取和自动语义清洗未交付。
3. 知识和章节边界采用JSON编辑，页面原文预览仅前8000字符（API可区间读取）。专用表单、全文定位和图形曲线后续改善。
4. 整体素材包超过模型窗口会停止；当前可编辑并发布CLEAN候选，排除不用素材后再改编。尚未跨包分批改编，不会静默截断为成功。
5. 下一优先为实际ChatAnyWhere模型/真实作品验收，再补长篇故事上下文检索和Promise软期限。回收站及备份恢复界面后置。

实现核对了 [yauzl官方文档](https://github.com/thejoshwolfe/yauzl)、[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)、[parse5](https://parse5.js.org/)、[multer限制配置](https://github.com/expressjs/multer)。这些库只用于本机解析，不获取外部正文资源。
