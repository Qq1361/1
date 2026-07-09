"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccessForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setError(body.message ?? "无法验证访问密码。");
      setPending(false);
      return;
    }

    const nextPath = searchParams.get("next");
    router.replace(nextPath?.startsWith("/") ? nextPath : "/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="password">访问密码</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={pending}>
        <LockKeyhole />
        {pending ? "正在验证" : "进入系统"}
      </Button>
    </form>
  );
}
