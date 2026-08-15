import { NextResponse } from "next/server";
import { z } from "zod";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
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
    const { supabase } = await requireOrganizationAdmin(payload.organizationId);

    const { data: connection, error: connectionError } = await supabase
      .from("telephony_connections")
      .select("id,provider,external_config_id,status")
      .eq("id", payload.telephonyConnectionId)
      .eq("organization_id", payload.organizationId)
      .eq("provider", "twilio")
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection || connection.status !== "active") throw new Error("TELEPHONY_CONNECTION_NOT_ACTIVE");

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,status")
      .eq("id", payload.agentId)
      .eq("organization_id", payload.organizationId)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) throw new Error("AGENT_NOT_FOUND");

    const { data: deployment, error: deploymentError } = await supabase
      .from("runtime_deployments")
      .select("external_deployment_id,status,created_at")
      .eq("agent_id", payload.agentId)
      .eq("organization_id", payload.organizationId)
      .eq("provider", "dograh")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
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

    const { data: persisted, error: persistenceError } = await supabase
      .from("phone_number_routes")
      .insert({
        organization_id: payload.organizationId,
        telephony_connection_id: connection.id,
        external_phone_number_id: String(remote.id),
        address: remote.address,
        label: remote.label,
        agent_id: payload.agentId,
        external_workflow_id: String(workflowId),
        is_active: remote.is_active,
        is_default_caller_id: remote.is_default_caller_id,
        provider_sync_ok: remote.provider_sync?.ok ?? null,
        provider_sync_message: remote.provider_sync?.message ?? null,
      })
      .select("id,address,label,agent_id,is_active,is_default_caller_id,provider_sync_ok,provider_sync_message,created_at")
      .single();
    if (persistenceError) throw persistenceError;

    remotePhoneNumberId = null;
    return NextResponse.json({
      route: persisted,
      providerSync: remote.provider_sync ?? null,
      live: remote.provider_sync?.ok !== false,
    }, { status: 201 });
  } catch (error) {
    if (remotePhoneNumberId && remoteConfigId && adapter) {
      try {
        await adapter.deletePhoneNumber(remoteConfigId, remotePhoneNumberId);
      } catch {
        // Preserve the root error; reconciliation can remove the orphan later.
      }
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
