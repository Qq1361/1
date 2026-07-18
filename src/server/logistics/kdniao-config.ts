import { logisticsProviderServiceError } from "./logistics-errors";

export const KDNIAO_ENDPOINTS = {
  sandbox: "http://sandboxapi.kdniao.com:8080/kdniaosandbox/gateway/exterfaceInvoke.json",
  production: "https://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx",
} as const;

export type KdniaoMode = "disabled" | "sandbox" | "production";

export type KdniaoConfig = {
  mode: KdniaoMode;
  configured: boolean;
  endpoint: string | null;
  eBusinessId: string | null;
  appKey: string | null;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

function optionalSecret(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function parseMode(value: string | undefined): KdniaoMode {
  const mode = (value ?? "disabled").trim().toLowerCase();
  if (mode === "disabled" || mode === "sandbox" || mode === "production") return mode;
  throw logisticsProviderServiceError(
    "LOGISTICS_PROVIDER_CONFIGURATION_INVALID",
    "快递鸟运行模式配置无效。",
    false,
  );
}

function parseTimeout(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value.trim())) {
    throw logisticsProviderServiceError(
      "LOGISTICS_PROVIDER_CONFIGURATION_INVALID",
      "快递鸟超时时间配置无效。",
      false,
    );
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw logisticsProviderServiceError(
      "LOGISTICS_PROVIDER_CONFIGURATION_INVALID",
      "快递鸟超时时间必须在 1000 到 30000 毫秒之间。",
      false,
    );
  }
  return timeoutMs;
}

export function readKdniaoConfig(env: NodeJS.ProcessEnv = process.env): KdniaoConfig {
  const mode = parseMode(env.LOGISTICS_KDNIAO_MODE);
  const eBusinessId = optionalSecret(env.LOGISTICS_KDNIAO_EBUSINESS_ID);
  const appKey = optionalSecret(env.LOGISTICS_KDNIAO_APP_KEY);
  return {
    mode,
    configured: mode !== "disabled" && Boolean(eBusinessId && appKey),
    endpoint: mode === "disabled" ? null : KDNIAO_ENDPOINTS[mode],
    eBusinessId,
    appKey,
    timeoutMs: parseTimeout(env.LOGISTICS_KDNIAO_TIMEOUT_MS),
  };
}

export function kdniaoPublicStatus(env: NodeJS.ProcessEnv = process.env) {
  const config = readKdniaoConfig(env);
  return { provider: "KDNIAO" as const, configured: config.configured, mode: config.mode };
}
