import { NextResponse } from "next/server";
import { hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { hasDograhEnv } from "@/lib/env";

type ServiceState = "ready" | "configured" | "missing_configuration" | "unreachable" | "tenant_scoped" | "disabled";

async function probeDatabase() {
  if (!hasDatabaseUrl()) return { state: "missing_configuration" as ServiceState };

  try {
    await query("select 1 from organizations limit 1");
    await query('select 1 from neon_auth."user" limit 1');
    return { state: "ready" as ServiceState };
  } catch (error) {
    return {
      state: "unreachable" as ServiceState,
      error: error instanceof Error ? error.message : "DATABASE_HEALTH_ERROR",
    };
  }
}

async function probeDevelopmentDograhFallback() {
  const fallbackEnabled = process.env.ALLOW_GLOBAL_DOGRAH_FALLBACK === "true";
  if (!fallbackEnabled) return { state: "disabled" as ServiceState };
  if (!hasDograhEnv()) return { state: "missing_configuration" as ServiceState };

  const baseUrl = process.env.DOGRAH_BASE_URL!.replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { state: "unreachable" as ServiceState, statusCode: response.status };
    const body = await response.json() as { status?: string; version?: string; deployment_mode?: string };
    return {
      state: body.status === "ok" ? "ready" as ServiceState : "unreachable" as ServiceState,
      version: body.version ?? null,
      deploymentMode: body.deployment_mode ?? null,
    };
  } catch (error) {
    return {
      state: "unreachable" as ServiceState,
      error: error instanceof Error ? error.name : "DOGRAH_HEALTH_ERROR",
    };
  }
}

export async function GET() {
  const [database, developmentRuntimeFallback] = await Promise.all([
    probeDatabase(),
    probeDevelopmentDograhFallback(),
  ]);
  const authState: ServiceState = hasAuthConfiguration() ? "configured" : "missing_configuration";
  const ready = database.state === "ready" && authState === "configured";

  return NextResponse.json({
    ok: ready,
    services: {
      web: { state: "ready" as ServiceState },
      database,
      auth: { state: authState, provider: "better-auth", schema: "neon_auth" },
      tenantVoiceRuntime: {
        state: "tenant_scoped" as ServiceState,
        note: "Dograh credentials are organization-scoped and stored encrypted in Postgres; the global runtime is development-only.",
      },
      developmentRuntimeFallback,
    },
  }, { status: ready ? 200 : 503 });
}
