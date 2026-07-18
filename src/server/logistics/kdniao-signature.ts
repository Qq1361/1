import { createHash } from "node:crypto";

export const KDNIAO_REQUEST_TYPE = "1002";

export function createKdniaoDataSign(requestData: string, appKey: string) {
  const md5Hex = createHash("md5").update(`${requestData}${appKey}`, "utf8").digest("hex");
  return Buffer.from(md5Hex, "utf8").toString("base64");
}

export function buildKdniaoRequestData(carrierCode: string, trackingNumber: string) {
  return JSON.stringify({ ShipperCode: carrierCode, LogisticCode: trackingNumber });
}

export function buildKdniaoForm(input: {
  requestData: string;
  eBusinessId: string;
  appKey: string;
}) {
  const form = new URLSearchParams();
  form.set("RequestData", input.requestData);
  form.set("EBusinessID", input.eBusinessId);
  form.set("RequestType", KDNIAO_REQUEST_TYPE);
  form.set("DataSign", createKdniaoDataSign(input.requestData, input.appKey));
  form.set("DataType", "2");
  return form;
}
