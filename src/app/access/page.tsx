import { Suspense } from "react";
import { AccessForm } from "./access-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AccessPage() {
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] place-items-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-sm rounded-lg shadow-none">
        <CardHeader>
          <CardTitle>访问 Resale ERP</CardTitle>
          <CardDescription>请输入部署环境配置的访问密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <AccessForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
