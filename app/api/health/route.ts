import { NextResponse } from "next/server";
import { hasDograhEnv, hasSupabaseEnv } from "@/lib/env";

type ServiceState = "ready" | "configured" | "missing_configuration" | "unreachable";

async function probeDograh() {
  if (!hasDograhEnv()) {
    return { state: "missing_configuration" as ServiceState };
  }

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
      auth_provider?: string;
      turn_enabled?: boolean;
    };

    return {
      state: body.status === "ok" ? "ready" as ServiceState : "unreachable" as ServiceState,
      version: body.version ?? null,
      deploymentMode: body.deployment_mode ?? null,
      authProvider: body.auth_provider ?? null,
      turnEnabled: body.turn_enabled ?? null,
    };
  } catch (error) {
    return {
      state: "unreachable" as ServiceState,
      error: error instanceof Error ? error.name : "DOGRAH_HEALTH_ERROR",
    };
  }
}

export async function GET() {
  const voiceRuntime = await probeDograh();
  const databaseState: ServiceState = hasSupabaseEnv() ? "configured" : "missing_configuration";
  const integrationState: ServiceState = process.env.NANGO_SECRET_KEY ? "configured" : "missing_configuration";

  return NextResponse.json({
    ok: voiceRuntime.state !== "unreachable",
    services: {
      web: { state: "ready" as ServiceState },
      database: { state: databaseState },
      voiceRuntime,
      integrations: { state: integrationState },
    },
  });
}
