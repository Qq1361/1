import { logisticsProviderServiceError } from "../logistics-errors";
import type { LogisticsProviderAdapter } from "../logistics-provider";
import { normalizeCarrierCode, normalizeTrackingNumber } from "../logistics-rules";
import type { LogisticsProviderQueryInput, LogisticsProviderResult } from "../logistics-types";
import { LogisticsProviderError } from "../logistics-types";
import { readKdniaoConfig, type KdniaoConfig } from "../kdniao-config";
import {
  mapKdniaoState,
  maskLogisticsContactDetails,
  parseKdniaoResponse,
  parseKdniaoShanghaiTime,
} from "../kdniao-response-schema";
import { buildKdniaoForm, buildKdniaoRequestData } from "../kdniao-signature";

const MAX_RESPONSE_BYTES = 256 * 1024;
const CARRIER_PATTERN = /^[A-Z0-9]{2,20}$/;

export type KdniaoTransportRequest = {
  endpoint: string;
  body: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type KdniaoTransportResponse = {
  status: number;
  contentType: string | null;
  body: string;
};

export type KdniaoTransport = (request: KdniaoTransportRequest) => Promise<KdniaoTransportResponse>;

async function readLimitedResponse(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟响应过大。", false);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟响应过大。", false);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export const defaultKdniaoTransport: KdniaoTransport = async (request) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: request.body,
      redirect: "manual",
      signal: controller.signal,
    });
    const body = await readLimitedResponse(response, request.maxResponseBytes);
    return { status: response.status, contentType: response.headers.get("content-type"), body };
  } catch (error) {
    if (error instanceof LogisticsProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new LogisticsProviderError("LOGISTICS_PROVIDER_TIMEOUT", "快递鸟查询超时。", true);
    }
    throw new LogisticsProviderError("LOGISTICS_PROVIDER_NETWORK_ERROR", "无法连接快递鸟服务。", true);
  } finally {
    clearTimeout(timeout);
  }
};

function providerFailureCode(reason: string | undefined) {
  const safeReason = reason?.trim() ?? "";
  if (/签名|授权|账号|用户|AppKey|EBusinessID/i.test(safeReason)) return "LOGISTICS_PROVIDER_AUTH_FAILED";
  if (/频繁|次数|限流|上限|quota|rate/i.test(safeReason)) return "LOGISTICS_PROVIDER_RATE_LIMITED";
  return "LOGISTICS_PROVIDER_REJECTED";
}

function responseStatusError(status: number) {
  if (status === 401 || status === 403) return new LogisticsProviderError("LOGISTICS_PROVIDER_AUTH_FAILED", "快递鸟认证失败。", false);
  if (status === 429) return new LogisticsProviderError("LOGISTICS_PROVIDER_RATE_LIMITED", "快递鸟查询已被限流。", true);
  return new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟返回了无效 HTTP 状态。", status >= 500);
}

function parseJsonBody(response: KdniaoTransportResponse) {
  if (response.status < 200 || response.status >= 300) throw responseStatusError(response.status);
  const text = response.body.trim();
  if (!text || /^\s*</.test(text) || response.contentType?.toLowerCase().includes("text/html")) {
    throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟返回了非 JSON 响应。", false);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟返回的 JSON 无法解析。", false);
  }
}

function requireConfigured(config: KdniaoConfig) {
  if (!config.configured || !config.endpoint || !config.eBusinessId || !config.appKey) {
    throw logisticsProviderServiceError(
      "LOGISTICS_PROVIDER_NOT_CONFIGURED",
      "真实物流查询尚未配置，当前仍可手工维护物流状态。",
      false,
    );
  }
  return {
    endpoint: config.endpoint,
    eBusinessId: config.eBusinessId,
    appKey: config.appKey,
    timeoutMs: config.timeoutMs,
  };
}

export class KdniaoLogisticsProvider implements LogisticsProviderAdapter {
  readonly code = "KDNIAO";

  constructor(
    private readonly transport: KdniaoTransport = defaultKdniaoTransport,
    private readonly configLoader: () => KdniaoConfig = () => readKdniaoConfig(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  isConfigured() {
    return this.configLoader().configured;
  }

  supportsCarrier(carrierCode: string) {
    return CARRIER_PATTERN.test(carrierCode.trim().toUpperCase());
  }

  async queryTracking(input: LogisticsProviderQueryInput): Promise<LogisticsProviderResult> {
    const config = requireConfigured(this.configLoader());
    const carrierCode = normalizeCarrierCode(input.carrierCode);
    if (!this.supportsCarrier(carrierCode)) {
      throw new LogisticsProviderError("LOGISTICS_INVALID_CARRIER", "快递公司代码无效。", false);
    }
    const tracking = normalizeTrackingNumber(input.trackingNumber);
    const requestData = buildKdniaoRequestData(carrierCode, tracking.normalizedTrackingNumber);
    const form = buildKdniaoForm({ requestData, eBusinessId: config.eBusinessId, appKey: config.appKey });
    const transportResponse = await this.transport({
      endpoint: config.endpoint,
      body: form.toString(),
      timeoutMs: config.timeoutMs,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
    const response = parseKdniaoResponse(parseJsonBody(transportResponse));
    if (!response.Success) {
      const code = providerFailureCode(response.Reason);
      throw new LogisticsProviderError(code, "快递鸟拒绝了本次查询。", code === "LOGISTICS_PROVIDER_RATE_LIMITED");
    }
    if (response.ShipperCode && response.ShipperCode.trim().toUpperCase() !== carrierCode) {
      throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟返回的快递公司代码不匹配。", false);
    }
    if (response.LogisticCode) {
      const returnedTracking = normalizeTrackingNumber(response.LogisticCode);
      if (returnedTracking.normalizedTrackingNumber !== tracking.normalizedTrackingNumber) {
        throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟返回的快递单号不匹配。", false);
      }
    }

    const currentStatus = mapKdniaoState(response.State);
    const parsedEvents = response.Traces.map((trace, index) => {
      const station = trace.AcceptStation.trim();
      const remark = trace.Remark.trim();
      const description = maskLogisticsContactDetails([station, remark].filter(Boolean).join("；"));
      if (!description) {
        throw new LogisticsProviderError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "快递鸟轨迹描述无效。", false);
      }
      return {
        index,
        eventTime: parseKdniaoShanghaiTime(trace.AcceptTime),
        description,
      };
    });
    parsedEvents.sort((left, right) => left.eventTime.getTime() - right.eventTime.getTime() || left.index - right.index);

    return {
      provider: this.code,
      carrierCode,
      trackingNumber: tracking.trackingNumber,
      currentStatus,
      rawStatusCode: response.State ?? null,
      events: parsedEvents.map((event, index) => ({
        eventTime: event.eventTime,
        status: index === parsedEvents.length - 1 ? currentStatus : "UNKNOWN",
        location: null,
        description: event.description,
        rawStatusCode: index === parsedEvents.length - 1 ? response.State ?? null : null,
      })),
      queriedAt: this.clock(),
    };
  }
}
