# P5 连续生产增量

日期：2026-09-06。基线：`b824b5b`。本次交付连续生产及其暂停、取消、恢复和预算控制，复用MVP的规划、审核、重写及唯一事实提交流程。

## 可执行行为

`POST /api/v1/projects/:id/production-runs`（与现有`/write`共用处理函数）：

```typescript
type WriteRequest = {
  expectedRevision: number;
  mode: 'GENERATE' | 'AUDIT_DRAFT';
  draftRevision: number | null;
  count: number; // 默认1，范围1..10；AUDIT_DRAFT只能1
};
```

count=1创建普通章节Job，count>1创建BATCH父Job。批次范围固定为`[head+1, head+count]`，不能超出targetCount；过大请求拒绝，不静默缩小。新命令需要Idempotency-Key；重复键和相同输入返回同一父Job，不重复安排子任务。

```text
创建父任务:
    冻结模型/Prompt/Policy/Skill配置、chainEpoch、初始base和范围
    同事务取得小说锁 + 保存父Job + 幂等Receipt

调度父任务（不调用模型）:
    校验成功子章的连续序号、base、提交凭据和当前head/epoch
    只为下一章创建一个QUEUED子Job
    子Job继承父配置；唯一(parentId, number)防止重复创建
    父保持RUNNING，锁继续归父所有

子章唯一提交事务:
    校验父锁、父子取消标记、当前base以及全部现有质量门禁
    原子写正文/事件/Delta/Snapshot/head/Receipt/子SUCCEEDED
    最后一章 -> 父SUCCEEDED并释放锁
    否则父pauseRequested -> 父PAUSED并释放锁
    否则 -> 父QUEUED/NEXT，保留父锁等待调度
    父进度事件与上述写入同事务

子章失败:
    子FAILED + 父PAUSED + 错误信息 + 释放父锁
    不创建下一章，不撤销之前已提交章节

恢复父任务:
    只允许PAUSED/FAILED/INTERRUPTED，重新获取小说锁
    当前head必须等于最近成功子章的提交快照（或初始base）
    epoch变化、外部推进或重写 -> STALE_INPUT，保持旧任务可读
    有未完成子章 -> 只将原子Job重新排队，不重置候选/计数
    没有未完成子章 -> 继续调度下一章
```

父Job无模型调用预算消耗，界面累计用量从子任务求和。每个子章初始40次HTTP调用、正文与状态修复各2次。子章预算耗尽后，先对该子Job增加额度，再恢复父Job；父预算接口拒绝直接调整，不能用新子任务绕过已用量。将预算降低至已用量以下会拒绝。

暂停只提供给批次：已安排的当前章执行完整闭环后暂停；章间立即暂停。取消写入父子标记并中止子调用，最终提交再次检查父子标记。提交先成功则保留已提交事实；最后一章已提交时取消返回SUCCEEDED。CANCELLED不能恢复，单章入口也遵循此规则。

父任务活动时，子任务不能独立恢复或取消。工作区显示父进度和当前子章阶段；查看规划/审核仍按具体章节与子Job绑定。SSE通过父进度事件刷新页面，关闭页面不取消执行。

## 验证

- `pnpm typecheck`：contracts、server、web全部通过。
- `pnpm test`：29项通过，包含原18项以及新增11项批次/HTTP场景。
- `pnpm build`：服务端和前端生产构建通过。
- `pnpm test:e2e`：3个Chrome场景通过，包括连续创作、暂停、刷新恢复、3章完整提交和进度显示；原有重写、草稿多标签冲突、设置与窄屏验证保持通过。
- Windows现有MVP数据库成功应用增量迁移`20260906000000_batch`。测试数据库执行全部版本化迁移，不再只加载最初SQL。
- 升级后生产服务在`127.0.0.1:7456`启动，health返回`schemaVersion:2`；Python浏览器只读检查书架与模型设置通过，无脚本错误。

新增测试覆盖：最多10章与超限拒绝、幂等、章间父锁、MINOR耗尽停在第2章、候选/计数复用、配置冻结、立即/章末暂停、在途取消与已提交取消、章间中断恢复、子阶段中断恢复、旧epoch拒绝、父进度写入故障导致整个提交回滚，以及HTTP参数和显式子章增额。

截图：`test-results/batch-completed.png`（Git忽略）。测试模型仅存在于测试入口；没有发出真实ChatAnyWhere请求。

## 范围限制

- 本次是P5连续生产增量，不声称P1～P5所有开发细则逐项验收完成。MVP中已记录的细粒度阶段恢复、单章阶段暂停、阶段换模型和书级完结等缺口仍然存在。
- 连续生成可用于历史回退后的新章节链，但没有提供批量REVALIDATE_OLD界面。
- 不自动扩展目标章数，不将批次结束当作全书完结。
- Reference/Knowledge工作台、Promise软期限、长篇检索和备份恢复仍未实现。
- 未配置真实模型密钥，文学质量、真实成本和具体模型兼容性尚未实测。
