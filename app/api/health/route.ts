import { NextResponse } from "next/server";
import { hasDograhEnv, hasSupabaseAdminEnv, hasSupabaseEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ServiceState = "ready" | "configured" | "missing_configuration" | "unreachable" | "tenant_scoped" | "disabled";

async function probeDatabase() {
  if (!hasSupabaseEnv() || !hasSupabaseAdminEnv()) {
    return { state: "missing_configuration" as ServiceState };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });
    if (error) {
      return {
        state: "unreachable" as ServiceState,
        error: "DATABASE_SCHEMA_UNAVAILABLE",
      };
    }
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
  const [database, developmentRuntimeFallback] = await Promise.all([
    probeDatabase(),
    probeDevelopmentDograhFallback(),
  ]);
  const databaseReady = database.state === "ready";

  return NextResponse.json({
    ok: databaseReady,
    services: {
      web: { state: "ready" as ServiceState },
      database,
      tenantVoiceRuntime: {
        state: "tenant_scoped" as ServiceState,
        note: "Dograh credentials are resolved per organization from runtime_connections; a global runtime is not required in production.",
      },
      developmentRuntimeFallback,
    },
  }, { status: databaseReady ? 200 : 503 });
}
