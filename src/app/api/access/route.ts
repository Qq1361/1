import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ACCESS_COOKIE_NAME,
  constantTimeEqual,
  createAccessToken,
} from "@/lib/access-protection";

const requestSchema = z.object({
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const configuredPassword = process.env.APP_PASSWORD;
  if (!configuredPassword) {
    return NextResponse.json(
      { code: "ACCESS_NOT_CONFIGURED", message: "APP_PASSWORD 未配置。" },
      { status: 503 },
    );
  }

  const result = requestSchema.safeParse(await request.json());
  if (
    !result.success ||
    !constantTimeEqual(result.data.password, configuredPassword)
  ) {
    return NextResponse.json(
      { code: "INVALID_PASSWORD", message: "访问密码错误。" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: await createAccessToken(configuredPassword),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
