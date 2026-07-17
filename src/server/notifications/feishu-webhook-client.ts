import { createHmac } from "node:crypto";
import { ServiceError } from "@/server/errors";
import type { FeishuDailyReportConfig } from "./feishu-config";

export type FeishuTextMessage = {
  msg_type: "text";
  content: { text: string };
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const FEISHU_WEBHOOK_TIMEOUT_MS = 5_000;

// Feishu V2 custom bot signs an empty message with timestamp + newline + secret as the HMAC key.
export function createFeishuWebhookSignature(secret: string, timestampSeconds: string) {
  return createHmac("sha256", `${timestampSeconds}\n${secret}`).update("").digest("base64");
}

export async function sendFeishuWebhookMessage(input: {
  config: FeishuDailyReportConfig;
  message: FeishuTextMessage;
  now: Date;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}) {
  const timestamp = String(Math.floor(input.now.getTime() / 1_000));
  const payload = input.config.secret
    ? { timestamp, sign: createFeishuWebhookSignature(input.config.secret, timestamp), ...input.message }
    : input.message;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? FEISHU_WEBHOOK_TIMEOUT_MS);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ServiceError("FEISHU_TIMEOUT", "飞书日报发送超时，请稍后手动重试。", 503);
    }
    throw new ServiceError("FEISHU_NETWORK_ERROR", "无法连接飞书日报机器人，请检查网络后重试。", 503);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new ServiceError("FEISHU_5XX", "飞书日报机器人暂时不可用，请稍后重试。", 503);
    }
    throw new ServiceError("FEISHU_REJECTED_REQUEST", "飞书日报机器人拒绝了本次请求，请检查机器人配置后重试。", 503);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ServiceError("FEISHU_INVALID_RESPONSE", "飞书日报机器人返回了无法识别的响应，请稍后重试。", 503);
  }

  if (!body || typeof body !== "object") {
    throw new ServiceError("FEISHU_INVALID_RESPONSE", "飞书日报机器人返回了无法识别的响应，请稍后重试。", 503);
  }

  const result = body as { code?: unknown; StatusCode?: unknown };
  const code = result.code ?? result.StatusCode;
  if (code !== 0) {
    throw new ServiceError("FEISHU_REJECTED_REQUEST", "飞书日报机器人拒绝了本次请求，请检查机器人配置后重试。", 503);
  }

  return { success: true as const, channel: "FEISHU" as const, sentAt: input.now.toISOString() };
}
