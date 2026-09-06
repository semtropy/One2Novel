# One2Novel V2 开发约定

- 本仓库正在从零重写，仅面向个人使用的 Web 产品。
- 开始任务先阅读 `PRD.md` 与 `TECHNICAL_PLAN.md`；目标目录是方案，不代表已经实现。
- 必须一并阅读 `DEVELOPMENT_SPEC.md`。用户已要求采用完整默认设计并自行手动修改，不再逐轮问答；按细则中的明确默认值工作，用户修改优先。文档完成不自动启动业务开发；收到实际开发任务后再执行相应阶段。
- 旧实现已移到工作区外，准确路径见技术方案第 2、11 节。禁止复制旧代码、Prompt、Schema、测试、配置或通过符号链接导入旧实现。
- 仅在具体问题需要时定点参考旧文件，先提炼行为与教训，再独立实现。不得自动扫描整个旧项目来补全新需求。
- 不恢复旧 CLAUDE.md、Electron、历史数据库、API 兼容层或供应商配置。
- 所有模型请求统一由服务端 ChatAnyWhere 适配层发出；密钥不得进入浏览器、日志或 Git。
- Knowledge、Plan、Story State 严格分离。只有 Evaluation PASS 且状态原子提交成功才允许章节 COMPLETED 与下一章。
- 权威事实不异步投影写入；所有正式变更通过小说级执行约束和唯一提交入口。
- Snapshot每章逻辑存在，物理采用Checkpoint与Delta；不得恢复逐章全量State存储。角色认知引用获知时的命题版本，世界变化不自动改写角色知识。
- PlanAssumption是计划前提，Constraint是剧情义务；Promise软期限只触发规划复核。审核使用可注册Evaluator与冻结Policy，状态仅PASS/FAIL，Core不可关闭。
- SkillDefinition代码注册，SkillConfig由独立本机后台版本化管理，普通工作区不开放。Reference实体检索有界且隔离版本；全局模型并发1是Platform首版策略，同小说权威链串行是领域约束。
- 按技术方案阶段推进。没有实现的功能、未运行的测试、未验证的模型能力必须如实标明。
- 第一版 MVP 与 P5 连续生产增量已实现，实际功能与验收以 `README.md`、`docs/MVP_ACCEPTANCE.md`、`docs/P5_ACCEPTANCE.md` 为准；DEVELOPMENT_SPEC 描述完整 V2，不代表49项均已实现。文档任务仍不得擅自启动额外产品开发。
