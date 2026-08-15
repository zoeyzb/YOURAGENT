import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { resolveDograhConnection } from "@/lib/runtime-connection";

type RouteRow = {
  id: string;
  telephony_connection_id: string;
  external_phone_number_id: string;
  external_workflow_id: string | null;
  label: string | null;
  is_active: boolean;
};

type ConnectionRow = { id: string; external_config_id: string; status: string };

type ChangedRoute = { route: RouteRow; configurationId: string };

function deploymentWorkflowId(deploymentId: string) {
  const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
  if (!match) throw new Error("INVALID_DOGRAH_DEPLOYMENT_ID");
  return Number(match[1]);
}

async function restoreRoutes(options: {
  adapter: DograhTelephonyAdapter;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  changed: ChangedRoute[];
  workflowId: number;
  active: boolean;
}) {
  for (const item of [...options.changed].reverse()) {
    try {
      const restored = await options.adapter.updatePhoneNumber({
        configurationId: item.configurationId,
        phoneNumberId: item.route.external_phone_number_id,
        inboundWorkflowId: options.workflowId,
        label: item.route.label,
        isActive: options.active,
      });
      await options.supabase
        .from("phone_number_routes")
        .update({
          is_active: options.active,
          provider_sync_ok: restored.provider_sync?.ok ?? null,
          provider_sync_message: restored.provider_sync?.message ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.route.id);
    } catch {
      await options.supabase
        .from("phone_number_routes")
        .update({
          provider_sync_ok: false,
          provider_sync_message: "Pause/resume rollback requires reconciliation",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.route.id);
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "resume" ? "resume" : body.action === "pause" ? "pause" : null;
  if (!action) return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });

  let changedRoutes: ChangedRoute[] = [];
  let runtimeChanged = false;
  let deployment: { id: string; organization_id: string; external_deployment_id: string; status: string } | null = null;
  let voiceAdapter: DograhAdapter | null = null;
  let telephonyAdapter: DograhTelephonyAdapter | null = null;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let workflowId: number | null = null;

  try {
    supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,organization_id,current_version")
      .eq("id", id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });

    const desiredStatus = action === "pause" ? "ready" : "paused";
    const { data: deploymentData, error: deploymentError } = await supabase
      .from("runtime_deployments")
      .select("id,organization_id,external_deployment_id,status")
      .eq("agent_id", id)
      .eq("agent_version", agent.current_version)
      .eq("provider", "dograh")
      .eq("status", desiredStatus)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deploymentData) return NextResponse.json({ error: "DEPLOYMENT_NOT_FOUND" }, { status: 404 });
    deployment = deploymentData;
    workflowId = deploymentWorkflowId(deployment.external_deployment_id);

    const runtime = await resolveDograhConnection(deployment.organization_id);
    voiceAdapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    telephonyAdapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);

    const { data: routesData, error: routesError } = await supabase
      .from("phone_number_routes")
      .select("id,telephony_connection_id,external_phone_number_id,external_workflow_id,label,is_active")
      .eq("organization_id", deployment.organization_id)
      .eq("agent_id", id);
    if (routesError) throw routesError;
    const routes = (routesData ?? []) as RouteRow[];
    const connectionIds = [...new Set(routes.map((route) => route.telephony_connection_id))];
    let connections: ConnectionRow[] = [];
    if (connectionIds.length) {
      const { data: connectionData, error: connectionError } = await supabase
        .from("telephony_connections")
        .select("id,external_config_id,status")
        .eq("organization_id", deployment.organization_id)
        .in("id", connectionIds);
      if (connectionError) throw connectionError;
      connections = (connectionData ?? []) as ConnectionRow[];
    }
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

    if (action === "pause") {
      await voiceAdapter.pause(deployment.external_deployment_id);
    } else {
      await voiceAdapter.resume(deployment.external_deployment_id);
    }
    runtimeChanged = true;

    const nextActive = action === "resume";
    for (const route of routes) {
      if (route.is_active === nextActive) continue;
      const connection = connectionById.get(route.telephony_connection_id);
      if (!connection || connection.status !== "active") throw new Error(`PHONE_ROUTE_CONNECTION_INACTIVE:${route.id}`);
      const updated = await telephonyAdapter.updatePhoneNumber({
        configurationId: connection.external_config_id,
        phoneNumberId: route.external_phone_number_id,
        inboundWorkflowId: workflowId,
        label: route.label,
        isActive: nextActive,
      });
      if (updated.provider_sync?.ok === false) {
        throw new Error(`PHONE_ROUTE_PROVIDER_SYNC_FAILED:${route.id}:${updated.provider_sync.message ?? "unknown"}`);
      }
      const { error: routeUpdateError } = await supabase
        .from("phone_number_routes")
        .update({
          is_active: nextActive,
          external_workflow_id: String(workflowId),
          provider_sync_ok: updated.provider_sync?.ok ?? null,
          provider_sync_message: updated.provider_sync?.message ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", route.id);
      if (routeUpdateError) throw routeUpdateError;
      changedRoutes.push({ route, configurationId: connection.external_config_id });
    }

    const nextStatus = action === "pause" ? "paused" : "ready";
    const nextAgentStatus = action === "pause" ? "paused" : "published";
    const { error: deploymentUpdateError } = await supabase
      .from("runtime_deployments")
      .update({ status: nextStatus, updated_at: new Date().toISOString(), last_error: null })
      .eq("id", deployment.id);
    if (deploymentUpdateError) throw deploymentUpdateError;

    const { error: agentUpdateError } = await supabase
      .from("agents")
      .update({ status: nextAgentStatus })
      .eq("id", id)
      .eq("current_version", agent.current_version);
    if (agentUpdateError) throw agentUpdateError;

    runtimeChanged = false;
    changedRoutes = [];
    return NextResponse.json({ status: nextStatus, phoneRoutesActive: nextActive });
  } catch (error) {
    if (changedRoutes.length && telephonyAdapter && supabase && workflowId !== null) {
      await restoreRoutes({
        adapter: telephonyAdapter,
        supabase,
        changed: changedRoutes,
        workflowId,
        active: action === "pause",
      });
    }
    if (runtimeChanged && voiceAdapter && deployment) {
      try {
        if (action === "pause") await voiceAdapter.resume(deployment.external_deployment_id);
        else await voiceAdapter.pause(deployment.external_deployment_id);
      } catch {
        if (supabase) {
          await supabase
            .from("runtime_deployments")
            .update({
              status: "failed",
              last_error: "PAUSE_RESUME_ROLLBACK_FAILED",
              updated_at: new Date().toISOString(),
            })
            .eq("id", deployment.id);
        }
      }
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") || message === "SUPABASE_NOT_CONFIGURED"
      ? 503
      : message === "AGENT_NOT_FOUND" || message === "DEPLOYMENT_NOT_FOUND"
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
