# M4-B4 日报自动发送（已完成）

本阶段已通过 `verify:m4-daily-report` 的真实 HTTP、并发、失败重试、空报告保护和清理验收；M4-B 维持 FROZEN。

M4-B4 使用 `DailyBusinessReportDelivery` 保存日报发送状态，不保存 Webhook、Secret、日报正文或客户隐私。

## 幂等与状态

- 唯一约束：`ownerId + reportDate + channel`，当前 channel 为 `FEISHU`。
- 幂等键：`daily-business-report:<ownerId>:Asia/Shanghai:<reportDate>:FEISHU`。
- 状态：`PENDING`、`SENDING`、`SENT`、`FAILED`。
- 普通发送遇到 `SENT` 返回 `ALREADY_SENT`，不会再次调用飞书。
- `SENDING` 未超过 15 分钟返回 `IN_PROGRESS`；过期的 `SENDING` 可由下一次执行恢复并重试。
- 发送前由数据库唯一约束和条件更新抢占发送权，外部 HTTP 不在数据库事务中等待。
- 这是近似一次、至少一次的本地发送记录。飞书成功但本地 `SENT` 更新失败时，后续恢复仍可能造成极小重复发送风险。

## 重试

可自动重试：`FEISHU_TIMEOUT`、`FEISHU_NETWORK_ERROR`、`FEISHU_5XX`。

不会自动重试：未配置、机器人拒绝、日期或时区参数错误、日报为空和日报生成规则错误。每次 CLI 运行最多进行一次外部调用，不在同一 Node 进程循环重试。

## CLI

```powershell
pnpm send:daily-report
pnpm send:daily-report -- --date=2026-07-15
pnpm send:daily-report -- --dry-run
pnpm send:daily-report -- --retry-failed
```

默认发送北京时间昨日。`--dry-run` 只生成和格式化消息，不调用飞书，也不创建 Delivery。CLI 直接调用服务层，不启动 Next.js 或访问 localhost；退出码 `0` 表示发送、跳过或 dry-run 成功，配置、数据库或网络失败返回非零。

当前单 owner 部署默认使用既有 `default-user`；可通过服务器环境变量 `DAILY_REPORT_OWNER_ID` 显式覆盖。不会扫描或猜测其他 owner。

## Windows 任务计划程序

使用以下脚本：

- `scripts/windows/install-daily-report-task.ps1`
- `scripts/windows/test-daily-report-task.ps1`
- `scripts/windows/uninstall-daily-report-task.ps1`

默认任务名 `ResaleERP-DailyBusinessReport`，每天 Windows 本地时间 `09:00` 执行，使用 `StartWhenAvailable` 补跑错过的计划，且忽略并发新实例。任务动作只调用 CLI，不包含 Secret；日志按日写入 `logs/daily-business-report-YYYY-MM-DD.log`，包含 requestId、日期、渠道、状态、尝试次数和安全错误码，不包含密钥、Webhook、密码、SQL、堆栈或完整正文。

电脑关机、休眠未唤醒、Docker/PostgreSQL 不可用、网络不可用或 Webhook 配置无效时，任务会以非零退出码失败。不会自动启动或关闭 Docker，也不会自动补发更早日期；更早日期只能由人工显式指定。
