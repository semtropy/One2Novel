# One2Novel V2 开发细则（默认设计版）

> 版本：0.2，2026-09-05。本文是供用户直接手动修改的完整默认设计，不再逐轮问答。
> 字段、算法、阈值、接口均是待实现规范，不代表当前已有功能或模型效果已实测。
> 实施对照（2026-09-06）：MVP、P5、P6实际交付以README和对应验收记录为准。参考导入、完整分析、知识改编/发布与小说生产已打通；当前存储、确定性框架派生、人工身份确认方式及暂缓项见 [P6_ACCEPTANCE.md](docs/P6_ACCEPTANCE.md)。下文完整V2目标保留，不把尚未交付项改写为已实现。
> 原 D-001～D-003 问题由本版默认设计替代，不再等待回答。本文完成不自动启动业务开发。

## 0. 如何阅读和修改

**用户明确要求**：个人使用、仅 Web、简洁纯白、从零重写、不照搬旧代码、不迁移旧数据、所有模型服务通过 ChatAnyWhere。

**PRD 不变量**：八个领域；知识/计划/事实分离；单本串行；只有 PASS 且状态原子提交成功才完成章节；核心对象版本化。

除以上约束外，本文具体选择均为**可修改的默认设计**。建议优先修改第1节参数、第5节规划、第6节事实、第8节审核、第11节重写，修改时同步相关伪代码和验收案例。

优先级：用户最新要求 → 用户对本文的最新修改 → PRD 不变量 → 本文默认细则 → TECHNICAL_PLAN 概要。手工修改若与 PRD 不变量冲突，实际开发前列出冲突，不静默选择。旧代码和旧 CLAUDE.md 没有规范效力。

目录：1 默认决策；2 通用类型；3 Reference；4 Knowledge；5 Planning；6 Story State；7 Context/Production；8 Evaluation；9 Orchestrator；10 Platform；11 重写与数据管理；12 API/Web；13 工程与数据库；14 开发验收；15 风险与核对。

伪代码的查询、事务、集合、排序、哈希、UUID、时间、JSON Schema 校验是技术原语。模型调用是非确定性外部操作，必须遵守规定的输入输出契约。程序保证规则、引用和事务完整性，不能保证模型语义判断绝对正确。

## 1. 默认决策和参数

### 1.1 行为选择

| ID | 默认设计 | 直接影响 |
| --- | --- | --- |
| D-001 | 用户确认 Book Plan 与 State 0，再启动单章/批次；低层规划、审核、修复、提交自动执行 | 每章不额外确认，失败停在当章 |
| D-002 | 客观事实、角色认知、未证实命题分开 | “他猜李明死了”不把李明改为死亡 |
| D-003 | 程序确定性规则 + 模型量表 + 程序汇总 | 模型“总体通过”不能绕开规则 |
| D-004 | 单条有效故事链；重写先回退至前章 | 旧后文保留，但不作为当前事实 |
| D-005 | 首版Platform配置为单Worker、modelConcurrency=1 | 是部署策略；领域只要求同项目一条权威串行链 |
| D-006 | 重启不自动续费，阶段产物持久化 | 用户显式恢复；刷新页面不重复启动 |
| D-007 | 工作草稿可覆盖；候选/正式正文、知识、计划、状态、评估版本不可覆盖 | 自动保存不污染审核对象 |
| D-008 | 正文采用纯文本段落 | 编辑器只支持段落、换行、撤销重做 |
| D-009 | SkillDefinition代码注册，SkillConfig由独立本机后台配置 | 普通小说工作区不开放；启停/阈值/条件无需改代码 |
| D-010 | 文本检索默认启用，Embedding 默认关闭 | 无Embedding仍可生产 |

### 1.2 集中参数

参数在创建任务时形成不可变 ConfigSnapshot；运行中改全局设置只影响新任务。

| 参数 | 默认值 | 单位/边界 |
| --- | --- | --- |
| targetChapterCount | 300 | 1～3000章；规划目标，不等于自动完结 |
| targetChapterLength | 3000 | 第2节正文字符数，500～10000 |
| volumeTargetSize / arcTargetSize | 30 / 10 | 章，末段裁剪 |
| detailedWindow / refillThreshold | 5 / 2 | 剩余详细计划少于2时补至5 |
| maxBatchChapters | 10 | 单批1～10章 |
| chapterLengthMinRatio / MaxRatio | 0.8 / 1.2 | 超出长度区间即FAIL |
| bodyRepairLimit / deltaRepairLimit | 2 / 2 | 每章节Job累计，普通重试不重置 |
| transportExtraRetries / formatRepairLimit | 2 / 1 | 每逻辑调用；格式修复不递归 |
| chapterHttpLimit / otherJobHttpLimit | 40 / 100 | 实际模型HTTP发送次数，含重试 |
| requestTimeout / streamIdleTimeout | 180 / 45 | 秒，每次发送重新计时 |
| maxRetryAfter | 300 | 秒；更长则PAUSED等待用户 |
| autoSaveDelay / streamCheckpointInterval | 1000 / 1000 | 毫秒 |
| uploadLimit / epubExpandedLimit | 20 / 100 | MiB=1048576字节 |
| epubEntryLimit / epubSingleEntryLimit | 5000 / 20 | 条目 / MiB |
| analysisChunk / analysisOverlap | 6000 / 300 | Unicode code point |
| analysisMergeGroup | 8 | 每组摘要份数，超窗减半 |
| recentFullChapters / retrievalTopK | 2 / 8 | 近期完整章 / 历史片段 |
| retrievalChunk / retrievalOverlap | 800 / 100 | Unicode code point |
| sqliteBusyTimeout / commitTimeout | 5000 / 5000 | 毫秒 |
| backupRetention | 5 | 最近成功备份份数 |
| stateCheckpointInterval | 20 | 每20章物理Checkpoint；State 0必建；逻辑Snapshot每章都有 |
| referenceEntityLimit / recentEntityWindow | 60 / 5 | 单元最多候选实体 / 近期已成功分析章节窗口 |
| referenceEntityContextChars | 12000 | 实体候选上下文code point上限，仍服从实际模型预算 |
| stateResolverOptionalLimit | 80 | 额外相关实体上限；必要事实不受此数量截断 |
| modelConcurrency | 1 | 首版Platform部署配置，不是跨项目领域不变量 |

预算/修复次数耗尽保留进度，用户可显式增加任务额度；写 BudgetAmendment，不修改原ConfigSnapshot、不清零已用次数。重试按钮不是无限循环入口。

## 2. 通用类型、文本和版本

### 2.1 类型约定

```typescript
type Id = string;              // 服务端UUID v4，同名不等于同实体
type Revision = number;        // >=0整数，可变资源乐观锁
type ChapterNo = number;       // >=1；State 0使用0，不是正文章
type Hash = string;            // SHA-256小写十六进制
type Instant = string;         // UTC ISO-8601毫秒，仅系统执行时间
type Text = string;            // NFC Unicode，不含U+0000
type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
type Ref = {kind:string,id:Id,versionId:Id};
type Span = {textVersionId:Id,start:number,end:number,quote:Text};
type Dependency = {ref:Ref,hash:Hash};
type Version<T> = {id:Id,objectId:Id,versionNo:number,schemaVersion:1,
  payload:T,hash:Hash,dependencies:Dependency[],createdAt:Instant};
```

未标 `?` 的字段必填；未知值用null，不用空ID或false代替。数值必须finite，章号/分数/序号必须整数。引用必须验证所属项目，不能只验证ID存在。Span为规范化文本的code point半开区间[start,end)，不是UTF-16下标。

```text
normalizeText(s):
    reject U+0000; s = NFC(s)
    replace CRLF/CR with LF; remove beginning BOM
    remove line-end spaces/tabs; collapse >=3 LF into 2 LF
    return trim outer whitespace(s)
bodyLength(s): count non-whitespace code points of normalizeText(s)
validateSpan(x):
    require 0 <= start < end <= source codePointLength
    require codePointSlice(source,start,end) == quote
versionHash(payload): SHA256(UTF8(canonicalJSON(payload)))
// canonicalJSON递归按键字典序排列对象，数组保持顺序，禁止undefined/NaN。
```

### 2.2 版本生命周期

对象Object是稳定身份容器，含activeVersionId与revision；Version为不可变逻辑内容；一般产物保存完整payload，StoryStateSnapshot采用第6节元数据+Delta/Checkpoint表示，不要求每章复制全量State。Published通过独立Publication(versionId,publishedAt)标记；active是当前指针，不等于最新创建版本；Stale是依赖失效标记，不修改历史payload。Dependency必须记录实际使用版本和哈希，不能与第5节PlanAssumption混为一谈。

```text
appendVersion(object,payload,deps,expectedRevision):
    validate kind schema and dependency hashes
    transaction: require revision==expectedRevision
                 insert Version(maxVersionNo+1,payload,deps)
                 increment object.revision
    return version; do not activate
activate(version,expectedRevision):
    require published and no conflicting active project command
    transaction: compare revision; set activeVersionId; increment revision
```

revision不匹配返回409，不自动覆盖。正式正文和状态不得调用通用activate，必须走第9节联合提交。评估无可编辑工作草稿，每次运行追加新版本。

## 3. Reference：参考作品解析

### 3.1 源文本与切分

```typescript
type ReferenceSource = {id:Id,title:Text,originalFileHash:Hash,originalPath:Text,
  format:'TXT'|'EPUB',encoding:'UTF8'|'GB18030',textVersionId:Id,splitVersionId:Id};
type ReferenceChapter = {id:Id,order:ChapterNo,title:Text,span:Span};
type AnalysisUnit = {id:Id,chapterId:Id,primary:Span,input:Span};
```

原始文件完整保存；文本normalize后另存不可变版本。TXT默认严格UTF-8，失败要求用户选择GB18030并预览，不替换乱码后继续。逐行标题正则：`^\s*第[零〇一二三四五六七八九十百千万两0-9]+[章节回]\s*.*$`。首标题前非空内容为序章；无标题则全文一章，提示编辑切分。order按物理顺序分配，标题重复不合并。用户发布切分版本后才能分析。

EPUB按OPF spine顺序提取XHTML body，剔除script/style，段落映射LF；取首标题，否则文件名。拒绝绝对路径、越界`..`、符号链接、加密条目和超过第1节资源限制的文件。可预览合并/拆分。相同文件哈希默认返回已有Source，可显式另建副本。

primary互不重叠、完整覆盖章正文；input可多带前方300字符，不重复计覆盖率。原文修改/重新切分生成新版本，旧分析不覆盖。

### 3.2 分析词典

| 概念 | 结构与含义 | 边界 |
| --- | --- | --- |
| Entity | `{id,kind,name,aliases,description,evidence[]}`，类型见第6节 | 同名不是自动合并依据 |
| Scene场景 | `{id,chapterId,span,participantIds,locationId?,timeId?,summary}` | 连续时间/地点/参与者组合；明显时间跳跃或地点切换分场 |
| Event事件 | `{id,actorIds,action,result,evidence,sceneId?,sequence}` | “打算复仇”是意图，不是复仇成功 |
| Beat节拍 | `{id,eventIds,function,summary,intensity,emotionBefore,emotionAfter,evidence[]}` | 最小叙事功能变化，不是固定字数切块 |
| StateChange | `{entityId,field,before,after,eventId,evidence[]}` | 未明确before用null |
| Node结构节点 | `{id,chapterStart,chapterEnd,function,eventIds,prerequisites,effects}` | 覆盖一章或多章的叙事阶段 |
| Hook钩子 | `{id,kind,promptedQuestion,evidence,resolvedAtEventId?}` | 引发对后文期待，不等于每个问号 |
| Emotion | `{valence:-2..2,arousal:0..4,label}` | 读者预期感受，模型估计 |
| Intensity | 0无变化/1轻微/2明显/3重大/4峰值 | 分析尺度，不等于质量分 |
| Timeline | `{id,description,beforeIds,afterIds,exactTime?,evidence[]}` | 先后关系；不虚构具体日期 |
| Promise | 第6节承诺结构的参考作品版本 | 不写新小说状态 |

function统一枚举 `SETUP|GOAL|OBSTACLE|ESCALATION|REVEAL|TURN|CLIMAX|RESOLUTION|TRANSITION`，分别表示建立背景、目标、阻碍、加压、揭示、转向、峰值、结算、连接。Hook.kind为`QUESTION|DANGER|REWARD|SECRET|UNFINISHED_ACTION`。

章节输出以上数组、最多1000字符summary、coverageNotes。空数组只代表成功分析确认不存在，失败不能伪装为空。临时实体ID由服务端映射；同类型且有明确别名证据才自动合并，否则生成人工整理候选。未解决实体冲突禁止发布完整模型。

```text
analyzeReference(source,split):
    require split published
    create <=6000-character primary units, attach overlap
    for unit in order:
        reuse result only if inputHash/split/prompt/modelConfig all equal
        candidates = retrieveReferenceEntities(unit, registryVersionBeforeUnit)
        call reference.chapter with text + bounded candidates and registry provenance
        validate schema, all spans and IDs; save checkpoint
        append registry mentions/entity updates atomically with successful unit result
        failure => Job FAILED, preserve prior units
    merge arrays by stable ID; deduplicate by type/content/evidence span
    group summaries by <=8; call reference.aggregate until one root summary
    aggregate retains all descendant unit IDs and may not invent source facts
    coverage = successful primary lengths / all primary lengths
    COMPLETE iff coverage==1 and every unit valid and no unresolved conflicts
```

聚合超窗则组大小减半，单单元仍超窗报告CONTEXT_TOO_LARGE。状态`UNANALYZED|PARTIAL|COMPLETE`；仅COMPLETE可发布ReferenceModel并导出知识；PARTIAL可查看、恢复。不通过抽样宣称全量完成。

### 3.3 Reference Entity Registry与按需检索

```typescript
type ReferenceEntityRecord = {entityId:Id,sourceId:Id,splitVersionId:Id,kind:EntityKind,
  canonicalName:Text,aliases:Text[],summary:Text,firstSeenUnitId:Id,lastSeenUnitId:Id,
  mentionIds:Id[],revision:number};
type ReferenceEntityMention = {id:Id,entityId:Id,unitId:Id,nameInText:Text,span:Span};
type RegistryVersion = {id:Id,sourceId:Id,splitVersionId:Id,parentVersionId:Id|null,
  throughUnitId:Id|null,entityChangeIds:Id[]};
type RegistryRetrieval = {unitId:Id,registryVersionId:Id,entityIds:Id[],
  reasons:Record<string,('NAME'|'ALIAS'|'RECENT'|'SEARCH')[]>,textHash:Hash};
```

Registry是独立持久化身份与索引，不是不断增长的字符串。每个记录summary最多200字符，名字/别名附精确mention证据；mention完整保存，但模型只看到最多3条最相关引用。记录按source/split隔离，跨书同名不能合并。每个成功单元追加RegistryVersion，unit产物保存其输入RegistryVersion，重试严格按当时版本检索，不读取后面才出现的实体资料。

```text
retrieveReferenceEntities(unit,version):
    visible = registry entries established through version.throughUnitId
    nameHits = exact name/alias matches in current text against visible index
    recent = lastSeen within previous5 successful chapters, newest first
    historical = lexical BM25(current unit text, name/alias/summary index), top20
    union by entityId; preserve all ambiguous same-name candidates
    prioritize NAME/ALIAS, then RECENT(top20), then SEARCH
    select <=60 entries and <=12000 chars within model input budget
    if mandatory name candidates cannot fit:
        fail ENTITY_CONTEXT_TOO_LARGE with offending spans (user can split unit)
    save RegistryRetrieval and exact candidates; return candidates
```

检索结果是候选身份，不强制模型一定匹配。未命中名称可返回newEntity；同名多人返回unresolvedIdentity及mention，不随便选择。别名映射需正文证据或人工确认；服务端维护alias→多个entityId索引，不能唯一字典覆盖同名实体。人工MERGE创建带redirect关系的新RegistryVersion，重映射引用后验证；受影响后续分析标过期并顺序重跑/确认，不静默改旧分析输入。增量候选不因未被本次检索选中而被删除。

百万字验收包括跨数百章重新出现、别名、同名、Registry恢复和候选预算；禁止将全量历史实体摘要作为每单元固定Prompt。默认检索使用本地名字索引/中文BM25，不要求额外模型或Embedding；开启Embedding可作为SEARCH附加召回，仍受相同版本/数量预算约束。

## 4. Knowledge：可复用知识

### 4.1 绑定与有效性

```typescript
type KnowledgeItem = {id:Id,kind:'FRAMEWORK'|'ASSET_PACK'|'STYLE'|'TEMPLATE',
  title:Text,activeVersionId:Id|null,revision:Revision};
type KnowledgeBinding = {id:Id,projectId:Id,kind:Text,versionId:Id,enabled:boolean};
```

有效知识是任务创建时项目启用的已发布固定版本集合：最多1个Framework、3个Adapted Asset Pack、1个Style、每种目标1个Template；未绑定使用空知识/系统默认模板。被引用版本不可物理删除，可归档隐藏。

```text
resolveKnowledge(project,stage):
    load enabled bindings; reject unpublished/missing/raw assets
    enforce cardinality; select stage template; attach matching internal Skills
    reject contradictory hard constraints; return payloads/versionIds/hash
```

### 4.2 Framework：叙事结构

```typescript
type Framework = {sourceModelVersionId:Id,
  nodes:{id:Id,position:[number,number],function:Text,sourceSummary:Text,
    prerequisiteNodeIds:Id[],expectedEffects:Text[],beatFunctions:Text[]}[],
  cycles:{id:Id,nodeIds:Id[],escalationRule:Text}[],
  curves:{position:number,intensity:number,valence:number,arousal:number}[],
  statistics:{climaxGapMean:number|null,hookRate:number,beatDistribution:Record<string,number>}};
```

position起点=(起章-1)/总章数、终点=末章/总章数，范围0～1。Cycle为可重复节点模式，最多抽取3种，允许为空。climaxGapMean为相邻CLIMAX章号差均值，不足2个时null；hookRate为有钩子章数/总章数；beatDistribution为每种function占比，无节拍时全0。

统计由程序计算，其余`knowledge.framework`模型归纳；验证来源、DAG无环和位置。应用时生成`AdaptationMap(sourceNodeId,newPlanNodeId,retainedFunction,changedPremise)`；sourceSummary只作参考，不能直接成为新小说事实。机械照搬按第8节模型比较与重复规则检查。

### 4.3 Asset Pack：素材生命周期

```typescript
type Asset = {id:Id,kind:Text,name:Text,description:Text,attributes:Record<string,Json>,
  relationAssetIds:Id[],sourceSpans:Span[],originAssetId:Id|null};
type AssetPack = {stage:'RAW'|'CLEAN'|'ADAPTED',assets:Asset[],sourceVersionId:Id,
  adaptationBrief:Text|null,mapping:{oldId:Id,newId:Id,changes:Text[]}[]};
```

kind为`CHARACTER|LOCATION|ITEM|ORGANIZATION|ABILITY|WORLD_RULE|SETTING|RELATIONSHIP|DIALOGUE|CONCEPT|OTHER`。

RAW从完整ReferenceModel提取。CLEAN做格式规范、来源补齐、去重、用户排除；仅同类型+规范化名称与描述完全相同自动去重，其余人工确认，不增加改编。ADAPTED输入必填1～4000字符brief，通过`knowledge.adapt`产出新身份/背景/限制/关系映射；旧引用全部映射，新旧核心人物同名、缺失引用、无changes项均不得发布。

用户可编辑再发布。Planning明确选择哪些资产成为初始实体、未来候选或仅灵感；绑定资产包不自动引入所有角色。OTHER仅描述素材，不可直接写Custom State。

### 4.4 Style、Template、Skill

```typescript
type Style = {pov:'FIRST'|'THIRD_LIMITED'|'OMNISCIENT',tense:'PAST'|'PRESENT',
  tone:Text[],sentenceLength:'SHORT'|'MIXED'|'LONG',dialogueRatio:[number,number],
  bannedPhrases:Text[],instructions:Text[]};
type Template = {target:'BOOK'|'VOLUME'|'ARC'|'CHAPTER',schemaId:Text,defaults:Json,guidance:Text[]};
type SkillDefinition = {id:Text,version:Text,
  stages:('PLANNING'|'PRODUCTION'|'EVALUATION')[],instructions:Text[],
  configSchemaId:Text,evaluatorBindings:{evaluatorId:Text,required:boolean}[],defaultConfig:Json};
type SkillConfig = {id:Id,skillId:Text,definitionVersion:Text,versionNo:number,
  enabled:boolean,priority:number,config:Json,
  applicable:{genres:Text[],chapterFunctions:Text[],chapterRange:[number,number]|null},
  createdAt:Instant};
type SkillConfigPointer = {skillId:Text,activeVersionId:Id,revision:Revision};
```

Style是持续表达偏好；默认THIRD_LIMITED、PAST、tone=[]、MIXED、对白比例[0,1]、无禁用词。对白比例为成对中文/ASCII双引号内非空白字符数/全文非空白字符数，嵌套不重复；未闭合引号是格式问题。中文时态由模型判断。

Template只提供已有schema的默认字段与生成指导，不能增加可执行代码/改变schema。覆盖顺序为系统默认→模板→用户显式字段；事实是硬约束，矛盾报错。

SkillDefinition是代码内注册的内部指令/检查能力，非自主Agent；重复id启动报错，不允许运行时上传代码。SkillConfig是后台可改的配置版本：启用、优先级、题材/章节适用条件和符合configSchema的参数。二者分离，启停不修改Definition。条件空数组不限、多个条件AND；chapterFunctions匹配计划Beat.function，按priority降序/id升序应用。

默认注册`chapter-goal`、`character-knowledge`、`ending-hook`：前两项为写作指导，Evaluator核心检查独立强制存在；ending-hook仅提供钩子增强建议，禁用不解除ChapterPlan.hook.required。配置可调增强强度/软建议阈值，不可将已要求的硬任务移除。角色知识核心验证不能借Skill关闭。新增审核型Skill声明evaluatorBindings，由第8节策略解析器纳入，不改公共Result schema。绑定的required由Definition确定，启用多个Skill时同ID取required优先；Evaluator参数只来自Policy，SkillConfig不覆盖审核阈值，消除优先级冲突。Policy必须为所有可能启用的绑定ID提供版本和参数，否则启用配置返回422。

```text
updateSkillConfig(adminRequest):
    require local admin authentication + expectedRevision
    require registered definition/version; validate config with definition.configSchema
    validate applicable ranges and evaluator parameter overrides
    reject attempts to disable Core Evaluator or weaken fixed hard rules
    transaction: append immutable SkillConfig version; CAS active pointer
    return new config version; running Jobs remain on their frozen configs

resolveSkills(stage,project,chapterPlan):
    load active configs; match enabled + stage + applicable
    sort by priority DESC/id ASC
    freeze definition versions/config versionIds in Job ConfigSnapshot
    return instruction fragments + declared evaluator bindings
```

独立本机`/admin`页面与`/api/v1/admin`接口管理配置，不进入普通导航和小说工作区。后台不建设多用户权限系统，但要求单独`ONE2NOVEL_ADMIN_TOKEN`；输入换取仅内存/HttpOnly、SameSite=Strict的短期管理员会话，1小时过期，服务重启失效。密钥不进入URL/localStorage/日志；未配置Token时后台关闭。提供Definition只读列表、SkillConfig编辑/启停/版本回滚、审核策略管理；普通同源会话无管理员资格。后台只能改已注册能力的参数，不能创建未知Evaluator或执行任意脚本。

```text
applyKnowledge(input):
    fill missing plan fields with template defaults
    add framework functions and selected adapted assets as planning candidates
    attach style and skills; generate typed plan + AdaptationMap
    validate constraints/references; append version, never write Story State
```

## 5. Project / Planning：创建和滚动规划

### 5.1 项目与开书

```typescript
type Project = {id:Id,title:Text,idea:Text,genre:Text,
  requirements:{must:Text[],avoid:Text[],preferences:Text[]},
  targetChapterCount:number,targetChapterLength:number,
  status:'DRAFT'|'READY'|'WRITING'|'FINISHED'|'ARCHIVED',revision:Revision,
  chainEpoch:number,headChapter:number,headSnapshotId:Id|null,activeBookPlanId:Id|null};
```

idea为1～2000字符核心设想，genre为1～50字符；must/avoid各最多20项、每项500字符，是硬要求/禁区，preferences为软偏好。无标题使用“未命名小说”，标题修改不影响故事状态。

创建只写DRAFT，不自动调用模型。生成开书方案产出BookPlan、InitialCanonCandidate、首卷/首Arc候选；用户确认后事务发布Book/Canon/State 0，进入READY。未来结局、尚未发生的死亡不进入Canon。Canon是作者确认开篇前已成立的规则与实体初始事实；第一章前可重建State 0，已有正文则按第11节从第一章重写。

### 5.2 计划词典与结构

```typescript
type Constraint = {id:Id,severity:'HARD'|'SOFT',
  kind:'MUST_EVENT'|'FORBID_EVENT'|'STATE_EQUALS'|'PRESERVE_FACT'|'TEXT_RULE',
  targetId:Id|null,field:Text|null,value:Json,description:Text};
type PlannedGoal = {id:Id,description:Text,successEvidence:Text,required:boolean};
type PlanCommon = {id:Id,level:'BOOK'|'VOLUME'|'ARC'|'CHAPTER',parentVersionId:Id|null,
  chapterRange:[ChapterNo,ChapterNo],title:Text,summary:Text,basedOnSnapshotId:Id|null,
  knowledgeVersionIds:Id[],constraints:Constraint[],goals:PlannedGoal[],assumptions:PlanAssumption[]};
type BookPlan = PlanCommon & {premise:Text,centralQuestion:Text,endingDirection:Text,
  requiredFinalPromiseIds:Id[],
  volumeDirections:{order:number,chapterRange:[number,number],goal:Text}[]};
type VolumePlan = PlanCommon & {entrySituation:Text,exitGoal:Text,
  arcDirections:{order:number,chapterRange:[number,number],goal:Text}[]};
type ArcPlan = PlanCommon & {trigger:Text,opposition:Text,turn:Text,resolutionTarget:Text};
type ChapterPlan = PlanCommon & {castIds:Id[],locationIds:Id[],
  beats:{order:number,function:Text,description:Text,goalIds:Id[]}[],expectedEvents:Text[],
  hook:{required:boolean,kind:Text|null,question:Text|null},
  promiseActions:{promiseId:Id,action:'ADVANCE'|'RESOLVE',required:boolean}[],targetLength:number,
  allowedQuotes:{text:Text,sourceRef:Ref}[]};
```

**Constraint.value的类型与执行规则**：MUST_EVENT/FORBID_EVENT为`{eventDescription:Text,atChapter:number}`，模型逐项判断发生/未发生并给证据；STATE_EQUALS为`{collection:Text,key:Id,field:Text,equals:Json}`，按第6节白名单读取并深比较；PRESERVE_FACT为`{propositionId:Id,truth:'TRUE'|'FALSE'}`，要求当前命题值及正文不否定；TEXT_RULE为`{rule:'BANNED_PHRASE'|'POV'|'LENGTH_RANGE',argument:Text|[number,number]}`，分别由子串匹配、Style语义检查、bodyLength区间检查。未知rule/字段422。targetId/field是显示定位元数据，必须与value中的目标一致，不提供第二套冲突值。

Book/Volume/Arc的MUST_EVENT只在atChapter当章判定必须出现，不能要求每章兑现结局；FORBID_EVENT、STATE_EQUALS/PRESERVE_FACT在所属计划范围内持续有效。PlannedGoal的截止为所属计划range.end，ChapterGoal当章检查。提前达成可记录GoalFulfillment`{goalId,contentVersionId,eventRefs,evaluationVersionId}`，必须有审核PASS的达成证据；截止时未达成为MAJOR。所有达成记录仅在active正文链上有效。

**未来实体**：PlanEntity是`{id,projectId,kind,name,aliases,description,proposedInitialFields,sourceAssetId?}`的版本化创作候选，单独存在Planning，不在StoryState.entities中。castIds/locationIds可引用本项目active实体或已发布PlanEntity；Context明确标注“未来候选，尚未成为事实”。引入章节必须有明确出场/存在事件，Delta.CREATE使用该稳定id转入Story State并验证初始字段的正文证据。不能因计划选中候选而提前CREATE；实体查找同名产生候选，不隐式等同。未绑定PlanEntity的新正文实体先由抽取返回临时ID，服务端映射新UUID并验证，不强制先写计划才能出现。

Volume是连续章范围的阶段目标；Arc/重大事件是含触发、阻碍、转折、结算的因果过程，不是单个StoryEvent；ChapterPlan是本章未来任务，range两端相同；Beat是预计叙事节拍。Goal通过successEvidence描述正文如何证明达成，不能只按关键词判定。

Book覆盖1～目标章数，默认30章/卷、10章/Arc，末段裁剪。兄弟范围连续、互不重叠且覆盖父范围；修改范围须提交完整同层列表。Book包含全部卷方向，只详细生成当前卷/Arc；未来方向不是已发生事实。

### 5.3 校验和滚动算法

规划输入为Project、父计划、最新Snapshot与KnowledgeContext。程序验证schema、范围、引用、同字段硬约束冲突；`planning.validate`任务输出`violations[{constraintId,reason,evidence}]`和`uncertain[]`，检查是否违反事实/父目标/照搬原剧情。任一违反或不确定不得启用。

Book版本需用户确认；初始确认后低层计划可由同一生产链自动启用，不能改Book硬约束。目标无解时WAITING_USER，不硬写。

```text
ensureRollingPlans(project):
    N = headChapter+1; require N<=targetChapterCount
    get containing Volume/Arc directions; generate details if missing/stale
    remaining = contiguous active, nonstale ChapterPlans from N
    if remaining.count < 2:
        generate missing plans through min(N+4,currentArc.end,targetChapterCount)
    require valid ChapterPlan(N)
```

basedOnSnapshot可以是当前链祖先，不因每章提交自动stale。未完成计划的硬约束不再成立、HARD PlanAssumption不匹配、知识绑定改变、父计划更换、历史重写触发stale；SOFT假设变化触发复核，不直接制造正文审核失败。Arc结束以实际结果生成下一Arc。

例：第一章获得钥匙与第二章任务一致，后者仍有效；人物已死而后章计划要求其对白，必须重规划。硬目标不能通过低层改写解决时等待用户改Book。

### 5.4 PlanAssumption / PlanDependency：计划成立的前提

Constraint表示“新剧情必须满足什么”；PlanAssumption表示“规划时假定什么已经成立”。PlanDependency是由Assumption生成的反向索引记录，不是第二套业务规则；第2节Dependency则只是不可变产物版本引用。

```typescript
type StateSelector = {collection:Text,key:Text,field:Text}; // 普通key为UUID，knowledge为characterId:propositionId
type PlanAssumption = {id:Id,selector:StateSelector,
  operator:'EQUALS'|'NOT_EQUALS'|'CONTAINS'|'EXISTS',expected:Json,
  importance:'HARD'|'SOFT',reason:Text,basedOnSnapshotId:Id|null};
type PlanDependency = {planVersionId:Id,assumptionId:Id,collection:Text,key:Text,field:Text};
type AssumptionCheck = {assumptionId:Id,result:'MATCH'|'MISMATCH'|'UNKNOWN',actual:Json,
  evaluatedSnapshotId:Id};
```

selector.currentTruth先解引用Proposition.currentVersionId；缺实体/字段且operator非EXISTS返回UNKNOWN。EXISTS的expected是boolean，字段存在但值null算不存在；EQUALS深比较；NOT_EQUALS对已知值取反；CONTAINS用于数组含成员/字符串完整子串，类型错误422。HARD/SOFT表示前提对计划可执行性的影响，不等于审核Issue等级。

只有开书未确认候选允许basedOnSnapshotId=null；确认时先预分配State 0 ID，针对Canon构造的State逐项求值，将全部前提绑定该ID，并与Book/Canon/State 0同事务发布。一般计划启用不允许null。StateSelector.collection/field由状态schema白名单校验，knowledge按复合键查找；PlanDependency.key同样为Text。缺失actual序列化为null，result=UNKNOWN明确区分于已知null。

计划生成必须输出显式assumptions。程序为cast中的既有角色增加life=ALIVE、明确目的地增加accessible=true（仅已知可访问时）等HARD前提；UNKNOWN不能凭空填true。对于“双方可接触”“秘密未公开”等语义前提，planner必须引用关系/认知/命题字段或生成可验证命题依赖，不能只留一段reason。无法表达时标记待复核并禁止自动启用。未来PlanEntity用计划版本Dependency，不伪造已存在事实假设。

```text
checkPlanAssumptions(plan,currentState):
    evaluate all selectors with declared operators -> check list
    if any HARD MISMATCH/UNKNOWN: mark plan STALE; require replanning before use
    else if any SOFT MISMATCH/UNKNOWN: mark NEEDS_REVIEW
    else: mark VALID (subject to version/hard-constraint validation)
    append immutable PlanReview; never edit existing plan payload

afterCommit(delta,newSnapshot):
    changedKeys = all touched collection/key/fields + related proposition truth changes
    lookup future PlanDependency matching changedKeys; check affected plans
    add due Promise planning signals as defined in6.3
    before starting any chapter: recheck ALL its assumptions against current head
```

NEEDS_REVIEW不能直接用于生成。`planning.review-assumptions`输入旧计划、差异、当前事实，输出KEEP（理由与仍可执行证据）或REPLAN；KEEP创建替换PlanVersion并更新假设，重新走planning.validate，不原地接受旧预期。HARD变化必须重规划，不允许模型用KEEP越过。审查成功可自动启用低层计划；涉及Book更改则WAITING_USER。复核失败保留信号并停止，不能后台失败后继续用旧计划。

## 6. Story State：事实、事件与转换

### 6.1 命题与角色认知

```typescript
type EntityKind = 'CHARACTER'|'LOCATION'|'ITEM'|'ORGANIZATION'|'ABILITY'|'CONCEPT';
type Entity = {id:Id,kind:EntityKind,name:Text,aliases:Text[],description:Text};
type Evidence = {origin:'CANON'|'CONTENT',sourceVersionId:Id,span:Span|null,
  assertion:'EXPLICIT_NARRATION'|'OBSERVED_ACTION'|'DIALOGUE'|'INFERENCE',note:Text};
type Proposition = {id:Id,subjectId:Id,predicate:Text,object:Json,currentVersionId:Id|null};
type PropositionVersion = {id:Id,propositionId:Id,truth:'TRUE'|'FALSE'|'UNVERIFIED',
  changeKind:'INITIAL'|'WORLD_CHANGE'|'CORRECTION'|'CLAIM',
  effectiveAtEventId:EventRef,recordedAtEventId:EventRef,
  supersedesVersionId:Id|null,correctsVersionId:Id|null,evidence:Evidence[]};
type CharacterKnowledge = {characterId:Id,propositionId:Id,propositionVersionId:Id,
  learnedAtEventId:EventRef,attitude:'KNOWS'|'BELIEVES'|'SUSPECTS'|'REJECTS',evidence:Evidence[]};
```

无认知记录=UNKNOWN，不等于明确不知道。Proposition是固定语义的命题身份（如“门是开着的”），subject/predicate/object不可修改；客观当前值由currentVersionId解引用，旧PropositionVersion永不覆盖。时间先后使用EventRef及故事Timeline，不以数据库创建时间代替故事时间。

KNOWS表示角色在learnedAtEventId确认获得了所引用命题版本的信息；要求取得时该版本truth=TRUE、有学习/观察证据，但**不要求永远等于客观当前版本**。BELIEVES可指向已证伪/主张版本；SUSPECTS为猜测；REJECTS为不信该版本。角色最后获知的版本只有在新学习/观察/反驳事件后才更新，世界变化本身不能批量改角色认知。

WORLD_CHANGE表示世界后来变了：第10章门开，v1.truth=TRUE；第11章门关闭，新v2.truth=FALSE，effectiveAt指向关门事件。v1在第10章成立的历史不变，角色A仍KNOWS(v1)，系统仅派生“认知可能过时”。CORRECTION表示后来发现旧判断本就错误：创建带correctsVersionId的纠正版本，不修改旧记录、不假定角色已收到纠正信息。CLAIM是对白/推断产生的未证实版本，可以被认知引用，但不能覆盖已有客观currentVersionId；没有客观结果时currentVersionId可以null。

```text
knowledgeFreshness(k,state):
    if an active-chain CORRECTION explicitly corrects k.propositionVersionId: CORRECTED
    else if state.propositions[k.propositionId].currentVersionId==k.propositionVersionId: CURRENT
    else if a later objective WORLD_CHANGE supersedes that version: OUTDATED
    else: UNKNOWN
// 此结果是系统诊断，不是角色获知事件，不写回attitude。
```

剧情闪回必须给effectiveAtEventId和recordedAtEventId不同的明确引用；旧Snapshot保持“截至当章已记录的世界知识”，后章追加对过去的纠正，不重写旧章节的知识视角。同一命题同一有效时点不得有两份未解释的相反客观结论；语义不清为状态验证FAIL。

Evidence.origin=CONTENT时span必填，且span.textVersionId必须等于sourceVersionId；CANON时span=null并引用已确认Canon版本。来源与被审核候选不匹配直接拒绝，不能借旧章节片段证明当前发生的变化。

Entity类型边界：CHARACTER为能行动/认知的个体；LOCATION为可定位场所；ITEM为可持有/移动资源；ORGANIZATION为成员集合；ABILITY为可被角色掌握的能力身份，限制通过worldRules描述；CONCEPT为可引用的抽象身份（称号、货币单位、学说等），仅有Entity通用字段，无专属可变状态。概念变化用有证据的Proposition表示，不能在description中暗藏可执行规则；世界约束必须进入worldRules。

```text
routeAssertion(a):
    confirmed Canon => Proposition + INITIAL PropositionVersion, set currentVersionId
    explicit observed action or unambiguous narration outside dream/rumor
        => append objective version candidate (WORLD_CHANGE or CORRECTION)
           update currentVersionId only after state semantic validation
    otherwise => append UNVERIFIED CLAIM version + optional BELIEVES/SUSPECTS
                 do not overwrite objective pointer
    never promote model confidence alone to objective truth
```

对白“我杀了他”、梦境、传闻、主观猜测不能直接确认死亡。第一人称/限知视角的主观判断默认未证实。模型识别语义，程序验证引用，再经状态语义审核；不声称代码能证明叙述真实。

### 6.2 状态结构

```typescript
type StoryState = {projectId:Id,chapterNo:number,canonVersionId:Id,
  entities:Record<Id,Entity>,
  characters:Record<Id,{life:'ALIVE'|'DEAD'|'UNKNOWN',locationId:Id|null,
    conditions:Text[],abilityIds:Id[],organizationIds:Id[]}>,
  relationships:Record<Id,{fromId:Id,toId:Id,type:Text,
    stance:'ALLY'|'NEUTRAL'|'HOSTILE'|'UNKNOWN',description:Text}>,
  locations:Record<Id,{parentLocationId:Id|null,condition:Text,accessible:boolean|null}>,
  items:Record<Id,{holderId:Id|null,locationId:Id|null,condition:Text,quantity:number|null}>,
  organizations:Record<Id,{status:'ACTIVE'|'DISBANDED'|'UNKNOWN',leaderId:Id|null,memberIds:Id[]}>,
  worldRules:Record<Id,{description:Text,scopeEntityIds:Id[],constraint:Constraint|null,
    mutable:boolean,active:boolean}>,
  propositions:Record<Id,Proposition>,knowledge:CharacterKnowledge[],
  timeline:Record<Id,{eventId:EventRef,beforeIds:Id[],afterIds:Id[],exactTime:Text|null}>,
  promises:Record<Id,NarrativePromise>,conflicts:Record<Id,ActiveConflict>,
  goals:Record<Id,ActiveGoal>,custom:Record<Id,CustomValue>};
type Snapshot = {id:Id,projectId:Id,chapterNo:number,canonVersionId:Id,schemaVersion:1,
  parentSnapshotId:Id|null,deltaVersionId:Id|null,stateValidationVersionId:Id|null,
  stateHash:Hash,createdAt:Instant};
type ResolvedSnapshot = {meta:Snapshot,state:StoryState}; // 运行时/读取API，不按章持久化全量state
type PhysicalCheckpoint = {snapshotId:Id,schemaVersion:1,codec:'JSON_GZIP',
  compressedState:Uint8Array,stateHash:Hash,createdAt:Instant};
```

World State是worldRules与世界级命题，不另设任意JSON真相源。mutable=false规则不可由章节改动。计划里尚未获得的能力不能预写abilityIds。地点包含关系不可成环。物品holder（角色/组织）与location最多一个非null。组织memberIds与角色organizationIds必须一致。

### 6.2.1 逻辑快照与物理Checkpoint

每章都有Snapshot元数据，业务仍可读取Snapshot N；物理上只保存Delta N及每20章一个PhysicalCheckpoint，State 0必建。PropositionVersion为独立不可变表，State只保存命题身份/当前指针及角色观察版本引用，不把所有命题历史重复放进Checkpoint。

```text
loadSnapshot(snapshotId):
    target = load Snapshot metadata; validate project ownership
    walk parentSnapshotId backwards until an ancestor PhysicalCheckpoint exists
    // 必须沿同一父链找祖先，不按chapterNo<=N查询，避免重写分支串线
    require path ends at a verified checkpoint (State0 guarantees one)
    S = decode checkpoint; require canonical hash(S)==checkpoint.stateHash
    for meta in reversed(path after checkpoint):
        D = load immutable Delta(meta.deltaVersionId)
        require D.baseSnapshotId == meta.parentSnapshotId
        S = simulateDelta({meta:parentMeta,state:S},D,mode=REPLAY)
        require hash(S)==meta.stateHash
    resolve needed immutable PropositionVersions by versionId; verify references
    return {meta:target,state:S}
```

REPLAY只执行确定性schema/expected/引用/状态转移检查并复现已验证操作，不再次调用模型。语义审核证明及规则版本随Delta保存；历史回放使用对应schema/规则版本，不随当前策略变化产生新判断。Checkpoint与Delta中的schema升级通过显式迁移/读取适配，不偷偷改旧stateHash。

默认每20章时在最终事务外预先序列化模拟State和压缩，在最终事务内写Snapshot+Delta+Checkpoint；State 0同理。写Checkpoint失败导致该次提交回滚，不能完成章后发现恢复点缺失。正常最多回放19条Delta；重写只沿新链，旧Checkpoint仍供历史查询。校验和错误/Delta缺失返回STATE_CORRUPTED并停止，不用模型修复存储损坏。可缓存已解析State，但缓存按snapshotId/stateHash索引，丢失不影响权威性。

### 6.3 Promise / Conflict / Goal / Custom

```typescript
type NarrativePromise = {id:Id,kind:'FORESHADOW'|'MYSTERY'|'SECRET'|'TASK'|'CONFLICT'|'EXPECTATION',
  description:Text,setupEventId:EventRef,subjectIds:Id[],status:'OPEN'|'ADVANCED'|'RESOLVED'|'ABANDONED',
  lastEventId:EventRef,resolutionCondition:Text,resolutionEventId:EventRef|null};
type ActiveConflict = {id:Id,partyIds:Id[],stake:Text,status:'ACTIVE'|'ESCALATED'|'RESOLVED',eventId:EventRef};
type ActiveGoal = {id:Id,ownerId:Id,description:Text,successCondition:Text,
  status:'ACTIVE'|'ACHIEVED'|'FAILED'|'ABANDONED',eventId:EventRef};
type CustomValue = {id:Id,definitionVersionId:Id,ownerId:Id|null,value:Json,evidence:Evidence[]};
```

Promise是正文已经建立的读者期待，计划准备埋的伏笔不算。OPEN→ADVANCED可反复；OPEN/ADVANCED→RESOLVED/ABANDONED必须有事件证据。ABANDONED表示正文交代取消/失败，不是程序忽略；终结不可重开，新的期待建新ID。

dueChapter是**规划软提示**，不把“七天”换算七章，也不因为到期本身阻止当前章提交。安排回收章号属于Planning的PromiseSchedule版本`{promiseId,dueChapter:number|null,reason,versionId}`，无Schedule等价于dueChapter=null。NarrativePromise事实payload不含dueChapter，API可另加schedule对象；Schedule不进入stateHash，不通过事实Delta修改规划日期。

```text
collectPromiseSignals(head, activeSchedules, state):
    for schedule whose dueChapter<=head and promise status OPEN/ADVANCED:
        append/upsert PlanningSignal(PROMISE_DUE,promiseId,schedule.versionId)
        show reminder; mark future rolling plan NEEDS_REVIEW
    // 不产生阻断Issue，不修改Promise事实状态，不撤销本章PASS。
```

下次滚动规划消费信号：提前/延期安排或加入未来章promiseActions，保存新Schedule及理由，不能把Promise直接设RESOLVED。真正门禁来自`ChapterPlan.promiseActions[].required=true`：required RESOLVE必须在正文中满足resolutionCondition，required ADVANCE必须有实质推进事件；不满足为FAIL。只因为“本来打算100章左右处理”而到期，不能强迫重写第100章。未消费信号在生成下一章前必须完成规划复核或明确延期，但该复核失败也不回滚已提交正文。

Conflict是利益对立，Goal是角色追求，Promise是读者期待；可以关联但不合并字段。角色放弃Goal不自动解决Promise。CustomDefinition代码注册`{id,version,valueSchema,allowedOwnerKinds,mutable}`，默认空；未知字段返回UNSUPPORTED_STATE_FIELD，普通用户不编写schema。

### 6.4 Event、Delta与验证

```typescript
type StoryEvent = {id:Id,contentVersionId:Id,order:number,
  kind:'ACTION'|'REVELATION'|'STATE_CHANGE'|'RELATION_CHANGE'|'PROMISE_CHANGE'|'GOAL_CHANGE',
  actorIds:Id[],description:Text,evidence:Evidence[],assertions:PropositionVersion[],proposedChanges:Change[]};
type Change = {collection:'entities'|'characters'|'relationships'|'locations'|'items'|'organizations'|
  'worldRules'|'propositions'|'knowledge'|'timeline'|'promises'|'conflicts'|'goals'|'custom',
  key:Id|Text,operation:'CREATE'|'SET_FIELDS',expected:Record<string,Json>|null,
  values:Record<string,Json>,eventId:Id,order:number};
type Delta = {baseSnapshotId:Id,contentVersionId:Id,eventIds:Id[],changes:Change[],
  propositionVersions:PropositionVersion[],stateRuleVersion:Text};
```

knowledge键为`characterId:propositionId`，保存角色最后取得的命题版本；历史认知由旧Snapshot/Delta可重建。持久化/模拟按键操作，解析State输出为稳定排序数组。无DELETE，消失/死亡/取消通过状态表达。SET_FIELDS只允许schema字段，禁止改id/kind及既有命题的subject/predicate/object；propositions只允许更改currentVersionId。PropositionVersion仅追加，不能SET_FIELDS修改它的truth/evidence。expected包含全部被改字段的旧值，CREATE要求key不存在、expected=null。数组整体替换、去重校验。

先抽事件与提案，服务端映射新增临时ID，再按event.order/change.order模拟，不跳过中间因果。同事件组允许临时交叉引用，组结束统一验证。

```text
simulateDelta(base,delta,mode=VALIDATE):
    require base.meta.id==delta.baseSnapshotId; S=deepCopy(base.state)
    validate proposed immutable propositionVersions and their EventRef/lineage
    include new versions in a read-only overlay for pointer/knowledge validation
    for event group in order:
        for change in group order:
            require event evidence refers to candidate content
            validate allowed collection/field/type
            CREATE: require absent key; insert typed record
            SET_FIELDS: require selected current fields==expected; assign values
        validate references, nonnegative quantity, item holder/location exclusion,
          membership symmetry, immutable rules,
          knowledge KNOWS refers to version TRUE when learned, not current truth,
          promise/goal/conflict transitions, acyclic location/timeline
        DEAD->ALIVE requires explicit revival evidence and active world rule permitting it
    S.chapterNo=base.meta.chapterNo+1; return S without database writes
```

VALIDATE与REPLAY使用相同版本化的确定性转换函数。REPLAY读取已提交正文、事件、命题版本和StateValidation记录，不重新执行模型语义判断；复活等语义许可读取已提交校验结果，仍验证结构、前置值、引用和哈希。被引用命题版本必须属于base祖先链或本次Delta的已发生事件组，不得引用未来事件组/其他支线；KNOWS取得时的TRUE依据冻结证据校验，后续纠正不倒改历史观察记录。缺少stateRuleVersion对应实现报CONFIG_VERSION_UNAVAILABLE，不能以当前新规则重放旧Delta。

复活许可由状态审核引用具体ruleId确认，不根据题材猜测。状态审核任务`state.validate`输入base、正文、事件、Delta、模拟结果，输出`checks[{changeIndex,verdict:PASS|FAIL|UNKNOWN,reason,spans}]`、`missingChanges[]`、`noStateChange:boolean`、`revivalAuthorizations[{changeIndex,ruleId,spans}]`。每条变更须PASS；FAIL/UNKNOWN/遗漏均阻断。每项DEAD→ALIVE变更还必须匹配一个复活许可：changeIndex指向该变更，ruleId属于base中已生效的世界规则，spans是正文中可校验的非空证据；没有复活时返回空数组。空Delta须noStateChange=true并解释，经独立模型复核后才能通过。

格式/引用错误→修复Delta或重新抽取；正文违背旧事实→修复正文并重新审核/抽取；Canon冲突且无法修正文→WAITING_USER。所有修复从原base重新模拟，不能修补已提交Snapshot来迁就正文。

### 6.5 Canon与状态转换补充契约

```typescript
type EventRef = {kind:'INITIAL'|'CONTENT',id:Id};
type InitialEvent = {id:Id,canonVersionId:Id,description:Text};
type Canon = {rules:StoryState['worldRules'],initialEntities:Entity[],
  initialState:Omit<StoryState,'projectId'|'chapterNo'|'canonVersionId'|'entities'>,
  initialEvents:InitialEvent[],initialPropositionVersions:PropositionVersion[]};
type InitialCanonCandidate = {payload:Canon,bookPlanVersionId:Id,
  sourceKnowledgeVersionIds:Id[],warnings:Text[]};
```

第6节Promise的setupEventId/lastEventId/resolutionEventId、Goal/Conflict/Timeline的eventId实际存储类型统一为EventRef（nullable字段仍可null），保留字段名便于阅读。Delta的eventId只允许CONTENT事件UUID，不接受InitialEvent。初始确认先为Canon版本预分配ID，再映射InitialEvent中的canonVersionId，避免循环引用无法创建；State 0所有初始记录指向INITIAL事件或Canon Evidence。

初始确认校验所有schema、引用、图、物品归属和双向成员关系；要求warnings已由用户逐项标记已处理，初始Canon不能含未来事件（用户确认界面明确区分）。确认后State 0由Canon构造，原子写入初始命题版本、逻辑Snapshot及PhysicalCheckpoint，chapterNo=0、parentSnapshotId=null、deltaVersionId=null。初始人物可UNKNOWN，不能默认全员ALIVE。

允许的状态转换（同状态仅允许更新描述并有证据）：

| 对象 | 允许转移 | 附加条件 |
| --- | --- | --- |
| life | UNKNOWN→ALIVE/DEAD；ALIVE→DEAD；DEAD→ALIVE | 死亡/复活明确证据；复活另需世界许可 |
| Promise | OPEN→ADVANCED/RESOLVED/ABANDONED；ADVANCED→RESOLVED/ABANDONED | 终结不可重开；必须事件支持 |
| Conflict | ACTIVE→ESCALATED/RESOLVED；ESCALATED→ACTIVE/RESOLVED | 缓和可回ACTIVE，RESOLVED不可重开 |
| Goal | ACTIVE→ACHIEVED/FAILED/ABANDONED | 终态不可改，后续新目标新ID |
| Organization | UNKNOWN→ACTIVE/DISBANDED；ACTIVE→DISBANDED | 重建用新实体；旧身份不静默复活 |
| Proposition | 同一身份追加新版本；currentVersionId只能指向已验证客观版本 | WORLD_CHANGE/纠错区分；旧版本不改，CLAIM不覆盖客观值 |
| Knowledge | 任意attitude→任意attitude或观察版本更新 | 仅有新获知事件才更新；KNOWS校验所观察版本的取得时状态 |

客观currentVersion改变不产生任何隐式CharacterKnowledge写入。模型可以报告OUTDATED/CORRECTED诊断，但不能将未获新信息的角色自动降级或同步获知。条件数组的每个字符串只是可描述状态，变更仍需证据，不能借此塞入任意控制字段。

## 7. Context / Production：上下文与正文

### 7.1 正文对象

```typescript
type Chapter = {id:Id,projectId:Id,order:ChapterNo,title:Text,
  activeContentVersionId:Id|null,revision:Revision,
  status:'PLANNED'|'CONTEXT_BUILDING'|'WRITING'|'EVALUATING'|'REVISING'|'APPROVED'|
    'EXTRACTING_STATE_DELTA'|'VALIDATING_STATE'|'COMMITTING'|'COMPLETED'|'FAILED'|'STALE'};
type WorkingDraft = {chapterId:Id,text:Text,revision:Revision,updatedAt:Instant,
  sourceContentVersionId:Id|null};
type Content = {chapterId:Id,text:Text,bodyLength:number,
  origin:'GENERATED'|'MANUAL'|'REVISED',parentVersionId:Id|null,contextVersionId:Id};
type GenerationDraft = {attemptId:Id,text:Text,complete:boolean,codePointLength:number,updatedAt:Instant};
```

WorkingDraft是可编辑工作区；GenerationDraft是流式暂存，不能自动覆盖WorkingDraft；ContentVersion是冻结候选；“正式正文”仅指Chapter.activeContentVersionId指向的版本。草稿/候选不是完成，不参与历史检索。正文编辑规范化后统一用于哈希、审核和抽取，不另保留一套HTML真相源。

手动正文必须由“提交审核”命令冻结为候选，并经过与生成正文相同的门禁；不提供直接改active正文的PATCH接口。未完成章节只允许审核head+1；后面的章节可保存草稿，不能提前生成或提交。

### 7.2 ContextBlock 与预算

```typescript
type ContextBlock = {id:Text,kind:Text,sourceRefs:Ref[],text:Text,
  required:boolean,priority:number,estimatedTokens:number};
type ContextManifest = {chapterId:Id,baseSnapshotId:Id,planVersionId:Id,
  knowledgeVersionIds:Id[],selected:ContextBlock[],droppedIds:Text[],
  modelConfigVersionId:Id,inputEstimate:number,outputReserve:number,hash:Hash};
```

固定优先级：100系统规则/本章计划/Canon硬规则；95本章必要实体及其观察版本、地点/物品/关系；90required Promise动作与相关事实；85父Book/Volume/Arc概要；80前二章正文；60绑定Style/适用Skill；50当前Arc摘要和Promise软提醒；40历史检索；20参考框架例子。系统规则、本章计划、Canon硬规则、StateContextResolver确定的必要事实、required Promise、Style硬约束为required，其他optional。dueChapter本身不把Promise变成写作硬义务。

### 7.2.1 StateContextResolver

StateContextResolver是Production内从逻辑Snapshot选择事实的纯解析器，不是新业务域、不直接改状态。输入不只依赖castIds，也包含expectedEvents、locations、PlanAssumptions、required promises、活动冲突/目标和近期事件。

```typescript
type StateContextSelection = {snapshotId:Id,requiredRefs:Ref[],optionalRefs:Ref[],
  reasonByRef:Record<string,Text[]>,unresolvedMentions:Text[],hash:Hash};
```

```text
resolveStateContext(plan,logicalSnapshot):
    S = loadSnapshot(logicalSnapshot.id).state
    hardSeeds = plan cast/location IDs + hard Constraint/Assumption targets
                + required Promise subjects/related event entities
    textSeeds = exact names/aliases in expectedEvents/goals/beats + lexical search hits
    extraSeeds = active conflicts/goals related to hard/text seeds
                 + participant IDs in previous2 chapters' committed events
    resolve all against S, keeping PlannedEntity candidates separately marked
    expand seeded entities one hop: relationships, holders, locations, organizations
    attach objective current PropositionVersions AND each relevant character's learned versions
    hard referenced fields/entities and their integrity dependencies => required
    incidental graph/search/recent facts => optional, stable rank then id, max80 entities
    do not include future/removed-chain facts
    unresolved hard mention or ambiguous identity => fail STATE_CONTEXT_UNRESOLVED
    persist selection/provenance; no state writes
```

名字命中多个同名实体时同时保留候选，计划需要明确其行动身份则暂停修订计划；不得随意选择。角色观察版本与客观最新版本分别标注，不把OUTDATED/CORRECTED诊断写成角色已知信息。required超过预算按既有规则失败，不通过max80裁掉。语义审核指出缺事实时，按具体state ref补充并重建ContextManifest、新attempt，保留输入hash和调用预算，禁止临时注入未记录的事实。

### 7.2.2 Context选择算法

```text
buildContext(N):
    require current head==N-1; load immutable base and ChapterPlan(N)
    load required blocks + optional blocks from active ancestors only
    deduplicate by sorted sourceRefs + normalized text hash
    estimateTokens(text) = UTF8 byteLength(text) + per-message safety overhead(32)
    inputBudget = model.contextWindow - outputReserve - 1024
    require required blocks + prompt/schema estimate <= inputBudget
    select required; then optional in priority DESC, id ASC if whole block fits
    if required does not fit: fail CONTEXT_TOO_LARGE; never silently truncate facts
    persist manifest and exact selected text/version refs; return manifest
```

UTF8字节数是保守预算代理，不是假称模型tokenizer精确结果；不同模型上下文能力要实测。调用仍可能收到超窗错误，此时失败并要求减小输入/换能力档案，不能继续截掉必要规则。API返回usage记录实际值；无usage标UNKNOWN。

### 7.3 生成和修订

```text
generateChapter(context):
    streamText('production.write',context)
    append delta to GenerationDraft; checkpoint every 1s
    require successful terminal finish reason, nonempty text, not truncated
    normalize text; append immutable ContentVersion(origin=GENERATED)
    freeze input hash; next stage EVALUATING

reviseBody(candidate,issues):
    require remaining bodyRepair budget
    include original candidate, exact issue evidence, current plan and same base facts
    call production.revise to output complete replacement text, not free-form patch
    require complete output; append ContentVersion(origin=REVISED,parent=candidate)
    invalidate this attempt's old Evaluation/Delta association
    run every evaluator in the frozen ResolvedPolicy again; discard old result associations
```

任何修改正文（包括标点）产生新候选并重审，不做“仅小改自动继承PASS”的特殊入口。生成中取消/截断保留GenerationDraft.complete=false，不凑出缺失尾段后提交。

## 8. Evaluation：审核和修复

### 8.1 公共结构与量表

```typescript
type EvaluatorDefinition = {id:Text,version:Text,title:Text,core:boolean,
  mode:'PROGRAM'|'MODEL'|'HYBRID',configSchemaId:Text,metricSchemaId:Text,
  inputSchemaId:Text,instructions:Text[]};
type EvaluationPolicy = {id:Text,version:Text,requiredEvaluatorIds:Text[],optionalEvaluatorIds:Text[],
  evaluatorVersions:Record<string,Text>,parameters:Record<string,Json>,skillConfigVersionIds:Id[]};
type Issue = {id:Id,evaluatorId:Text,severity:'BLOCKER'|'MAJOR'|'MINOR'|'INFO',
  ruleId:Text,message:Text,spans:Span[],relatedRefs:Ref[],suggestion:Text};
type EvaluatorResult = {evaluatorId:Text,evaluatorVersion:Text,
  executionStatus:'SUCCEEDED'|'ERROR',score:0|1|2|3|4|null,
  issues:Issue[],metrics:Record<string,number|null>,reason:Text,checkedConstraintIds:Id[],errorCode:Text|null};
type EvaluationResult = {contentVersionId:Id,baseSnapshotId:Id,planVersionId:Id,
  resolvedPolicyVersionId:Id,status:'PASS'|'FAIL',results:EvaluatorResult[],
  issues:Issue[],suggestions:Text[],metrics:Record<string,number|null>};
```

底层Evaluator ID是受注册表约束的字符串，不使用永久八维union。增加一个Evaluator只需代码注册实现/schema/测试，并在后台配置Policy或Skill绑定；数据库/API/通用前端按results数组处理，无需加列或改公共枚举。策略中同ID不得重复或同时位于required/optional，未知ID或版本不匹配禁止发布。

默认策略`default-long-novel-policy-v1`要求第8.2节八项，optional为空；其中`core.hard-constraints`和`core.state-consistency`永远在required中。Core不可关闭、转optional或放宽固定硬规则，独立Delta验证同样不可关闭。其余Evaluator可通过后台策略调整，普通作者页面只读。

通用量表：0文本不可用；1核心要求违背；2问题明确需修正；3达到要求；4充分达到要求。执行失败用executionStatus=ERROR、score=null，不伪造0分。每个必需Evaluator默认minPassScore=3，后台可在2～4内设置非Core的审美阈值；任何非INFO问题仍使必需Evaluator不通过，调分数不能消除已认定缺陷。PROGRAM可使用成功4/失败0，明确硬规则优先。

总状态只有PASS/FAIL，删除WARN。必需结果有BLOCKER/MAJOR/MINOR任一种或分数未达阈值→FAIL；只有INFO且达到阈值可PASS。optional只提供建议和诊断，失败/低分不阻断，修复默认不处理optional问题。明确归属Core.ruleId的违规必须由相应Core检查验证，不允许把Core事实检查隐藏为optional以绕过。

BLOCKER=结构/来源/状态不合法或硬约束违背；MAJOR=明显损害因果、人物或任务；MINOR=可定位的局部表达/连续性问题；INFO=没有明确缺陷的可选改进。程序映射的等级模型不得降低。

### 8.2 默认Policy的八项检查契约（非固定Schema）

| evaluatorId / 名称 | 程序检查 | 模型必须回答的问题；3分标准 |
| --- | --- | --- |
| chapter-quality / 章节质量 | 长度在0.8～1.2倍目标内；非空；无NUL | 本章推进、节拍、required hook成立 |
| continuity / 连续性 | 前章active祖先、引用有效 | 前章地点/行动/情绪衔接，时间跳跃交代 |
| core.hard-constraints / 计划执行及硬约束 | required约束ID全覆盖；required Promise动作、全局输入合法 | 逐must/avoid/Goal/硬Promise动作给证据；不把due软提示当义务 |
| logic / 逻辑 | 时间线/数量硬合法性委托Core保底 | 关键行动动机、原因先于结果、能力限制成立 |
| character-consistency / 人物一致性 | 角色引用，硬生死状态由Core保底 | 动机/对白变化有事件支撑，不禁止合理成长 |
| style / 风格 | 引号/对白比例；显式禁用词由Core保底 | 视角/语气/句式符合Style |
| repetition / 重复 | 下述连续片段与句子重复 | 重复信息、参考剧情组合照搬均须证据 |
| core.state-consistency / 状态一致性 | 状态引用、生命/物品/世界硬不变量、观察版本合法 | 客观当前事实与角色观察版本分开；角色不能无来源获知新变化 |

硬要求是must/avoid/Constraint.HARD，不因模型打3分而放行。软偏好不满足但无实质错误记INFO，不自动制造永远无法通过的MINOR。

重复规则：对normalize正文按`。！？!?\n`切句，去标点和空白后长度>=20的完全同句出现>=3次为MAJOR；候选与近5章或使用的参考例子存在连续相同>=80字符为MAJOR。引用豁免仅来自用户在ChapterPlan明确标记的`allowedQuotes[{text,sourceRef}]`，不能由模型自称引用。程序保留比对位置；远程全文检索不用于此硬检查。复杂剧情相似由模型报告MAJOR并引用双方片段，不以单个名字相同判抄袭。

Core同时承接schema合法性、显式长度/禁用词/required hook等硬要求，即使对应审美Evaluator被禁用也不能移除这些检查。默认可将required MODEL/HYBRID检查合并为一次`evaluation.run`调用，其期望ID集合由ResolvedPolicy生成，而不是写死8。optional单独运行/分组，不能让optional解析失败污染required响应。成功响应每个请求ID恰好1项，未知/重复/缺失按本次调用失败处理。

模型问题必须有有效Span；缺失事件可spans=[]但须引用约束。低于minPassScore且无非INFO问题时视为输出不完整，格式修复失败则executionStatus=ERROR。每个定义自己的metrics schema，通用UI按键值展示，不依赖固定维度图。INFO始终不作为自动修复触发器。

```text
resolvePolicy(policy,skillConfigs):
    validate definition versions, parameters and disjoint required/optional ID sets
    union active Skill evaluator bindings, keeping required when same ID declared twice
    force all registered Core IDs into required; reject any weakening request
    freeze full definition/config/policy versions as ResolvedPolicy

evaluate(candidate,base,plan,ResolvedPolicy):
    run every required evaluator; merge fixed and model issues by evaluatorId/ruleId/span/message
    if any required ERROR: persist attempt diagnostics; fail Job(EVALUATOR_ERROR)
    run optional evaluators; ERROR -> retain null score/error diagnostics, no fabricated result
    status = PASS iff every required result SUCCEEDED
                     and score>=its minPassScore
                     and it has no BLOCKER/MAJOR/MINOR
    else status = FAIL
    persist immutable EvaluationResult for exact candidate and resolved policy
```

必需检查服务超时/JSON不合法是Job失败，不补默认分数。optional每次正文候选最多2次实际HTTP请求（含格式修复/重试），且发出后必须为状态流水线保留至少12次任务HTTP余额；不满足则记ERROR/BUDGET_SKIPPED。optional按ID排序分组，沿用单请求超时，不能无限等待；12次是调度保留额而非成功保证，状态重试仍受总预算和修复次数限制。状态抽取后仍执行第6节Delta验证，检查变更忠实性与时间/认知语义，不被正文Policy替代。

### 8.3 修复分流

```text
on evaluation FAIL:
    if bodyRepair used < allowance: reviseBody; re-evaluate all
    else: FAILED(REPAIR_EXHAUSTED)
on Delta schema/reference/expected mismatch:
    if deltaRepair budget remains: call state.repair with exact errors, base and body
                                 reconstruct events/delta, simulate and validate again
    else: FAILED(STATE_REPAIR_EXHAUSTED)
on semantic contradiction in body:
    revise body within shared bodyRepair allowance; repeat evaluation+extraction
on immutable Canon conflict not repairable:
    WAITING_USER with candidate and violated rule
```

用户可以编辑候选或改未来计划后重新审核；修改hard规则必须形成新版本且从Context阶段重算。没有“忽略问题并强制PASS”入口。人工反馈属于新输入，不直接改旧Evaluation结果。

## 9. Orchestrator：执行、恢复与提交

### 9.1 Job、Attempt、Stage、Event

```typescript
type Job = {id:Id,projectId:Id|null,kind:Text,parentBatchId:Id|null,chapterId:Id|null,
  status:'QUEUED'|'RUNNING'|'PAUSED'|'WAITING_USER'|'FAILED'|'INTERRUPTED'|'CANCELLED'|'SUCCEEDED',
  stage:Text,inputRefs:Ref[],configSnapshotId:Id,chainEpoch:number|null,
  cancelRequested:boolean,pauseRequested:boolean,httpUsed:number,
  bodyRepairsUsed:number,deltaRepairsUsed:number,revision:Revision};
type JobAttempt = {id:Id,jobId:Id,number:number,stage:Text,inputHash:Hash,resolvedInputsId:Id,
  stageConfigOverrideId:Id|null,
  status:'RUNNING'|'SUCCEEDED'|'FAILED'|'INTERRUPTED'|'CANCELLED',
  outputRefs:Ref[],errorCode:Text|null,startedAt:Instant,endedAt:Instant|null};
type JobEvent = {id:Id,jobId:Id,seq:number,type:Text,payload:Json,createdAt:Instant};
```

Job是用户一次可恢复的业务命令；Attempt是某阶段的一次执行；Stage是明确的状态机节点；JobEvent是进度记录，不是小说StoryEvent。Run在API中仅是Job的显示名称，不另建重叠对象。HTTP请求重试属于Attempt内部，不增加章节版本，输出通过后才追加版本。

冻结分两层：Job.inputRefs是不可变CommandInput，记录启动时base/用户草稿/Book/知识绑定/配置/请求范围；尚未生成的ChapterPlan不假造引用。滚动规划产生后，为每阶段追加不可变ResolvedInputs`{id,jobId,stage,refs,hash}`，记录实际计划、Context与该阶段产物。下游只读ResolvedInputs，不能覆盖Job原输入。恢复同时检查CommandInput中的稳定依赖与阶段实际依赖；任务自身已成功发布的低层计划视为本链合法产物，不误判为外部改动。

Job.kind枚举`OPENING_PLAN|ROLLING_PLAN|WRITE_CHAPTER|AUDIT_DRAFT|REWRITE|REFERENCE_ANALYSIS|KNOWLEDGE_BUILD|BATCH|REINDEX|SUMMARIZE`。各类阶段：

- 章节/AUDIT：CONTEXT_BUILDING → WRITING（手稿跳过）→ EVALUATING ↔ REVISING → APPROVED → EXTRACTING_STATE_DELTA → VALIDATING_STATE → COMMITTING → COMPLETED。
- 规划：LOAD_INPUT → GENERATE → VALIDATE → SAVE → WAITING_USER或ACTIVATE → DONE。
- Reference：IMPORT_CHECK → SPLIT_CHECK → ANALYZE_UNITS → AGGREGATE → VALIDATE → PUBLISH → DONE。
- Knowledge：LOAD_REFERENCE → TRANSFORM → VALIDATE → SAVE → DONE；发布仍由用户明确命令。
- REINDEX：SELECT_ACTIVE → CHUNK → EMBED（未启用时跳过）→ STORE → DONE。
- SUMMARIZE：SELECT_ACTIVE → GENERATE → VALIDATE_REFERENCES → STORE → DONE；输出只写派生摘要，无权修改事实。
- BATCH：NEXT → CHILD_RUNNING → NEXT/DONE；遇子Job非SUCCEEDED暂停，不越过失败章。
- REWRITE先执行第11节失效事务，再使用章节流程；它不是另一个事实写入器。

非法阶段跳转返回409。Chapter状态仅用于生产进度，Job取消/暂停后不伪装COMPLETED；取消时chapter保留最后阶段，UI由Job状态覆盖展示。FAILED保留failedStage与产物。

### 9.2 互斥与启动

单服务进程通过本地独占锁文件保护data目录：使用操作系统排他创建，记录PID、进程启动时间与随机nonce；已存在时仅在确认PID/启动时间对应进程不再存在后原子清理重建，无法确认则拒绝启动。锁保护整个服务生命周期，不按LLM超时抢占。Windows监听端口冲突同样拒绝启动，不自动换目录或端口。

数据库ActiveProjectCommand(projectId唯一,jobId)保护小说所有影响输入的命令；暂停/失败后释放，恢复重新验证。BATCH运行期间由父Job持有，子Job通过ownerJobId继承，不能自己抢另一把锁。同一小说的其他生产/计划启用/绑定修改/重写/删除拒绝409；工作草稿可以保存。

统一释放规则：叶子Job进入PAUSED、WAITING_USER、FAILED、INTERRUPTED、CANCELLED时，在同一事务更新状态并释放独立锁；若属于BATCH，则父Job转PAUSED并释放父锁（用户取消整个批次时父转CANCELLED）。因此WAITING_USER允许用户修改解困输入。恢复BATCH先重获父锁并校验当前子Job，只恢复未完成当章，成功后才调度下一章；不得生成跳过失败章的新子任务。

```text
startCommand(request,idempotencyKey):
    hash = canonicalJSON(command payload)
    transaction:
        existing = CommandReceipt(scope,key)
        if exists: require same hash; return existing result
        require expectedRevision matches and no active conflicting owner
        require chapter == head+1 and headSnapshot valid, if chapter command
        create QUEUED Job with fixed inputRefs/config/chainEpoch
        insert ActiveProjectCommand if needed; insert CommandReceipt
    return 202 {jobId}
```

队列按createdAt/id FIFO；同一时间仅Worker执行一个叶子Job阶段。BATCH调度不占模型槽，子Job继承占用，避免父等子而死锁。无项目的参考任务也经过同一队列，但不锁任意小说。

### 9.3 章节总流程

```text
writeNext(job):
    verify project lock owner, chainEpoch, head+1
    ensureRollingPlans under same owner; freeze actual plan/config/base refs
    context = buildContext(chapter)
    candidate = frozen manual draft OR generateChapter(context)
    loop:
        evaluation = evaluate(candidate,...)
        if PASS: break
        candidate = reviseBody(candidate,evaluation.issues) within limit
    mark APPROVED (candidate only, not active)
    events = model(state.extract, candidate + selected base facts)
    validate spans; map temporary IDs; construct Delta
    simulation = simulateDelta(base,delta)
    semantic = model(state.validate,...)
    process validation failures according to 8.3
    atomicCommit(job,candidate,evaluation,events,delta,simulation,semantic)
```

PRD的“Commit Content”解释为持久化不可变候选，不提前设置active。所有长调用在事务外；外部副作用只有模型费用，不能回滚，必须记录。

### 9.4 唯一最终提交

```text
atomicCommit(job,C,E,events,D,S,V):
    prepare logical Snapshot metadata, canonical stateHash and checkpoint when chapterNo%20==0
    // serialization/compression outside transaction; all prepared data belongs to frozen inputs
    transaction:
        if CommitReceipt(job.id) exists: return recorded completion
        require active command owner matches job or parent batch
        require job.cancelRequested==false
        require project.chainEpoch==job.chainEpoch
        require project.headSnapshotId==D.baseSnapshotId
        require chapter.order==project.headChapter+1
        require C.id==E.contentVersionId==D.contentVersionId
        require E.status==PASS and E.resolvedPolicyVersionId==job.frozenPolicyVersionId
        recompute PASS from frozen required Evaluator IDs/versions/results, including both Core
        require V all PASS and no missing changes
        require ResolvedInputs hashes and CommandInput stable dependencies match artifacts
        insert validated StoryEvents, immutable PropositionVersions, DeltaVersion
        insert logical Snapshot(parent=base,deltaVersionId,stateValidationVersionId,stateHash)
        insert prepared PhysicalCheckpoint if required; failure rolls back whole commit
        set chapter.activeContentVersionId=C.id; chapter.status=COMPLETED
        advance project.headChapter/headSnapshotId; increment revision
        persist CompletionEvent + CommitReceipt(job.id unique)
        persist PlanningRecheckDue(projectId,newSnapshotId) unique
        persist Outbox(INDEX_CONTENT,contentVersionId) unique
        mark job SUCCEEDED; release leaf lock unless parent batch owns it
    return completion
```

Snapshot/事件是联合提交时才进入权威链，抽取阶段保存的是私有候选产物。任何数据库写失败都回滚，旧head仍有效。CommitReceipt先检查保证“成功响应丢失后重试”不会因head已前移误报失败；仍须校验receipt属于该命令身份。

PlanningRecheckDue是必执行的规划检查标记，不是可丢失索引。下一章ensureRollingPlans必须先消费当前head及其祖先的未处理标记：重查假设、生成软期限信号、更新计划有效性，然后才允许冻结输入。检查结果与标记完成同事务保存；崩溃重跑以(snapshotId,assumptionId/scheduleVersionId)去重。当前章提交不因后续规划服务失败撤销。重写时旧支线标记失效，仅消费当前链；索引Outbox不承担此门禁。

Job冻结SkillConfig版本、SkillDefinition版本、ResolvedEvaluationPolicy、模型与Prompt配置；正文修复及重试继续使用这些版本。后台修改只影响后续新Job，不能改变在途PASS含义。缺少被冻结的代码实现版本时恢复报CONFIG_VERSION_UNAVAILABLE，不静默换新实现。恢复读head调用loadSnapshot，哈希损坏报STATE_CORRUPTED。

### 9.5 暂停、取消、恢复

- 暂停：持久化pauseRequested，当前原子阶段完成后停；BATCH当前章成功后停止，不启动下章。PAUSED保留产物并释放锁。
- 取消：事务写cancelRequested，向当前HTTP传AbortSignal；取消和提交以数据库写事务顺序裁决。取消先写入则提交拒绝；提交先成功则返回SUCCEEDED，不撤销事实。
- 意外退出：启动时将遗留RUNNING/QUEUED受旧进程持有任务标INTERRUPTED并清理对应活动锁，不自动发模型请求；正常新QUEUED由新进程创建后执行。
- 恢复：用户调用retry，重新获得锁；相同输入hash与仍在active祖先链上的依赖才能复用SUCCEEDED阶段。已完成候选可从EVALUATING/抽取恢复；不完整流从WRITING新attempt开始，不能接拼旧流。
- 依赖改变：返回STALE_INPUT，用户点击“用当前输入重新开始”创建新Job；旧Job保留，不伪造同一次执行。
- 普通重试不重置计数。仅PAUSED/FAILED/INTERRUPTED/已满足条件的WAITING_USER可RESUME，清除pauseRequested并重新校验预算与依赖；CANCELLED/SUCCEEDED禁止retry，取消后只能创建新命令。
- 换模型使用`POST /jobs/:id/restart-stage`，输入`{expectedRevision,stage,modelConfigVersionId}`，只接受上述可恢复状态且尚未提交的Job。追加不可变StageConfigOverride与新Attempt，原ConfigSnapshot和计数保留；该阶段及下游产物关联失效但历史不删除。StageConfigOverride只影响指定阶段及其同类修复调用，后续其他角色仍用原ConfigSnapshot。现有RetryRequest.RESTART_STAGE是同一用例别名，不允许实现不同语义。
- WAITING_USER可修改允许的未来计划/工作草稿；改变输入后必须新Job。单纯增加预算可在原Job恢复。

阶段事件与状态写在同事务中。Outbox只更新索引等派生数据，失败记录重试次数并指数退避，最多3次后显示“索引待重建”；绝不重新提交小说事实。

Outbox成功消费后创建幂等REINDEX/SUMMARIZE Job（默认各最多10次HTTP），实际模型调用仍经全局Worker与预算计数。此类派生Job不持有ActiveProjectCommand，不阻止用户改计划；每次读取/落盘前校验sourceVersion仍在active链，已失效则停止且不发布派生结果。

## 10. Platform：模型、检索与基础设施

### 10.1 ChatAnyWhere 配置与契约

服务端使用`openai` JavaScript SDK，baseURL默认`https://api.chatanywhere.tech/v1`；可显式使用官方`.org`，不自动换线路/供应商。密钥仅来自`CHATANYWHERE_API_KEY`环境变量，UI只显示configured布尔值。模型名称在设置页手工填写，可辅助拉取模型列表，失败保留手填。

```typescript
type ModelProfile = {id:Id,modelName:Text,contextWindow:number,maxOutput:number,
  outputTokenField:'max_tokens'|'max_completion_tokens',
  supportsTemperature:boolean,structuredMode:'JSON_SCHEMA'|'JSON_OBJECT'|'TEXT_JSON',
  streaming:boolean,embeddingDimensions:number|null,revision:Revision};
type RoleModels = {planner:Id,writer:Id,reviewer:Id,extractor:Id,repairer:Id,embedding:Id|null};
type ModelCall = {promptId:Text,promptVersion:Text,role:Text,input:Json,
  schemaId:Text|null,contextRefs:Ref[],outputLimit:number,signal:AbortSignal};
type ModelResult = {text:Text,json:Json|null,finishReason:Text,
  usage:{input:number|null,output:number|null},requestId:Text|null};
```

默认所有角色可绑定同一个用户填写模型；不猜有效model ID。模型能力档案由用户按实际服务填写并执行独立连通测试；未完成配置仅禁用模型任务，不阻止编辑/导出。outputLimit默认writer/repairer=8192、planner/extractor=8192、reviewer=4096，实际取min(profile.maxOutput,roleLimit)，预算无法容纳则显式失败。

不假定temperature可用：能力为true才发送，默认writer=0.8、planner=0.6、其余=0.2。JSON_SCHEMA模式发送schema；JSON_OBJECT/TEXT_JSON通过Prompt明确结构并Zod验证。能力与协议由实际请求验证，未验证不声称兼容。Embedding独立验证维度，不用聊天模型代替。

```text
callModel(call):
    require valid configured profile + credential; build explicit messages
    reserve one actual HTTP send in Job counter transaction before sending
    fail BUDGET_EXHAUSTED if limit reached
    SDK retries=0; enforce total/idle timers and AbortSignal
    on 429/network/5xx: max2 extra sends, wait Retry-After or min(2^attempt,30)s
                        Retry-After>300s => PAUSED
    on 401/403/invalid model/invalid parameter: no retry
    on stream partial/interrupted: store incomplete draft; no automatic append/retry
    require terminal success reason, not length/refusal/empty
    structured schema invalid: one extra repair call with errors+original result
    repair still invalid => FAILED(MODEL_SCHEMA_ERROR), no invented default values
    record usage when present; absent => null; return result
```

计数发送前预留，进程在发送前崩溃可能多计一次，允许保守多计而不少计；记录RESERVED/STARTED/FINISHED/UNKNOWN，不将请求状态UNKNOWN当成功。没有可靠单价就不显示费用数值；只显示已知token与调用数。

### 10.2 Prompt 资产与模型任务字典

Prompt是代码显式注册的`{id,version,role,inputSchemaId,outputSchemaId,instructions}`，版本变更必须新version；禁止在路由临时拼system prompt。统一封装系统规则、任务目标、输入数据、输出schema，参考作品和正文放入带来源标签的数据区，不能作为系统指令执行。

| Prompt ID | 输入 | 输出与必要指令 |
| --- | --- | --- |
| reference.chapter | AnalysisUnit正文、固定Registry版本的有界候选 | 第3节数组及实体匹配；引用片段，不补未来章节 |
| reference.aggregate | <=8份子摘要及来源IDs | 同结构合并摘要、冲突列表；只引用已有来源 |
| knowledge.framework | 完整ReferenceModel结构摘要 | Framework；保留功能与出处，不生成项目事实 |
| knowledge.assets | ReferenceModel实体/概念 | RawPack；只抽取有来源素材 |
| knowledge.adapt | CleanPack+brief | AdaptedPack+全量映射与changes |
| planning.book | Project+Knowledge | BookPlan+InitialCanonCandidate；未来与初始事实分开 |
| planning.volume/arc/chapter | 父计划+base事实+Knowledge+PlanningSignals | 对应第5节schema及假设；覆盖范围，满足硬约束 |
| planning.review-assumptions | 旧计划+假设检查+当前事实+软期限信号 | KEEP的新假设/理由或REPLAN；硬失效不得KEEP |
| planning.validate | 计划+父级+base+应用来源 | violations/uncertain；逐约束核对 |
| production.write | ContextManifest | 完整正文；不附解释或Markdown围栏 |
| production.revise | 原候选+Issue+固定Context | 完整修订正文；修复问题且保留已满足硬约束 |
| evaluation.run | 正文+Context+冻结Policy指定的Evaluator schemas/量表 | 按指定ID返回通用results；required缺项失败 |
| state.extract | 正文+相关base | StoryEvents、Changes；区分事实与主张 |
| state.validate | 正文+base+Delta+模拟结果 | 第6节checks/missingChanges；不修改状态 |
| state.repair | 原抽取+错误+正文+base | 新事件/Delta提案；不能改正文来伪造证据 |
| memory.summarize | active正文及已提交事件 | <=800字符摘要、entityIds、eventIds；不增加新事实 |

测试用FakeModel按promptId返回固定schema样本；生产不能fallback到FakeModel。模型自报confidence只作诊断，不单独作为放行条件。

### 10.3 RAG、Embedding、Vector Store、Cache

RAG为先检索历史片段再组装上下文的机制，不是业务域。检索只能使用当前有效链、章号<N的ContentVersion；参考内容必须以独立来源标签进入，不与事实混合。

```text
indexActiveContent(version):
    normalize text; split <=800 code points with100 overlap, paragraph preferred
    store Chunk(id,contentVersionId,chapterNo,start,end,text,hash)
    lexical tokens = adjacent Chinese Han bigrams + lowercase ASCII word runs
    count term frequency and document length
    optional embeddings via configured ChatAnyWhere profile; store model/version/dimension

retrieve(query,N,activeChain):
    filter chunks by activeChain and chapterNo<N BEFORE ranking
    query = chapter title + expectedEvents + cast names + required promises
    lexical score = BM25(k1=1.2,b=0.75) over token counts
    if embeddings enabled and query vector available: cosine rank with same model/dimension
    combine available ranks: sum(1/(60+rank))  // ranks start at1
    take top8, tie by chapterNo DESC then chunkId; deduplicate overlapping same-source spans
```

BM25的IDF为`ln(1+(docCount-docFreq+0.5)/(docFreq+0.5))`，每词贡献`idf * tf*(k1+1)/(tf+k1*(1-b+b*docLength/avgLength))`；空索引返回[]。无匹配文本不强塞0分结果。向量维度/模型不一致不混排，显示待重建；Embedding失败降级为文本检索并记录原因，不换供应商。重写失效以active链过滤立即生效，不等待删除旧向量。

Vector Store为SQLite的ChunkEmbedding表，Float32 BLOB保存，小规模在内存余弦计算；每次只加载当前项目有效数据，超过性能目标再优化，首版不部署外部服务。Cache是可丢失的派生结果缓存，key包含内容hash/Prompt版本/模型配置hash；旧正文和状态版本不是缓存。

每章提交后可异步生成摘要；摘要只能引用已提交事件，用于压缩检索，不更新Story State。摘要未就绪可用已有正文块，不能阻塞正式事实提交；required事实永远不以摘要替代。

### 10.4 日志与存储

Storage负责原始文件、规范化文本、导出、备份；路径由服务端Id生成，不拼接用户文件名。Database保存权威元数据/正文/状态，Queue是Job表，Worker是同进程调度循环，Observability是结构化日志+JobEvent+用量统计。

日志字段time/level/requestId/jobId/attemptId/stage/errorCode/duration；密钥、完整Prompt和正文默认不入日志。ContextManifest作为项目私有诊断产物可查看，用于可追溯，不对公网提供。保留所有当前项目阶段记录，删除项目时一并处理，不无限堆全局调试日志；日志按日滚动保留7天。

## 11. 历史重写、删除、导出与备份

### 11.1 重写和后续失效

```typescript
type RewriteRequest = {fromChapter:ChapterNo,expectedRevision:Revision,
  expectedHeadSnapshotId:Id,confirmedAffectedContentVersionIds:Id[],
  mode:'USE_DRAFT'|'REGENERATE'|'REVALIDATE_OLD',draftRevision:number|null};
```

重写预览GET返回从N到head的active版本列表和总章数；执行请求必须回传准确列表，防止预览后head变化。USE_DRAFT用工作草稿，REGENERATE重生成，REVALIDATE_OLD保留旧正文但重新审核/抽取。无并列故事分支UI。

```text
beginRewrite(req):
    require no active command; 1<=N<=head
    transaction:
        verify project.revision/head and affected list
        save RewriteRecord(oldHead, affected active versions, mode)
        set project.head to ancestor snapshot at N-1
        increment chainEpoch and revision; project.status=WRITING
        clear Chapter.activeContentVersionId for order>=N; mark STALE
        mark future plans based on removed chain stale
        create rewrite Job and lock owner; no model call in transaction
    run chapter N with new base; process subsequent chapters only one by one
```

失败后head停在当前成功位置，旧版本可读不消失。后文不能仅凭文本没改就恢复active。恢复原版本也必须从head+1逐章重新审核和提交，不直接切回一串未验证指针。修改Canon等同从1重写，并使用新确认Canon创建State 0；保留旧State 0。

普通“修订已完成章节”按钮调用同一流程，不另设绕过失效的保存接口。批量重写每次最多10章；可多批继续。单章节正文审核失败不能前进到N+1。

### 11.2 项目完结、归档与删除

达到targetChapterCount仅显示“达到规划目标”，不自动FINISHED。用户点击完结后要求无活动任务、head>=1、无active章节断档、无required未解决Book目标和显式最终兑现义务；否则返回具体阻断项。最终兑现义务定义为BookPlan.requiredFinalPromiseIds中的Promise必须RESOLVED，ABANDONED不算兑现；默认空数组。已到软期限但没有显式义务的Promise只展示提醒，不阻断完结。允许用户先修订Book目标范围或正文，不提供强行完结绕过检查。完结后新写作需“继续创作”，状态WRITING并扩展目标范围版本。

ARCHIVED仅隐藏项目，不改历史。删除默认软删除：Project.deletedAt写时间、禁用任务与查询、隐藏数据；UI可在回收站恢复。明确“永久删除”才清除项目元数据与私有文件；需无活动任务，显示名称确认，先事务标记DELETING/清除数据库引用，再用持久化清理待办删除本项目目录，失败可重试。跨项目共享Knowledge/Reference不随项目删除；被其他项目引用时不能删版本。目录删除必须验证解析后位于本项目存储根内。

### 11.3 导出

首版TXT和Markdown：只导出active COMPLETED正文，按order升序，含标题与章节标题，UTF-8无BOM、LF换行。未完成草稿可单独导出，文件名明确draft，不混入正式整书。导出任务固定active版本列表，生成期间head变化也不改变本次输出。Markdown对标题字符转义，正文保留普通文本，不转HTML。

EPUB导出、复杂排版、云同步不属于首版范围；参考EPUB导入仍在范围内。

### 11.4 备份恢复

```text
backup():
    stop accepting new jobs; wait current stage boundary, pause jobs
    close database connections; copy database + sources + normalized texts + manifest
    hash every copied file; rename backup temp directory to success name atomically
    reopen database/worker; retain latest5 successful backups
restore(backup):
    require maintenance mode and no active requests/jobs
    verify hashes, schemaVersion and all referenced files
    create pre-restore backup; restore into temporary data directory
    migrate only supported older schema; reject newer schema
    validate database foreign keys; atomically switch data directory; restart service
```

不复制运行中的单个SQLite文件而遗漏WAL。索引是可重建的，可不备份；备份manifest明确是否包含。恢复后遗留任务INTERRUPTED，不自动调用模型。旧项目归档不作为V2备份导入源。

## 12. API 与 Web 操作细则

### 12.1 HTTP 公共契约

前缀`/api/v1`，成功`{data:T,requestId}`，失败`{error:{code,message,details?},requestId}`。HTTP 201创建资源，202接受Job，200读取/更新，204删除成功；400协议错误、404不存在、409版本/执行冲突、413体积超限、422业务校验、503模型或服务不可用。422与409不自动重试。

新增长任务与具有破坏影响的命令带`Idempotency-Key`（客户端UUID）；相同scope/key/请求hash返回同一结果，hash不同409。可变资源PATCH带expectedRevision；所有ID服务端生成。列表采用`cursor=id&limit`，默认20、最大100，按createdAt/id稳定排序，响应`{items,nextCursor}`。

```typescript
type WriteRequest = {expectedRevision:Revision,mode:'GENERATE'|'AUDIT_DRAFT',
  draftRevision:number|null,count:number}; // count=1..10，AUDIT_DRAFT固定1
type RetryRequest = {expectedRevision:Revision,action:'RESUME'|'RESTART_STAGE',
  stage:Text|null,modelConfigVersionId:Id|null}; // RESUME后二者null；RESTART_STAGE后二者必填
type BudgetRequest = {expectedRevision:Revision,httpLimit:number,
  bodyRepairLimit:number,deltaRepairLimit:number}; // 不可小于已用量
```

| Method + Path | 输入 | 输出/业务动作 |
| --- | --- | --- |
| GET `/health` | 无 | `{ready,schemaVersion}`；不返回配置细节 |
| GET/POST `/projects` | POST: title?,idea,genre,requirements,targetCount,targetLength | Project列表 / 创建DRAFT |
| GET/PATCH `/projects/:id` | PATCH: expectedRevision及标题/软偏好 | Project；写入影响创作要求时新配置版本，后续计划stale |
| POST `/projects/:id/opening-plans` | expectedRevision | OPENING_PLAN Job |
| POST `/projects/:id/opening-confirmations` | bookVersionId,canonCandidateVersionId,expectedRevision | 启用Book与State 0；第5节事务 |
| POST `/projects/:id/opening-candidates` | typed BookPlan、InitialCanonCandidate、expectedRevision | 保存成对人工修改候选；不启用；确认仍走opening-confirmations |
| GET/POST `/projects/:id/plans` | POST: level,parentVersionId,range,expectedRevision | 计划版本列表 / 规划Job |
| POST `/projects/:id/plan-versions` | typed payload、dependencies、expectedRevision | 校验后追加人工计划候选，不自动启用 |
| PUT `/projects/:id/plan-siblings` | level,parentVersionId,完整同层payload列表,expectedRevision | 一次校验范围并追加版本列表，保持无重叠/缺口 |
| POST `/projects/:id/plans/:versionId/activate` | expectedRevision | 经规划校验的启用结果 |
| GET `/projects/:id/chapters` | cursor,limit | 章节、active状态、对应Job状态 |
| GET/PUT `/projects/:id/chapters/:chapterId/draft` | PUT: text,expectedRevision | WorkingDraft；CAS保存，无模型调用 |
| POST `/projects/:id/production-runs` | WriteRequest | 章节/BATCH Job；只从head+1开始 |
| GET `/projects/:id/chapters/:chapterId/versions` | cursor,limit | 只读正文版本及审核引用 |
| GET `/projects/:id/story-state` | snapshotId可选 | 当前/指定本项目Snapshot与来源 |
| GET `/projects/:id/rewrites/preview` | fromChapter | 影响范围与head版本 |
| POST `/projects/:id/rewrites` | RewriteRequest | 原子失效后REWRITE Job |
| POST `/projects/:id/finish`、`/reopen` | expectedRevision | 第11节完结或继续 |
| POST `/projects/:id/exports` | format:TXT/MD,scope:ACTIVE/DRAFT,chapterId? | 固定版本文件下载链接 |
| DELETE `/projects/:id` | expectedRevision | 软删除；永久删除单独`POST /purge`确认 |
| GET `/jobs/:id` | 无 | Job、lastArtifact、allowedActions、预算、generationSnapshot、lastEventSeq |
| GET `/jobs/:id/events` | Last-Event-ID可选 | SSE事件流 |
| POST `/jobs/:id/pause`、`/cancel` | expectedRevision | 幂等控制请求结果 |
| POST `/jobs/:id/retry` | RetryRequest | 原Job新Attempt或明确STALE_INPUT |
| POST `/jobs/:id/restart-stage` | expectedRevision,stage,modelConfigVersionId | 第9.5节StageConfigOverride与新Attempt |
| PATCH `/jobs/:id/budget` | BudgetRequest | BudgetAmendment |
| POST `/references` | multipart file,title?,encoding? | Source与切分预览 |
| PUT `/references/:id/split` | chapters的边界,title,expectedRevision | 新splitVersion，需发布 |
| POST `/references/:id/analyze` | splitVersionId,expectedRevision | REFERENCE_ANALYSIS Job |
| GET `/references/:id` | 无 | Source、覆盖度、错误单元、模型版本 |
| POST `/knowledge` | kind,title,sourceVersionId?,payload? | 手工Style/Template或转换Job |
| POST `/knowledge/:id/versions` | payload,dependencies,expectedRevision | 新版本；不自动发布 |
| POST `/knowledge/:id/publish` | versionId,expectedRevision | 满足第4节发布条件才发布 |
| PUT `/projects/:id/knowledge-bindings` | bindings完整列表,expectedRevision | 验证组合后原子替换，未来计划stale |
| GET/PUT `/settings/models` | PUT: profiles,roleMappings,expectedRevision | 非敏感模型配置；不返回Key |
| POST `/settings/models/:id/test` | 无 | 独立实际连通测试，显示会调用模型 |
| POST `/maintenance/backups`、`/restores` | restore:backupId | 维护操作结果，按11.4 |
| POST `/admin/session`、DELETE `/admin/session` | POST:{token}；DELETE无 | 恒定时间比对环境Token，创建/撤销管理员会话；失败401 |
| GET `/admin/skill-definitions`、`/admin/evaluator-definitions` | 无 | 已注册ID、版本、参数schema、Core标志，只读 |
| GET `/admin/skills`、GET `/admin/skills/:id/versions` | 无 | 活动配置及不可变版本历史 |
| POST `/admin/skills/:id/versions` | definitionVersion,enabled,priority,config,applicable,expectedRevision | 验证后追加配置并CAS启用；回滚用历史payload创建新版本 |
| GET `/admin/evaluation-policies`、GET `/admin/evaluation-policies/:id/versions` | 无 | 策略及历史版本；返回完整required/optional和参数 |
| POST `/admin/evaluation-policies/:id/versions` | 第8节Policy payload,expectedRevision | 校验注册版本、Core、参数后追加并CAS启用；回滚同样追加版本 |

发布切分、知识清洗/改编分别使用`POST /references/:id/split/:versionId/publish`、`POST /knowledge/:id/clean`、`POST /knowledge/:id/adapt`；输入sourceVersionId、adaptationBrief（改编必填）、expectedRevision，输出版本或Job。知识和参考列表提供同公共分页的GET `/knowledge`、`/references`；详情GET；归档POST `/archive`。回收站GET `/projects?deleted=true`，恢复POST `/projects/:id/restore`。结构化payload完全使用第3～6节schema，不接受任意未知字段。

参考实体整理使用`POST /references/:id/entity-resolutions`，输入`{analysisVersionId,decisions:[{candidateId,action:MERGE|KEEP_SEPARATE,targetEntityId?}],expectedRevision}`；MERGE只允许同类型并重映射所有来源引用，KEEP_SEPARATE保留ID，追加新解析版本，完整验证后发布。未来实体编辑使用`POST /projects/:id/planned-entities/versions`，输入PlanEntity payload/dependencies/expectedRevision，保持其Planning候选身份，不写StoryState。

错误码至少覆盖`REVISION_CONFLICT|ACTIVE_COMMAND|STALE_INPUT|INVALID_TRANSITION|INVALID_REFERENCE|CONTEXT_TOO_LARGE|MODEL_CONFIG_REQUIRED|MODEL_SCHEMA_ERROR|MODEL_UNAVAILABLE|BUDGET_EXHAUSTED|REPAIR_EXHAUSTED|STATE_VALIDATION_FAILED|UNSUPPORTED_STATE_FIELD|IMPORT_LIMIT|CANCELLED`。每个错误返回可操作信息，不返回堆栈/密钥。Job本身已创建后的业务失败通过Job状态表达，不能将SSE HTTP状态伪装成同步请求失败。

### 12.2 SSE 与页面恢复

SSE使用`id: jobId:seq`、`event: stage|artifact|progress|error|done|token|heartbeat`、`data: JSON`。stage/artifact/progress/error/done写JobEvent并按seq递增；token/heartbeat为临时消息不带可重放ID，心跳15秒。Last-Event-ID只重放该Job大于seq的持久事件，再订阅实时流。

GET Job的generationSnapshot为`{attemptId,text,complete,codePointLength}`或null，lastEventSeq与快照在同一数据库读事务获取。前端先读取快照再接SSE，不要求逐token重放；token为`{attemptId,offset,text}`，offset是原始流code point起点，只接当前attempt并丢弃重叠部分，缺口则重取快照。原始GenerationDraft不做改变offset的normalize，只有冻结ContentVersion时规范化。artifact/done事件强制重新读取最终候选，即使快照到订阅间漏了末尾token也能收敛。解析器跨块缓存半行/事件、空行才完成事件，UTF-8流式解码，不能每个chunk重置。

关闭页面不取消任务；取消必须调用cancel。SSE异常展示“连接中断，任务状态待刷新”，不直接显示任务FAILED。自动重连1/2/4/8/15秒，最多持续2分钟后只显示手动重连，不重复创建Job。

### 12.3 页面与可用性

| 页面/动作 | 默认交互 | 不能做什么 |
| --- | --- | --- |
| 我的小说 | 列表、新建、继续、归档、回收站 | 不凭字数推断完成 |
| 开书方案 | 左创作要求、右Book与初始事实，确认后进入工作区 | 不把模型初始候选直接当事实 |
| 规划 | Book/Volume/Arc/Chapter树，查看版本、编辑工作草稿、发布 | 不直接改active JSON |
| 写作 | 左章目录，中正文，右侧栏默认折叠，主动作按服务端allowedActions | 不同时展示多个相互矛盾的生成按钮 |
| 质量侧栏 | 冻结Policy下的动态Evaluator列表、required/optional、问题位置、修复结果 | PASS/FAIL与执行错误分开显示，不提供强行通过 |
| 故事状态 | 实体/命题/认知/Promise列表，历史快照与来源定位 | 默认只读，不直接修改当前事实 |
| 参考与知识 | 导入进度、失败单元、实体整理、框架/资产版本 | 不把PARTIAL显示成完成 |
| 模型设置 | 模型名、角色映射、能力档案、Key已配置状态 | 不在浏览器保存/显示真实Key |

布局默认白底，正文16px/1.9行高、最大760px宽；边框浅灰、主文字深灰、一个蓝色强调色。>=1200px三栏（目录220px、辅助320px）；768～1199px辅助抽屉；<768px目录/辅助均抽屉。弹窗有标题、初始焦点、Esc关闭与返回焦点；按钮不嵌套按钮，键盘可操作。

自动保存1秒防抖，状态为DIRTY/SAVING/SAVED/ERROR；切章有DIRTY时等待保存，失败弹“重试/留在本章/导出草稿后离开”，不静默丢输入。409保留本地文本，提供“下载本地副本”或“加载服务器版本”，不创建第二份服务器WorkingDraft；用户明确选择替换时必须带最新revision，不自动合并。生成正文显示独立预览，点击采用才填入工作草稿；生成任务内部候选提交不依赖编辑器内容。

## 13. 数据库、工程目录与约束

### 13.1 技术基线

采用TECHNICAL_PLAN的Node24、TS5.9、pnpm10、React19、Vite7、Router7、Tailwind3、TipTap2、TanStackQuery5、Express5、Zod4、Prisma7/SQLite、openai SDK、Vitest/Playwright。P1选择这些主版本内兼容补丁并生成全新lockfile；不复制旧依赖。原生模块安装/迁移/构建须在Windows验证，不能声称旧项目能运行就等于新基线能运行。

只绑定127.0.0.1，生产7456，开发前端7457、后端7456，Vite代理/api；生产Express托管静态文件。默认无登录，拒绝不匹配Host及跨站Origin写入；无Origin写请求仅接受带应用启动时生成会话令牌的本机客户端，令牌由同源初始化接口下发、不写日志。开放公网不属于本设计。

### 13.2 数据表与唯一约束

| 表组 | 关键列/约束 |
| --- | --- |
| Project / Chapter | Project含revision/chainEpoch/head；Chapter唯一(projectId,order) |
| WorkingDraft / GenerationDraft | 前者唯一chapterId并有revision，后者唯一attemptId |
| ContentVersion / PlanVersion / KnowledgeVersion / ReferenceModelVersion | UUID主键，唯一(objectId,versionNo)，payload与hash不可改 |
| Publication / ObjectPointer | Publication唯一versionId；Pointer带revision；正式指针只事务改 |
| StoryEvent / DeltaVersion / Snapshot / PhysicalCheckpoint | Snapshot父链/Delta/校验版本FK；Checkpoint唯一snapshotId；不逐章存全量State |
| PropositionVersion | 不可变；propositionId、有效/记录事件、supersedes/corrects版本FK；知识引用具体版本 |
| PlanDependency / PlanAssumptionCheck / PlanReview / PlanningRecheckDue | 反向索引(collection,key,field)；检查绑定planVersionId/snapshotId；重查标记持久化 |
| PromiseSchedule / PlanningSignal | 规划版本；信号唯一(snapshotId,scheduleVersionId,type)，不进入事实State |
| SkillConfig / SkillConfigPointer / EvaluationPolicy / ResolvedEvaluationPolicy | 版本不可变、活动指针CAS；Definition由代码注册；Job冻结解析后的Policy |
| EvaluationRun / StateValidationRun | 输入版本与policy/model配置固定；仅追加结果 |
| Job / JobAttempt / JobEvent | Attempt唯一(jobId,number)，Event唯一(jobId,seq) |
| ActiveProjectCommand | projectId唯一，ownerJobId指向父或单Job |
| CommandReceipt / CommitReceipt | scope+idempotencyKey唯一；CommitReceipt.jobId唯一 |
| Outbox | type+sourceVersionId唯一，含attempts/nextRunAt/status |
| ReferenceSource / SplitVersion / AnalysisUnitResult | 原文hash索引；单元结果唯一(inputHash,modelConfigHash,promptVersion) |
| ReferenceEntityRecord / ReferenceEntityMention / ReferenceEntityRegistryVersion / RegistryRetrieval | source/split隔离；版本化变更与重定向；结果inputHash包含Registry版本和候选hash |
| KnowledgeBinding / ModelProfile / ConfigSnapshot | 绑定固定versionId；ConfigSnapshot不可覆盖 |
| PlannedEntityVersion / CanonVersion / InitialEvent / GoalFulfillment | 未来候选与初始事实分表；GoalFulfillment绑定active内容证据 |
| ResolvedInputs / StageConfigOverride | 阶段实际输入和模型覆盖记录不可变，不覆盖Job原配置 |
| Chunk / ChunkTerm / ChunkEmbedding / Summary | 全部带contentVersionId；Embedding包含模型/维度 |
| BudgetAmendment / RewriteRecord / CleanupTask | 记录额度变更、失效范围与可恢复文件清理 |

所有JSON用领域Zod schema读写验证并标schemaVersion；身份、关联、章序、状态、哈希、时间使用关系列索引。禁止通过JSON全文搜索替代引用完整性。涉及跨表无法FK表达的约束在事务内校验并有集成测试。实际表名可以与类型对应，但不能重新引入一个Novel大JSON承载所有域。

SQLite启用foreign_keys、WAL、busy_timeout=5000；提交事务不调用模型、不做文件复制。数据库用Prisma migration从空库建立；生产只应用受版本控制migration，禁止运行时db push/模板补列。

### 13.3 目录和模块边界

```text
apps/web/src/{app,pages,features,components/ui,styles}
apps/server/src/{main.ts,http.ts}
apps/server/src/reference/      # 导入、切分、分析与模型发布
apps/server/src/knowledge/      # framework、asset、style、template、skill
apps/server/src/planning/       # 开书、四级计划、滚动与约束
apps/server/src/production/     # context、generation、revision、commit
apps/server/src/story-state/    # 类型、事件、delta、snapshot、验证
apps/server/src/evaluation/     # 规则、量表、结果汇总
apps/server/src/orchestrator/   # 用例、Job阶段、恢复与互斥
apps/server/src/platform/       # llm、db、storage、jobs、rag、日志、配置
apps/server/prisma/{schema.prisma,migrations}
packages/contracts/src/        # HTTP/SSE/Zod公共契约
tests/{fixtures,integration,e2e}
data/{sources,texts,exports,backups,logs}  # 忽略提交，数据库亦位于data
```

HTTP只验证和派发用例；Orchestrator调领域，领域不反向调编排；Platform不导入业务；contracts不导出Prisma/SDK类型。production/commit是明确跨Content/State的事务协调入口，使用同一个tx句柄。模块以schema/service/routes/prompts起步，有真实复杂度再拆分，不生成空壳仓储层。索引异步，事实同步。

## 14. 可按顺序执行的开发任务与验收

本次只写文档，下表为后续开发任务。每阶段只在前置阶段通过后推进；开发中发现本文矛盾应修正文档，不擅自用旧实现补空白。

| 顺序 | 任务与前置定义 | 产出 | 必须通过 |
| --- | --- | --- | --- |
| P1 | 工程骨架；第2/13节 | workspace、迁移、配置、HTTP、空白Web、测试入口 | 干净Windows安装；dev/build/typecheck/test；无Key可启动；迁移空库 |
| P2a | 版本/状态类型；第2/6/13节 | Schema、Delta模拟器、临时库仓储 | T01～T06；禁止未知字段；全部状态集合的schema到位 |
| P2b | 编排与提交；第9节 | FakeModel、Job、锁、Receipt、Outbox | T07～T12；假模型连续提交两章 |
| P3a | ChatAnyWhere；第10节 | 适配器、模型设置、Prompt注册与错误处理 | T13～T16；真实调用为显式单独测试 |
| P3b | 开书和规划；第4/5节 | 默认Style/Template/Skill、State0确认、滚动计划、假设与软期限 | T17～T19、T42、T45；所有输入版本固定 |
| P4 | 写作与审核；第7/8/12节 | 编辑器、StateContextResolver、Evaluator注册与Policy、独立配置后台、修复、SSE、导出 | T20～T24、T43～T44、T47～T48；真实两章闭环；无PASS不提交 |
| P5 | 版本与连续生产；第9/11节 | 批量、重写、后续失效、预算调整 | T25～T27；失败不越过当章 |
| P6 | Reference/Knowledge；第3/4节 | TXT/EPUB、覆盖度、实体整理、Framework/资产版本 | T28～T31；知识和项目事实隔离 |
| P7 | 长篇检索；第7/10节 | 中文BM25、摘要、可选Embedding、状态检索优化 | T32～T34；不改变已实现事实语义 |
| P8 | 收尾；第11/12/15节 | 备份恢复、回收站、可用性、说明与基准 | T35～T38；可从新环境复现 |

调整原技术方案：P2即定义全部Story State schema和转换约束，P7仅做长篇检索和性能优化，不把事实正确性推迟到后期。P3使用系统默认Knowledge，P6才实现用户可导入的参考/知识工作台。

### 14.1 验收用例（Given / When / Then）

| ID | 给定与操作 | 预期结果 |
| --- | --- | --- |
| T01 | 含CRLF/组合Unicode/emoji文本规范化并引用Span | normalize幂等；code point范围与quote完全一致 |
| T02 | 旧revision保存草稿/发布版本 | 409；原值不变；本地草稿可保留 |
| T03 | 对话“我猜李明死了”抽取 | UNVERIFIED/SUSPECTS，不能写DEAD |
| T04 | 无获得信息证据却把角色设KNOWS | 状态审核不通过 |
| T05 | Delta含负库存、缺引用、时间环、非法复活 | 模拟失败，原Snapshot不变 |
| T06 | 同事件移交物品并同步成员关系 | 完整组通过；半组失败；无中间数据库状态 |
| T07 | 两标签同时启动同一本的章节 | 一个Job，或409；不并行写事实 |
| T08 | 相同幂等key重复请求/不同payload复用key | 前者同结果，后者409 |
| T09 | 最终事务每个写点故障注入 | 所有失败均保留旧head，不能出现正文完成但状态未完成 |
| T10 | 提交成功响应丢失，再次执行commit | 同一Receipt，无重复事件/快照 |
| T11 | 取消与提交分别先获得写事务 | 取消先则不提交，提交先则返回SUCCEEDED |
| T12 | 每阶段进程中断后恢复 | 产物复用符合hash；不完整流新attempt；不自动续费 |
| T13 | 429/5xx/401/长Retry-After | 严格执行次数和暂停规则，401不重试 |
| T14 | JSON字段缺失/修复仍不合法 | 仅1次格式修复，失败不补空值通过 |
| T15 | 模型输出截断、拒绝、空文本、流停滞 | 候选不完整，不进入审核/提交 |
| T16 | 累计调用到40并普通重试 | BUDGET_EXHAUSTED；显式增额才继续 |
| T17 | 未确认开书就写第一章 | 拒绝；只有确认事务产生State0 |
| T18 | 当前Arc余1份计划，自动补窗 | 仅补到min(N+4,Arc末章)，不生成后卷事实 |
| T19 | 角色死亡影响未来计划 | 标stale并重规划，不立即重写Book/已完成正文 |
| T20 | required出现BLOCKER/MAJOR/MINOR、required模型超时 | 前三者均FAIL，超时Job失败，全部不能提交 |
| T21 | 正文修复后旧审核PASS存在 | 仍重跑冻结Policy的required检查并抽取新Delta，不能借用旧PASS |
| T22 | 必要Context超预算 | CONTEXT_TOO_LARGE，不能截掉Canon继续 |
| T23 | SSE跨字节/行，快照读取到订阅间丢最后token | 正确解析；artifact/done重读完整版本；不创建新Job |
| T24 | 生成期间用户编辑并切章 | 工作草稿不被生成片段覆盖；保存失败可见 |
| T25 | 第3章重写，原head=5 | head回2，3～5失效；旧版本仍可读 |
| T26 | 重写第3章失败/成功 | 失败停2；成功只推进3，4/5需逐章验证 |
| T27 | 第2章因MINOR而FAIL，修复成功/修复耗尽仍FAIL；或达到10章 | 成功后可继续；耗尽则子FAILED、父PAUSED不写第3章；批次结束不自动完结 |
| T28 | 无标题/重复标题/TXT编码异常 | 预览可修；章节按顺序；不静默丢字 |
| T29 | EPUB越界路径/解压膨胀 | 导入拒绝；无根目录外写入 |
| T30 | 一个分析单元失败 | PARTIAL、coverage<1、不可正式发布 |
| T31 | RawPack绑定/改编引用缺失 | 拒绝；Adapted发布绑定也不直接写State0 |
| T32 | 检索中含未来章和重写旧版本 | 排名前过滤，不能选入Context |
| T33 | Embedding不可用或维度改变 | 文本检索降级/待重建，不混向量、不换供应商 |
| T34 | 远期未回收Promise和角色知识 | required动作与必要认知作为硬上下文；单纯软期限为可选提醒；缺证据不虚构 |
| T35 | 备份恢复到临时目录 | 校验hash/FK、正文和state一致；任务INTERRUPTED |
| T36 | 删除项目有活动Job/共享知识 | 前者拒绝；永久清理不删共享资产 |
| T37 | 窄屏、键盘、错误、空状态 | 核心操作可达、焦点正确、无静默失败 |
| T38 | 搜索新仓库旧路径/Electron/内联Prompt | 无旧代码依赖、无桌面分支、所有模型调用归一 |
| T39 | P2：写至第41章并重写第21章；损坏checkpoint或Delta | 最多回放19个Delta，严格沿父链，不读旧支线；损坏停止，checkpoint写失败整章回滚 |
| T40 | P2：E10观察门开，E11门关闭但角色不在场 | 当前门关；角色仍KNOWS旧版本且OUTDATED，下一次观察才新增认知 |
| T41 | P2：后来证据纠正原命题；闪回有效时间早于记录时间 | CORRECTED区别WORLD_CHANGE；不覆盖历史版本、不改写旧角色观察 |
| T42 | 硬假设角色存活变为死亡；软资源假设改变；提交后立刻崩溃 | 硬计划stale、软NEEDS_REVIEW；恢复先重查再写下一章，不能靠索引任务碰巧运行 |
| T43 | 新注册第九个Evaluator；optional超时；required MINOR | 无公共枚举/表列修改；optional诊断不阻断；required FAIL |
| T44 | 管理员尝试移除Core或降低Core规则；在途修改Policy | 前者拒绝；旧Job按冻结版本审核和原子提交，新Job使用新策略 |
| T45 | 软期限已到但本章无required回收；本章required回收缺失 | 前者提交并触发规划信号，后者FAIL；完结仅检查显式最终义务 |
| T46 | P6：长篇实体跨数百章再现、同名、别名、恢复旧分析 | 名字/索引召回且候选<=60、<=12000字符；不串未来版本，歧义不自动合并 |
| T47 | 普通会话访问admin；新SkillConfig；后台回滚版本 | 无管理员会话拒绝；版本不可变并仅影响新Job；普通工作区无配置入口 |
| T48 | cast外事件主体、地点物品、required Promise、角色旧观察 | Resolver包含必要闭包；预算不足明确报错，不静默丢硬事实 |
| T49 | P2/P8：多项目队列、同项目双命令、3000章数据 | Platform默认全局1个模型请求；项目唯一命令独立保证；Checkpoint数量为1+floor(head/20)（不含历史支线） |

测试组织：纯函数Vitest；临时SQLite事务/故障注入集成测试；假HTTP/SSE模型服务验证协议；Playwright验证用户流程。真实ChatAnyWhere测试需显式运行并有Key，普通测试禁止调用真实API。

长篇性能基准默认300章×3000字符、1000实体、10000命题、1000Promise，另加3000章存储/重放压力样本：本机报告Checkpoint数量/体积、Delta体积、Snapshot读取、检索、Context组装p50/p95与内存峰值，包含冷缓存和重写分支；目标不含模型等待的单次组装p95<2秒。文学质量使用20章自有样本人工检查默认八项及新增Evaluator：任何关键事实矛盾都记缺陷，不以模型自评分替代。该目标是验收预算，未通过前不得宣称达到。

## 15. 风险、参考位置和一致性核对

### 15.1 明确限制

- 模型抽取/审核可能漏报，严格事务不能消除语义幻觉。保留证据、历史和人工修订入口，不能宣称小说事实已被数学证明。
- 40/100次调用及量表阈值是默认设计，不是对实际费用、质量或模型速率的承诺；配置变更可由用户手动修改本文。
- 逻辑Snapshot每章存在，物理Checkpoint每20章保存；状态规模增长仍可能使Checkpoint膨胀，应测量压缩与重放开销。优化不得改变历史版本、父链、哈希和原子性语义。
- 并行、多实例、远程登录、云同步、EPUB导出、分支剧情、任意自定义状态编辑器不在首版范围。
- 公共模型能力会变化，实际模型ID/窗口/结构化输出/Embedding须配置和实测；不能照搬旧供应商注册表。

### 15.2 旧实现参考

归档根：`C:/Users/gaijinchao/Desktop/code/tmp/One2Novel-legacy-20260905-124250/workspace`。

仅带着具体问题参考：`server/src/platform/llm/contextSelection.ts`（预算教训）、`server/src/modules/novel/planning/referenceDeepAnalysis/`（切分经验）、`server/src/modules/novel/production/quality/qualityGate.ts`（审核领域）、`client/src/components/workspace/ChapterEditor.tsx`（编辑体验）。其他位置见TECHNICAL_PLAN第11节。

禁止复制函数/文件/Prompt/schema/测试后改名；禁止从归档导入模块、复制数据库/密钥、运行旧服务作为新系统的验收。旧chapterPipeline、commit投影、Director仅作反例，不作模板。

### 15.3 文档完成检查

```text
readyForImplementation(spec):
    require all eight PRD domains mapped to sections and tasks
    require every state has allowed transitions and error outcome
    require every model task has input/output/validation/failure contract
    require candidate/active/working draft never ambiguous
    require each mutation defines preconditions, transaction/lock and version impact
    require every default has explicit value or a defined user-configuration path
    require all acceptance cases map to a development phase
    require no unresolved placeholder business function hides an undefined policy
```

本文默认设计用于人工修改后的执行起点；不保留“待逐轮问答”的流程要求。用户修改后开发者先核对相关章节一致性，再开始所请求阶段，不因为本文完成而自行开发应用。

技术事实参考：[ChatAnyWhere官方说明](https://github.com/chatanywhere/GPT_API_free)、[官方Chat Completions示例](https://github.com/chatanywhere/GPT_API_free/blob/main/demo/openai_chat_completion_demo.py)、[SQLite适用场景](https://www.sqlite.org/whentouse.html)、[Prisma 7 migration](https://docs.prisma.io/docs/cli/v7/migrate)。协议地址已有前轮公共资料核对；本轮未调用真实模型。
