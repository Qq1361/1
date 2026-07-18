import { Suspense } from "react";
import { Boxes, ClipboardCheck, ReceiptText } from "lucide-react";
import { AccessForm } from "./access-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export default function AccessPage() {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_30rem]">
      <section className="hidden bg-foreground px-10 py-12 text-background lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-background text-base font-bold text-foreground">
            R
          </span>
          <div>
            <p className="font-semibold">Resale ERP</p>
            <p className="text-sm text-background/65">二手交易运营工作台</p>
          </div>
        </div>
        <div className="max-w-xl">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            让采购、验货、库存与销售保持在同一条业务链路上
          </h2>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-background/75">
            <span className="inline-flex items-center gap-2 rounded-full border border-background/15 px-3 py-2">
              <ReceiptText className="size-4" /> 采购追踪
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-background/15 px-3 py-2">
              <ClipboardCheck className="size-4" /> 验货流转
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-background/15 px-3 py-2">
              <Boxes className="size-4" /> 库存管理
            </span>
          </div>
        </div>
        <p className="text-xs text-background/50">仅限已授权人员访问</p>
      </section>

      <main className="grid place-items-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid size-11 place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
              R
            </span>
            <p className="mt-3 font-semibold">Resale ERP</p>
            <p className="text-sm text-muted-foreground">二手交易运营工作台</p>
          </div>
          <Card className="rounded-xl shadow-none">
            <CardHeader>
              <h1 className="text-xl font-semibold">访问系统</h1>
              <CardDescription>请输入部署环境配置的访问密码。</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={null}>
                <AccessForm />
              </Suspense>
            </CardContent>
          </Card>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            密码仅用于当前部署环境的访问验证
          </p>
        </div>
      </main>
    </div>
  );
}
