import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getMigrations } from "better-auth/db/migration";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { APP_SCHEMA_SQL } from "@/lib/app-schema";
import { getDbPool, hasDatabaseUrl } from "@/lib/db";

function authorized(request: Request) {
  const expected = process.env.BOOTSTRAP_TOKEN;
  const header = request.headers.get("authorization");
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl() || !hasAuthConfiguration()) {
    return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    await getDbPool().query(APP_SCHEMA_SQL);

    const checks = await Promise.all([
      getDbPool().query("select 1 from organizations limit 1"),
      getDbPool().query('select 1 from "user" limit 1'),
      getDbPool().query("select 1 from agents limit 1"),
    ]);

    return NextResponse.json({
      ok: true,
      authSchema: "ready",
      appSchema: "ready",
      probes: checks.length,
    });
  } catch (error) {
    console.error("YOURAGENT_BOOTSTRAP_FAILED", error);
    return NextResponse.json({
      error: "BOOTSTRAP_FAILED",
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    }, { status: 500 });
  }
}
