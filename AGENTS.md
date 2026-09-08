# One2Novel V2 开发约定

## 只维护四个常读入口

1. [AGENTS.md](AGENTS.md)：开发约定与阅读顺序。
2. [REMAINING_WORK.md](REMAINING_WORK.md)：唯一当前进度、未完成清单、验收证据和下一步；开始任务先读第 1、6 节及相关条目。
3. [DEVELOPMENT_SPEC.md](DEVELOPMENT_SPEC.md)：唯一完整 V2 规范；先读第 0 节，再按任务阅读对应章节，保留原章节号与 T01～T49 编号。
4. [README.md](README.md)：运行、升级和已交付功能的使用说明；操作应用或环境时阅读。

`docs/archive/` 保存原 PRD、技术方案、MVP 范围及阶段验收，只供定点历史追溯，不是当前规范或进度；常规开发不全量重读。不要新增重复的路线图、交接总结或逐轮验收文档。需求变更只改细则，进度和新验收只改剩余清单，用户操作变化再改 README。

## 实现约束

- 本仓库从零重写，仅面向个人使用的 Web 产品；现有功能继续增量开发。
- 用户已要求采用完整默认设计并自行手动修改，不再逐轮问答；按细则中的明确默认值工作，用户最新要求与修改优先。单纯文档任务不自动授权额外业务开发；用户已明确要求继续完成 V2 时按剩余清单持续推进。
- 旧实现归档根为 `C:/Users/gaijinchao/Desktop/code/tmp/One2Novel-legacy-20260905-124250/workspace`，清单位于其父目录的 `archive-manifest.json`。禁止复制旧代码、Prompt、Schema、测试、配置或通过符号链接导入旧实现；定点参考位置见开发细则第 15.2 节。
- 仅在具体问题需要时定点参考旧文件，先提炼行为与教训，再独立实现。不得自动扫描整个旧项目来补全新需求。
- 不恢复旧 CLAUDE.md、Electron、历史数据库、API 兼容层或供应商配置。
- 所有模型请求统一由服务端 ChatAnyWhere 适配层发出；密钥不得进入浏览器、日志或 Git。
- Knowledge、Plan、Story State 严格分离。只有 Evaluation PASS 且状态原子提交成功才允许章节 COMPLETED 与下一章。
- 权威事实不异步投影写入；所有正式变更通过小说级执行约束和唯一提交入口。
- Snapshot每章逻辑存在，物理采用Checkpoint与Delta；不得恢复逐章全量State存储。角色认知引用获知时的命题版本，世界变化不自动改写角色知识。
- PlanAssumption是计划前提，Constraint是剧情义务；Promise软期限只触发规划复核。审核使用可注册Evaluator与冻结Policy，状态仅PASS/FAIL，Core不可关闭。
- SkillDefinition代码注册，SkillConfig由独立本机后台版本化管理，普通工作区不开放。Reference实体检索有界且隔离版本；全局模型并发1是Platform首版策略，同小说权威链串行是领域约束。
- 按剩余清单的依赖顺序推进，阶段定义见细则第 14 节；目标目录、Schema、Prompt 或按钮存在不等于功能完成。
- 没有实现的功能、未运行的测试、未验证的模型能力必须如实标明。完整 V2 的完成以剩余清单逐项交付和细则验收为准，不能用已交付 MVP/P5/P6 或测试总数代替。
