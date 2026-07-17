import { marketQuery } from "./market-query";

export async function marketItemDetailResponse(ownerId: string, id: string, status = 200, extra: Record<string, unknown> = {}) {
  return Response.json({ ...(await marketQuery.getMarketItemDetail(ownerId, id)), ...extra }, { status });
}

export async function marketQuoteResponse(ownerId: string, id: string, status = 200) {
  return Response.json(await marketQuery.getMarketQuote(ownerId, id), { status });
}
