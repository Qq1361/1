"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  parseWarehouseReturnTarget,
  WAREHOUSE_PAGE_PATH,
  WAREHOUSE_RETURN_STORAGE_KEY,
  type WarehouseReturnTarget,
} from "@/lib/warehouse-back-navigation";

type Location = { id: string; name: string; isActive: boolean };
type Warehouse = {
  id: string;
  name: string;
  isActive: boolean;
  locations: Location[];
  _count: { inventoryItems: number };
};
type EditingTarget = { kind: "warehouse" | "location"; id: string; name: string } | null;

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "操作失败。");
  return body;
}

export function WarehouseManager() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [name, setName] = useState("");
  const [locationNames, setLocationNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [editingName, setEditingName] = useState("");
  const returnTargetRef = useRef<WarehouseReturnTarget | null>(null);

  useEffect(() => {
    returnTargetRef.current = parseWarehouseReturnTarget(sessionStorage.getItem(WAREHOUSE_RETURN_STORAGE_KEY));
  }, []);

  const load = async () => {
    const data = await request("/api/inventory/warehouses");
    setWarehouses(data);
  };

  useEffect(() => {
    let cancelled = false;
    void request("/api/inventory/warehouses")
      .then((data) => {
        if (!cancelled) setWarehouses(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "加载仓库失败。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败。");
    }
  };

  const openEdit = (target: NonNullable<EditingTarget>) => {
    setEditing(target);
    setEditingName(target.name);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const url = editing.kind === "warehouse"
      ? `/api/inventory/warehouses/${editing.id}`
      : `/api/inventory/warehouse-locations/${editing.id}`;
    await mutate(async () => {
      await request(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName }),
      });
      setEditing(null);
    });
  };

  const returnToInventory = () => {
    const returnTarget = returnTargetRef.current;
    if (returnTarget?.source === "history") {
      window.setTimeout(() => {
        if (window.location.pathname === WAREHOUSE_PAGE_PATH) router.replace("/inventory");
      }, 300);
      router.back();
      return;
    }
    router.push(returnTarget?.path ?? "/inventory");
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 self-start px-3" onClick={returnToInventory}>
          <ArrowLeft /> 返回库存
        </Button>
        <p className="text-sm text-muted-foreground">结构化库存位置</p>
        <h1 className="text-2xl font-semibold">仓库与库位</h1>
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        void mutate(async () => {
          await request("/api/inventory/warehouses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          setName("");
        });
      }}>
        <Input aria-label="仓库名称" className="h-11" placeholder="新建仓库" value={name} onChange={(event) => setName(event.target.value)} />
        <Button className="min-h-11" type="submit">新建仓库</Button>
      </form>
    </div>

    {warehouses.length === 0 ? <Card><CardContent className="py-8 text-sm text-muted-foreground">暂未设置仓库。可先新建一个仓库，再添加库位。</CardContent></Card> : null}
    {warehouses.map((warehouse) => <Card key={warehouse.id} className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="break-words text-lg">{warehouse.name}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{warehouse.isActive ? "启用中" : "已停用"} · 已关联 {warehouse._count.inventoryItems} 件历史库存</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" className="min-h-11" onClick={() => openEdit({ kind: "warehouse", id: warehouse.id, name: warehouse.name })}>编辑</Button>
          <Button variant="outline" className="min-h-11" onClick={() => void mutate(() => request(`/api/inventory/warehouses/${warehouse.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !warehouse.isActive }) }))}>{warehouse.isActive ? "停用" : "启用"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {warehouse.locations.map((location) => <div className="flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-sm" key={location.id}>
            <span className="break-all">{location.name}</span>
            <span className="text-muted-foreground">{location.isActive ? "启用" : "停用"}</span>
            <Button size="sm" variant="ghost" onClick={() => openEdit({ kind: "location", id: location.id, name: location.name })}>编辑</Button>
            <Button size="sm" variant="ghost" onClick={() => void mutate(() => request(`/api/inventory/warehouse-locations/${location.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !location.isActive }) }))}>{location.isActive ? "停用" : "启用"}</Button>
          </div>)}
        </div>
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          void mutate(async () => {
            await request(`/api/inventory/warehouses/${warehouse.id}/locations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: locationNames[warehouse.id] || "" }),
            });
            setLocationNames((current) => ({ ...current, [warehouse.id]: "" }));
          });
        }}>
          <Input aria-label={`${warehouse.name} 的新库位名称`} className="h-11" placeholder="新建标准库位" value={locationNames[warehouse.id] || ""} onChange={(event) => setLocationNames((current) => ({ ...current, [warehouse.id]: event.target.value }))} disabled={!warehouse.isActive} />
          <Button className="min-h-11" type="submit" disabled={!warehouse.isActive}>新增库位</Button>
        </form>
        {!warehouse.isActive ? <p className="text-xs text-muted-foreground">已停用仓库保留历史展示，不能新增库位或用于新的入库。</p> : null}
      </CardContent>
    </Card>)}

    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑{editing?.kind === "warehouse" ? "仓库" : "库位"}</DialogTitle>
          <DialogDescription>名称仅影响后续展示，不会修改历史库存记录。</DialogDescription>
        </DialogHeader>
        <Input aria-label="编辑名称" className="h-11" value={editingName} onChange={(event) => setEditingName(event.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
          <Button onClick={() => void saveEdit()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
