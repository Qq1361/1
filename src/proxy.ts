import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  constantTimeEqual,
  createAccessToken,
} from "@/lib/access-protection";

const PUBLIC_PATHS = ["/access", "/api/access", "/manifest.webmanifest"];

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const isProduction = process.env.NODE_ENV === "production";
  const isPublicPath = PUBLIC_PATHS.some(
    (path) =>
      request.nextUrl.pathname === path ||
      request.nextUrl.pathname.startsWith(`${path}/`),
  );

  if (!password && !isProduction) {
    return NextResponse.next();
  }

  if (isPublicPath || request.nextUrl.pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  if (!password) {
    return NextResponse.redirect(new URL("/access?error=config", request.url));
  }

  const actualToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "";
  const expectedToken = await createAccessToken(password);
  if (constantTimeEqual(actualToken, expectedToken)) {
    return NextResponse.next();
  }

  const url = new URL("/access", request.url);
  url.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
