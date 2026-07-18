import { ServiceError } from "@/server/errors";

export type FeishuDailyReportConfig = {
  webhookUrl: string;
  secret: string | null;
};

const NOT_CONFIGURED_MESSAGE = "尚未配置飞书日报机器人，请先在服务端环境变量中完成配置。";

function trimEnvironmentValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isAllowedWebhookUrl(value: URL) {
  if (value.protocol === "https:") return true;
  const allowLocalVerificationWebhook = process.env.FEISHU_DAILY_REPORT_TEST_ALLOW_LOCAL_WEBHOOK === "1";
  return (process.env.NODE_ENV !== "production" || allowLocalVerificationWebhook)
    && value.protocol === "http:"
    && ["127.0.0.1", "localhost", "::1"].includes(value.hostname);
}

export function getFeishuDailyReportConfig(): FeishuDailyReportConfig {
  const configuredUrl = trimEnvironmentValue(process.env.FEISHU_DAILY_REPORT_WEBHOOK_URL);
  if (!configuredUrl) {
    throw new ServiceError("FEISHU_NOT_CONFIGURED", NOT_CONFIGURED_MESSAGE, 503);
  }

  try {
    const webhookUrl = new URL(configuredUrl);
    if (!isAllowedWebhookUrl(webhookUrl)) throw new Error("unsupported webhook URL");
    return { webhookUrl: webhookUrl.toString(), secret: trimEnvironmentValue(process.env.FEISHU_DAILY_REPORT_SECRET) };
  } catch {
    throw new ServiceError("FEISHU_NOT_CONFIGURED", NOT_CONFIGURED_MESSAGE, 503);
  }
}
