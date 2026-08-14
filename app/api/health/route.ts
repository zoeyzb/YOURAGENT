import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    ok: true,
    services: {
      web: "ready",
      database: hasSupabaseEnv() ? "configured" : "missing_configuration",
      voiceRuntime: process.env.DOGRAH_BASE_URL ? "configured" : "missing_configuration",
      integrations: process.env.NANGO_SECRET_KEY ? "configured" : "missing_configuration",
    },
  });
}
