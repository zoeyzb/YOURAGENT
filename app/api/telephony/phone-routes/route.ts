import { NextResponse } from "next/server";
import { z } from "zod";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const CreatePhoneRouteRequest = z.object({
  organizationId: z.string().uuid(),
  telephonyConnectionId: z.string().uuid(),
  agentId: z.string().uuid(),
  address: z.string().min(1).max(255),
  countryCode: z.string().length(2).optional(),
  label: z.string().max(64).optional(),
  isDefaultCallerId: z.boolean().optional().default(false),
});

function dograhWorkflowId(deploymentId: string) {
  const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
  if (!match) throw new Error("INVALID_DOGRAH_DEPLOYMENT_ID");
  return Number(match[1]);
}

export async function POST(request: Request) {
  let remotePhoneNumberId: number | null = null;
  let remoteConfigId: string | null = null;
  let adapter: DograhTelephonyAdapter | null = null;

  try {
    const payload = CreatePhoneRouteRequest.parse(await request.json());
    await requireOrganizationAdmin(payload.organizationId, request.headers);

    const connectionResult = await query<{ id: string; provider: string; external_config_id: string; status: string }>(
      `select id, provider, external_config_id, status from telephony_connections
        where id = $1 and organization_id = $2 and provider = 'twilio' limit 1`,
      [payload.telephonyConnectionId, payload.organizationId],
    );
    const connection = connectionResult.rows[0];
    if (!connection || connection.status !== "active") throw new Error("TELEPHONY_CONNECTION_NOT_ACTIVE");

    const agentResult = await query<{ id: string; status: string }>(
      `select id, status from agents where id = $1 and organization_id = $2 limit 1`,
      [payload.agentId, payload.organizationId],
    );
    if (!agentResult.rows[0]) throw new Error("AGENT_NOT_FOUND");

    const deploymentResult = await query<{ external_deployment_id: string; status: string; created_at: string }>(
      `select external_deployment_id, status, created_at from runtime_deployments
        where agent_id = $1 and organization_id = $2 and provider = 'dograh' and status = 'ready'
        order by created_at desc limit 1`,
      [payload.agentId, payload.organizationId],
    );
    const deployment = deploymentResult.rows[0];
    if (!deployment) throw new Error("AGENT_NOT_DEPLOYED");

    const workflowId = dograhWorkflowId(deployment.external_deployment_id);
    const runtime = await resolveDograhConnection(payload.organizationId);
    adapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);
    remoteConfigId = connection.external_config_id;

    const remote = await adapter.addPhoneNumber({
      configurationId: connection.external_config_id,
      address: payload.address,
      countryCode: payload.countryCode,
      label: payload.label,
      inboundWorkflowId: workflowId,
      isDefaultCallerId: payload.isDefaultCallerId,
    });
    remotePhoneNumberId = remote.id;

    const persistedResult = await query<{
      id: string; address: string; label: string | null; agent_id: string | null; is_active: boolean; is_default_caller_id: boolean; provider_sync_ok: boolean | null; provider_sync_message: string | null; created_at: string;
    }>(
      `insert into phone_number_routes
        (organization_id, telephony_connection_id, external_phone_number_id, address, label, agent_id,
         external_workflow_id, is_active, is_default_caller_id, provider_sync_ok, provider_sync_message)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id,address,label,agent_id,is_active,is_default_caller_id,provider_sync_ok,provider_sync_message,created_at`,
      [
        payload.organizationId,
        connection.id,
        String(remote.id),
        remote.address,
        remote.label ?? null,
        payload.agentId,
        String(workflowId),
        remote.is_active,
        remote.is_default_caller_id,
        remote.provider_sync?.ok ?? null,
        remote.provider_sync?.message ?? null,
      ],
    );

    remotePhoneNumberId = null;
    return NextResponse.json({
      route: persistedResult.rows[0],
      providerSync: remote.provider_sync ?? null,
      live: remote.provider_sync?.ok !== false,
    }, { status: 201 });
  } catch (error) {
    if (remotePhoneNumberId && remoteConfigId && adapter) {
      try { await adapter.deletePhoneNumber(remoteConfigId, remotePhoneNumberId); } catch { /* preserve root failure */ }
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_PHONE_ROUTE", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")
      ? 503
      : ["AGENT_NOT_FOUND", "AGENT_NOT_DEPLOYED", "TELEPHONY_CONNECTION_NOT_ACTIVE"].includes(message)
        ? 409
        : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
