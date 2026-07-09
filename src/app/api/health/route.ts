import { NextResponse } from "next/server";

export function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const accessConfigured =
    process.env.NODE_ENV !== "production" || Boolean(process.env.APP_PASSWORD);
  const healthy = databaseConfigured && accessConfigured;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        databaseConfigured,
        accessConfigured,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
