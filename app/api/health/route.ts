import { NextResponse } from "next/server";
import { hasDograhEnv, hasSupabaseAdminEnv, hasSupabaseEnv } from "@/lib/env";

type ServiceState = "ready" | "configured" | "missing_configuration" | "unreachable" | "tenant_scoped" | "disabled";

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
    if (!response.ok) {
      return { state: "unreachable" as ServiceState, statusCode: response.status };
    }

    const body = await response.json() as {
      status?: string;
      version?: string;
      deployment_mode?: string;
    };

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
  const databaseConfigured = hasSupabaseEnv() && hasSupabaseAdminEnv();
  const databaseState: ServiceState = databaseConfigured ? "configured" : "missing_configuration";
  const developmentRuntimeFallback = await probeDevelopmentDograhFallback();

  return NextResponse.json({
    ok: databaseConfigured,
    services: {
      web: { state: "ready" as ServiceState },
      database: { state: databaseState },
      tenantVoiceRuntime: {
        state: "tenant_scoped" as ServiceState,
        note: "Dograh credentials are resolved per organization from runtime_connections; a global runtime is not required in production.",
      },
      developmentRuntimeFallback,
    },
  }, { status: databaseConfigured ? 200 : 503 });
}
