import { logisticsProviderServiceError, logisticsValidationError } from "./logistics-errors";
import type { LogisticsProviderAdapter } from "./logistics-provider";
import { normalizeProviderCode } from "./logistics-rules";
import { MockLogisticsProvider } from "./providers/mock-logistics-provider";

export class LogisticsProviderRegistry {
  private readonly providers = new Map<string, LogisticsProviderAdapter>();

  constructor(providers: LogisticsProviderAdapter[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: LogisticsProviderAdapter) {
    const code = normalizeProviderCode(provider.code);
    if (this.providers.has(code)) {
      throw logisticsValidationError("LOGISTICS_INVALID_PROVIDER", `物流 Provider ${code} 重复注册。`);
    }
    this.providers.set(code, provider);
    return this;
  }

  get(providerCode: unknown) {
    const code = normalizeProviderCode(providerCode);
    const provider = this.providers.get(code);
    if (!provider) {
      throw logisticsProviderServiceError("LOGISTICS_PROVIDER_NOT_FOUND", "未注册指定的物流 Provider。", false);
    }
    if (provider.isConfigured && !provider.isConfigured()) {
      throw logisticsProviderServiceError("LOGISTICS_PROVIDER_NOT_CONFIGURED", "物流 Provider 尚未完成服务端配置。", false);
    }
    return provider;
  }

  listCodes() {
    return [...this.providers.keys()].sort();
  }
}

export const logisticsProviderRegistry = new LogisticsProviderRegistry([
  new MockLogisticsProvider(),
]);
