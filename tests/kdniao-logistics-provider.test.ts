import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";
import { KDNIAO_ENDPOINTS, kdniaoPublicStatus, readKdniaoConfig } from "@/server/logistics/kdniao-config";
import {
  mapKdniaoState,
  maskLogisticsContactDetails,
  parseKdniaoShanghaiTime,
} from "@/server/logistics/kdniao-response-schema";
import { buildKdniaoForm, buildKdniaoRequestData, createKdniaoDataSign } from "@/server/logistics/kdniao-signature";
import { LogisticsProviderError } from "@/server/logistics/logistics-types";
import {
  KdniaoLogisticsProvider,
  defaultKdniaoTransport,
  type KdniaoTransport,
} from "@/server/logistics/providers/kdniao-logistics-provider";

function configured(mode: "sandbox" | "production" = "sandbox") {
  return readKdniaoConfig({
    LOGISTICS_KDNIAO_MODE: mode,
    LOGISTICS_KDNIAO_EBUSINESS_ID: "test-business",
    LOGISTICS_KDNIAO_APP_KEY: "test-app-key",
    LOGISTICS_KDNIAO_TIMEOUT_MS: "5000",
  });
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    contentType: "application/json;charset=utf-8",
    body: JSON.stringify({
      Success: true,
      State: "2",
      ShipperCode: "SF",
      LogisticCode: "SF1234567890",
      Traces: [
        { AcceptTime: "2026-07-18 10:00:00", AcceptStation: "已揽收，电话 13812345678" },
        { AcceptTime: "2026/07/18 12:30:00", AcceptStation: "运输中，座机 020-12345678" },
      ],
      ...overrides,
    }),
  };
}

describe("KDNIAO configuration and signature", () => {
  it("defaults to disabled without exposing credentials", () => {
    expect(kdniaoPublicStatus({})).toEqual({ provider: "KDNIAO", configured: false, mode: "disabled" });
  });

  it("uses fixed sandbox and production endpoints", () => {
    expect(configured("sandbox").endpoint).toBe(KDNIAO_ENDPOINTS.sandbox);
    expect(configured("production").endpoint).toBe(KDNIAO_ENDPOINTS.production);
  });

  it("treats missing sandbox credentials as unconfigured", () => {
    expect(readKdniaoConfig({ LOGISTICS_KDNIAO_MODE: "sandbox" }).configured).toBe(false);
    expect(readKdniaoConfig({ LOGISTICS_KDNIAO_MODE: "sandbox", LOGISTICS_KDNIAO_EBUSINESS_ID: "id" }).configured).toBe(false);
  });

  it("rejects invalid mode and timeout configuration", () => {
    expect(() => readKdniaoConfig({ LOGISTICS_KDNIAO_MODE: "custom" })).toThrow(ServiceError);
    expect(() => readKdniaoConfig({ LOGISTICS_KDNIAO_TIMEOUT_MS: "999" })).toThrow(ServiceError);
    expect(() => readKdniaoConfig({ LOGISTICS_KDNIAO_TIMEOUT_MS: "abc" })).toThrow(ServiceError);
  });

  it("creates the documented MD5-hex then Base64 signature", () => {
    const requestData = buildKdniaoRequestData("SF", "SF1234567890");
    expect(requestData).toBe('{"ShipperCode":"SF","LogisticCode":"SF1234567890"}');
    expect(createKdniaoDataSign(requestData, "test-app-key")).toBe("YzE5OWEzNjE2MTFjMzE5ZGQ3MTQxZjRhMTU5NjFhMTI=");
    const form = buildKdniaoForm({ requestData, eBusinessId: "test-business", appKey: "test-app-key" });
    expect(form.get("RequestData")).toBe(requestData);
    expect(form.get("RequestType")).toBe("1002");
    expect(form.get("DataType")).toBe("2");
    expect(form.get("DataSign")).toBe("YzE5OWEzNjE2MTFjMzE5ZGQ3MTQxZjRhMTU5NjFhMTI=");
  });
});

describe("KDNIAO response normalization", () => {
  it("maps documented and safe fallback states", () => {
    expect(mapKdniaoState("0")).toBe("UNKNOWN");
    expect(mapKdniaoState("1")).toBe("PICKED_UP");
    expect(mapKdniaoState("2")).toBe("IN_TRANSIT");
    expect(mapKdniaoState("3")).toBe("DELIVERED");
    expect(mapKdniaoState("4")).toBe("EXCEPTION");
    expect(mapKdniaoState("999")).toBe("UNKNOWN");
  });

  it("parses both documented time separators as Asia/Shanghai", () => {
    expect(parseKdniaoShanghaiTime("2026-07-18 10:00:00").toISOString()).toBe("2026-07-18T02:00:00.000Z");
    expect(parseKdniaoShanghaiTime("2026/07/18 10:00:00").toISOString()).toBe("2026-07-18T02:00:00.000Z");
    expect(() => parseKdniaoShanghaiTime("2026-02-30 10:00:00")).toThrow(LogisticsProviderError);
    expect(() => parseKdniaoShanghaiTime("not-a-date")).toThrow(LogisticsProviderError);
  });

  it("masks mobile and landline numbers without masking ordinary numbers", () => {
    expect(maskLogisticsContactDetails("电话 13812345678")).toBe("电话 138****5678");
    expect(maskLogisticsContactDetails("座机 020-12345678")).toBe("座机 020-****5678");
    expect(maskLogisticsContactDetails("运单 123456789012345")).toBe("运单 123456789012345");
  });
});

describe("KDNIAO adapter", () => {
  it("sends a fixed form request through an injected transport and normalizes tracks", async () => {
    const transport = vi.fn<KdniaoTransport>().mockResolvedValue(response());
    const provider = new KdniaoLogisticsProvider(transport, () => configured(), () => new Date("2026-07-18T05:00:00.000Z"));
    const result = await provider.queryTracking({ carrierCode: "sf", trackingNumber: "SF1234567890" });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0]).toMatchObject({ endpoint: KDNIAO_ENDPOINTS.sandbox, timeoutMs: 5000 });
    const body = new URLSearchParams(transport.mock.calls[0][0].body);
    expect(body.get("EBusinessID")).toBe("test-business");
    expect(body.get("RequestType")).toBe("1002");
    expect(result.currentStatus).toBe("IN_TRANSIT");
    expect(result.events.map((event) => event.eventTime.toISOString())).toEqual([
      "2026-07-18T02:00:00.000Z",
      "2026-07-18T04:30:00.000Z",
    ]);
    expect(result.events[0].description).toContain("138****5678");
    expect(result.events[1].description).toContain("020-****5678");
    expect(result.events[0].location).toBeNull();
  });

  it("does not call transport while unconfigured", async () => {
    const transport = vi.fn<KdniaoTransport>();
    const provider = new KdniaoLogisticsProvider(transport, () => readKdniaoConfig({}));
    await expect(provider.queryTracking({ carrierCode: "SF", trackingNumber: "SF123" })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_NOT_CONFIGURED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects provider failures without exposing the raw reason", async () => {
    const transport = vi.fn<KdniaoTransport>().mockResolvedValue(response({ Success: false, Reason: "AppKey 签名错误" }));
    const provider = new KdniaoLogisticsProvider(transport, () => configured());
    await expect(provider.queryTracking({ carrierCode: "SF", trackingNumber: "SF1234567890" })).rejects.toMatchObject({
      code: "LOGISTICS_PROVIDER_AUTH_FAILED",
      message: "快递鸟拒绝了本次查询。",
    });
  });

  it("rejects HTML, invalid JSON, redirects and oversized/provider-invalid responses", async () => {
    const cases = [
      { status: 200, contentType: "text/html", body: "<html>error</html>" },
      { status: 200, contentType: "application/json", body: "not-json" },
      { status: 302, contentType: "text/plain", body: "redirect" },
      response({ Traces: "invalid" }),
    ];
    for (const providerResponse of cases) {
      const provider = new KdniaoLogisticsProvider(async () => providerResponse, () => configured());
      await expect(provider.queryTracking({ carrierCode: "SF", trackingNumber: "SF1234567890" })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_INVALID_RESPONSE" });
    }
  });

  it("rejects mismatched carrier, tracking number and invalid track times", async () => {
    const cases = [
      response({ ShipperCode: "YTO" }),
      response({ LogisticCode: "OTHER123" }),
      response({ Traces: [{ AcceptTime: "invalid", AcceptStation: "运输中" }] }),
    ];
    for (const providerResponse of cases) {
      const provider = new KdniaoLogisticsProvider(async () => providerResponse, () => configured());
      await expect(provider.queryTracking({ carrierCode: "SF", trackingNumber: "SF1234567890" })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_INVALID_RESPONSE" });
    }
  });

  it("accepts a successful no-track response as UNKNOWN", async () => {
    const provider = new KdniaoLogisticsProvider(async () => response({ State: "0", Traces: [] }), () => configured());
    const result = await provider.queryTracking({ carrierCode: "SF", trackingNumber: "SF1234567890" });
    expect(result.currentStatus).toBe("UNKNOWN");
    expect(result.events).toEqual([]);
  });

  it("maps default transport timeout and network failures without retrying", async () => {
    const timeoutFetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    vi.stubGlobal("fetch", timeoutFetch);
    await expect(defaultKdniaoTransport({ endpoint: KDNIAO_ENDPOINTS.sandbox, body: "x=1", timeoutMs: 1, maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_TIMEOUT" });
    expect(timeoutFetch).toHaveBeenCalledOnce();

    const networkFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", networkFetch);
    await expect(defaultKdniaoTransport({ endpoint: KDNIAO_ENDPOINTS.sandbox, body: "x=1", timeoutMs: 1000, maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_NETWORK_ERROR" });
    expect(networkFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("rejects an oversized default-transport response before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": "4096" },
    })));
    await expect(defaultKdniaoTransport({ endpoint: KDNIAO_ENDPOINTS.sandbox, body: "x=1", timeoutMs: 1000, maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "LOGISTICS_PROVIDER_INVALID_RESPONSE" });
    vi.unstubAllGlobals();
  });
});
