"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldError, marketErrorMessage, marketJson } from "./market-client";

type MarketItemFormValue = { displayName: string; skuText: string | null; versionText: string | null; conditionText: string | null; packageVariant: string | null; accessoryVariant: string | null; defaultTargetProfitAmount: string | null; note: string | null };
type Result = { marketItem: { id: string; displayName: string; normalizedName: string; skuText: string | null; normalizedSku: string | null }; potentialDuplicates?: { id: string; displayName: string; skuText: string | null }[]; warnings?: string[] };

function text(value: string | null | undefined) { return value ?? ""; }
function initialValue(initial?: Partial<MarketItemFormValue>): MarketItemFormValue { return { displayName: text(initial?.displayName), skuText: text(initial?.skuText), versionText: text(initial?.versionText), conditionText: text(initial?.conditionText), packageVariant: text(initial?.packageVariant), accessoryVariant: text(initial?.accessoryVariant), defaultTargetProfitAmount: text(initial?.defaultTargetProfitAmount), note: text(initial?.note) }; }

export function MarketItemForm({ marketItemId, initial, onSuccess }: { marketItemId?: string; initial?: Partial<MarketItemFormValue>; onSuccess: (result: Result) => void }) {
  const [value, setValue] = useState<MarketItemFormValue>(() => initialValue(initial));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  function set(key: keyof MarketItemFormValue, next: string) { setValue((old) => ({ ...old, [key]: next })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.displayName.trim()) { setErrors({ displayName: ["请输入行情商品名称。"] }); return; }
    setSaving(true); setFormError(null); setErrors({});
    const payload = {
      displayName: value.displayName,
      skuText: value.skuText?.trim() || null,
      versionText: value.versionText?.trim() || null,
      conditionText: value.conditionText?.trim() || null,
      packageVariant: value.packageVariant?.trim() || null,
      accessoryVariant: value.accessoryVariant?.trim() || null,
      defaultTargetProfitAmount: value.defaultTargetProfitAmount?.trim() || null,
      note: value.note?.trim() || null,
    };
    try {
      const result = marketItemId ? await marketJson<Result>(`/api/market/items/${marketItemId}`, "PATCH", payload) : await marketJson<Result>("/api/market/items", "POST", payload);
      if (result.warnings?.includes("POTENTIAL_DUPLICATE_MARKET_ITEM")) toast.warning("发现疑似重复商品，系统未自动合并。");
      onSuccess(result);
    } catch (cause) {
      setFormError(marketErrorMessage(cause));
      const next: Record<string, string[]> = {};
      for (const field of ["displayName", "skuText", "defaultTargetProfitAmount", "form"]) {
        const message = fieldError(cause, field);
        if (message) next[field] = [message];
      }
      setErrors(next);
    } finally { setSaving(false); }
  }
  const input = (key: keyof MarketItemFormValue, label: string, placeholder = "") => <div className="space-y-1"><Label htmlFor={`market-${key}`}>{label}</Label><Input id={`market-${key}`} value={value[key] ?? ""} placeholder={placeholder} onChange={(event) => set(key, event.target.value)}/>{errors[key]?.[0] ? <p className="text-xs text-destructive">{errors[key][0]}</p> : null}</div>;
  return <form className="space-y-4" onSubmit={submit} noValidate>
    {input("displayName", "商品名称", "例如：雅诗兰黛 DW 粉底液")}
    <div className="grid gap-3 sm:grid-cols-2">{input("skuText", "SKU / 色号", "例如：2C0")}{input("versionText", "版本", "例如：第一代")}{input("conditionText", "成色", "例如：全新")}{input("packageVariant", "包装", "例如：有盒")}{input("accessoryVariant", "配件", "例如：含泵头")}{input("defaultTargetProfitAmount", "默认目标利润", "可选，例如：80.00")}</div>
    <div className="space-y-1"><Label htmlFor="market-note">备注</Label><Textarea id="market-note" value={value.note ?? ""} onChange={(event) => set("note", event.target.value)} placeholder="可选，记录适用条件或人工判断。"/></div>
    {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
    <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin"/> : null}{marketItemId ? "保存商品" : "创建行情商品"}</Button></div>
  </form>;
}
