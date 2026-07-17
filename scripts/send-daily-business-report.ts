import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { ServiceError as ServiceErrorType } from "../src/server/errors";

const environmentFile = process.env.DAILY_REPORT_ENV_FILE || ".env";
dotenv.config({ path: environmentFile, quiet: true });

type CliInput = { date?: string; timezone: string; dryRun: boolean; retryFailed: boolean; ownerId: string };
type ServiceErrorConstructor = new (code: string, message: string, status: number) => ServiceErrorType;

function parseArgs(argv: string[], defaultOwnerId: string, ServiceError: ServiceErrorConstructor): CliInput {
  const input: CliInput = { timezone: "Asia/Shanghai", dryRun: false, retryFailed: false, ownerId: process.env.DAILY_REPORT_OWNER_ID?.trim() || defaultOwnerId };
  for (const arg of argv) {
    if (arg === "--dry-run") input.dryRun = true;
    else if (arg === "--retry-failed") input.retryFailed = true;
    else if (arg.startsWith("--date=")) input.date = arg.slice("--date=".length);
    else if (arg.startsWith("--timezone=")) input.timezone = arg.slice("--timezone=".length);
    else if (arg.startsWith("--owner=")) input.ownerId = arg.slice("--owner=".length);
    else throw new ServiceError("CLI_ARGUMENT_INVALID", "日报命令参数无效。", 400);
  }
  if (!input.ownerId.trim()) throw new ServiceError("DAILY_REPORT_OWNER_NOT_FOUND", "日报发送所属用户未配置。", 400);
  return input;
}

function safeLog(payload: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function yesterdayInShanghai(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1));
  return date.toISOString().slice(0, 10);
}

async function main() {
  const [
    { DEFAULT_OWNER_ID },
    { db },
    { ServiceError },
    { deliverDailyBusinessReport, getDailyBusinessReportDeliveryStatus },
    { prepareDailyBusinessReportForFeishu },
    { resolveDailyReportPeriod },
  ] = await Promise.all([
    import("../src/server/constants"),
    import("../src/server/db"),
    import("../src/server/errors"),
    import("../src/server/notifications/daily-business-report-delivery-coordinator"),
    import("../src/server/notifications/daily-business-report-delivery-service"),
    import("../src/server/reports/daily-business-report-period"),
  ]);
  database = db;

  const input = parseArgs(process.argv.slice(2), DEFAULT_OWNER_ID, ServiceError);
  const requestedAt = new Date();
  const date = input.date ?? yesterdayInShanghai(requestedAt);
  const period = resolveDailyReportPeriod({ date, timezone: input.timezone, generatedAt: requestedAt });
  const owner = await db.user.findUnique({ where: { id: input.ownerId }, select: { id: true } });
  if (!owner) throw new ServiceError("DAILY_REPORT_OWNER_NOT_FOUND", "日报发送所属用户不存在。", 404);

  if (input.retryFailed) {
    const status = await getDailyBusinessReportDeliveryStatus({ ownerId: input.ownerId, date: period.reportDate, timezone: period.timezone, requestedAt });
    if (status.delivery.status !== "FAILED" || !status.delivery.retryable) {
      safeLog({ requestId: randomUUID(), mode: "RETRY_FAILED", reportDate: period.reportDate, channel: "FEISHU", outcome: "SKIPPED_NO_RETRYABLE_FAILURE", deliveryStatus: status.delivery.status, attemptCount: status.delivery.attemptCount });
      return;
    }
  }

  if (input.dryRun) {
    const prepared = await prepareDailyBusinessReportForFeishu({ ownerId: input.ownerId, date: period.reportDate, timezone: period.timezone, requestedAt });
    safeLog({ requestId: randomUUID(), mode: "DRY_RUN", reportDate: prepared.report.reportDate, channel: "FEISHU", deliveryStatus: "NOT_CREATED", attemptCount: 0 });
    return;
  }

  const result = await deliverDailyBusinessReport({ ownerId: input.ownerId, date: period.reportDate, timezone: period.timezone, requestedAt });
  safeLog({
    requestId: randomUUID(),
    mode: input.retryFailed ? "RETRY_FAILED" : "SEND",
    reportDate: result.reportDate,
    channel: "FEISHU",
    outcome: result.outcome,
    deliveryStatus: result.delivery.status,
    attemptCount: result.delivery.attemptCount,
  });
}

let database: typeof import("../src/server/db").db | null = null;

main()
  .catch((error) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DAILY_REPORT_CLI_FAILED";
    const message = error instanceof Error && code !== "DAILY_REPORT_CLI_FAILED"
      ? error.message
      : "日报命令执行失败，请检查配置、数据库或网络。";
    process.stderr.write(`${JSON.stringify({ code, message })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database?.$disconnect();
  });
