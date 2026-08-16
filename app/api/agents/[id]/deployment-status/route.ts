import { NextResponse } from "next/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
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
      await query(
        `update phone_number_routes set is_active = $1, provider_sync_ok = $2, provider_sync_message = $3, updated_at = now() where id = $4`,
        [options.active, restored.provider_sync?.ok ?? null, restored.provider_sync?.message ?? null, item.route.id],
      );
    } catch {
      await query(
        `update phone_number_routes set provider_sync_ok = false, provider_sync_message = 'Pause/resume rollback requires reconciliation', updated_at = now() where id = $1`,
        [item.route.id],
      );
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
  let workflowId: number | null = null;

  try {
    const agent = (await query<{ id: string; organization_id: string; current_version: number }>(
      `select id, organization_id, current_version from agents where id = $1 limit 1`,
      [id],
    )).rows[0];
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });
    await requireOrganizationAdmin(agent.organization_id, request.headers);

    const desiredStatus = action === "pause" ? "ready" : "paused";
    deployment = (await query<{ id: string; organization_id: string; external_deployment_id: string; status: string }>(
      `select id, organization_id, external_deployment_id, status
         from runtime_deployments
        where agent_id = $1 and agent_version = $2 and provider = 'dograh' and status = $3
        order by created_at desc limit 1`,
      [id, agent.current_version, desiredStatus],
    )).rows[0] ?? null;
    if (!deployment) return NextResponse.json({ error: "DEPLOYMENT_NOT_FOUND" }, { status: 404 });
    workflowId = deploymentWorkflowId(deployment.external_deployment_id);

    const runtime = await resolveDograhConnection(deployment.organization_id);
    voiceAdapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    telephonyAdapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);

    const routes = (await query<RouteRow>(
      `select id, telephony_connection_id, external_phone_number_id, external_workflow_id, label, is_active
         from phone_number_routes where organization_id = $1 and agent_id = $2`,
      [deployment.organization_id, id],
    )).rows;
    const connectionIds = [...new Set(routes.map((route) => route.telephony_connection_id))];
    const connections = connectionIds.length
      ? (await query<ConnectionRow>(
          `select id, external_config_id, status from telephony_connections where organization_id = $1 and id = any($2::uuid[])`,
          [deployment.organization_id, connectionIds],
        )).rows
      : [];
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

    if (action === "pause") await voiceAdapter.pause(deployment.external_deployment_id);
    else await voiceAdapter.resume(deployment.external_deployment_id);
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
      if (updated.provider_sync?.ok === false) throw new Error(`PHONE_ROUTE_PROVIDER_SYNC_FAILED:${route.id}:${updated.provider_sync.message ?? "unknown"}`);
      await query(
        `update phone_number_routes set is_active = $1, external_workflow_id = $2, provider_sync_ok = $3, provider_sync_message = $4, updated_at = now() where id = $5`,
        [nextActive, String(workflowId), updated.provider_sync?.ok ?? null, updated.provider_sync?.message ?? null, route.id],
      );
      changedRoutes.push({ route, configurationId: connection.external_config_id });
    }

    const nextStatus = action === "pause" ? "paused" : "ready";
    const nextAgentStatus = action === "pause" ? "paused" : "published";
    await query(`update runtime_deployments set status = $1, updated_at = now(), last_error = null where id = $2`, [nextStatus, deployment.id]);
    await query(`update agents set status = $1 where id = $2 and current_version = $3`, [nextAgentStatus, id, agent.current_version]);

    runtimeChanged = false;
    changedRoutes = [];
    return NextResponse.json({ status: nextStatus, phoneRoutesActive: nextActive });
  } catch (error) {
    if (changedRoutes.length && telephonyAdapter && workflowId !== null) {
      await restoreRoutes({ adapter: telephonyAdapter, changed: changedRoutes, workflowId, active: action === "pause" });
    }
    if (runtimeChanged && voiceAdapter && deployment) {
      try {
        if (action === "pause") await voiceAdapter.resume(deployment.external_deployment_id);
        else await voiceAdapter.pause(deployment.external_deployment_id);
      } catch {
        await query(
          `update runtime_deployments set status = 'failed', last_error = 'PAUSE_RESUME_ROLLBACK_FAILED', updated_at = now() where id = $1`,
          [deployment.id],
        ).catch(() => undefined);
      }
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")
      ? 503
      : message === "AGENT_NOT_FOUND" || message === "DEPLOYMENT_NOT_FOUND"
        ? 404
        : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
