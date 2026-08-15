import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { triggerDograhOutboundCall } from "@/lib/adapters/dograh-outbound";
import { AgentConfigSchema } from "@/lib/domain";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { evaluateCallPolicy } from "@/lib/policy";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const OutboundCallRequest = z.object({
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  phoneRouteId: z.string().uuid(),
  phoneNumber: z.string().regex(/^\+\d{8,15}$/, "Use E.164 format, e.g. +13125551234"),
  timezone: z.string().min(1),
  jurisdiction: z.string().min(2).max(64),
  consent: z.literal(true),
  consentNote: z.string().min(3).max(500),
  doNotCall: z.boolean().optional().default(false),
});

function localHour(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const value = parts.find((part) => part.type === "hour")?.value;
    const hour = value ? Number(value) : Number.NaN;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("invalid hour");
    return hour;
  } catch {
    throw new Error("INVALID_TARGET_TIMEZONE");
  }
}

export async function POST(request: Request) {
  try {
    const payload = OutboundCallRequest.parse(await request.json());
    const { supabase, user } = await requireOrganizationAdmin(payload.organizationId);

    const hour = localHour(payload.timezone);
    const policy = evaluateCallPolicy({
      direction: "outbound",
      consent: payload.consent,
      doNotCall: payload.doNotCall,
      localHour: hour,
      jurisdiction: payload.jurisdiction,
    });
    if (!policy.allowed) {
      return NextResponse.json({ error: "OUTBOUND_POLICY_BLOCKED", reasons: policy.reasons }, { status: 422 });
    }

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,organization_id,current_version,status")
      .eq("id", payload.agentId)
      .eq("organization_id", payload.organizationId)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    if (agent.status !== "published") throw new Error("AGENT_NOT_LIVE");

    const { data: version, error: versionError } = await supabase
      .from("agent_versions")
      .select("version,config")
      .eq("agent_id", agent.id)
      .eq("version", agent.current_version)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) throw new Error("AGENT_VERSION_NOT_FOUND");
    const config = AgentConfigSchema.parse(version.config);
    if (config.goal.direction === "inbound") throw new Error("AGENT_NOT_CONFIGURED_FOR_OUTBOUND");

    const { data: deployment, error: deploymentError } = await supabase
      .from("runtime_deployments")
      .select("external_workflow_uuid,status,created_at")
      .eq("organization_id", payload.organizationId)
      .eq("agent_id", payload.agentId)
      .eq("provider", "dograh")
      .eq("status", "ready")
      .not("external_workflow_uuid", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment?.external_workflow_uuid) throw new Error("OUTBOUND_WORKFLOW_UUID_MISSING");

    const { data: phoneRoute, error: phoneRouteError } = await supabase
      .from("phone_number_routes")
      .select("id,telephony_connection_id,external_phone_number_id,address,is_active,provider_sync_ok")
      .eq("id", payload.phoneRouteId)
      .eq("organization_id", payload.organizationId)
      .maybeSingle();
    if (phoneRouteError) throw phoneRouteError;
    if (!phoneRoute || !phoneRoute.is_active || phoneRoute.provider_sync_ok === false) throw new Error("CALLER_ID_NOT_ACTIVE");

    const { data: telephony, error: telephonyError } = await supabase
      .from("telephony_connections")
      .select("external_config_id,status")
      .eq("id", phoneRoute.telephony_connection_id)
      .eq("organization_id", payload.organizationId)
      .maybeSingle();
    if (telephonyError) throw telephonyError;
    if (!telephony || telephony.status !== "active") throw new Error("TELEPHONY_CONNECTION_NOT_ACTIVE");

    const telephonyConfigId = Number(telephony.external_config_id);
    const fromPhoneNumberId = Number(phoneRoute.external_phone_number_id);
    if (!Number.isInteger(telephonyConfigId) || !Number.isInteger(fromPhoneNumberId)) throw new Error("INVALID_TELEPHONY_REFERENCE");

    const runtime = await resolveDograhConnection(payload.organizationId);
    const callId = randomUUID();
    const triggered = await triggerDograhOutboundCall({
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      workflowUuid: deployment.external_workflow_uuid,
      phoneNumber: payload.phoneNumber,
      telephonyConfigurationId: telephonyConfigId,
      fromPhoneNumberId,
      initialContext: {
        source: "youragent_manual_outbound",
        youragent_call_id: callId,
      },
    });

    const { data: call, error: callError } = await supabase
      .from("calls")
      .insert({
        id: callId,
        organization_id: payload.organizationId,
        agent_id: payload.agentId,
        agent_version: version.version,
        provider_call_id: String(triggered.workflow_run_id),
        runtime_provider: "dograh",
        external_run_id: String(triggered.workflow_run_id),
        direction: "outbound",
        status: triggered.status,
        started_at: new Date().toISOString(),
        is_test: false,
        metadata: {
          workflow_run_name: triggered.workflow_run_name,
          target_phone_number: payload.phoneNumber,
          target_timezone: payload.timezone,
          target_local_hour: hour,
          jurisdiction: payload.jurisdiction,
          consent_note: payload.consentNote,
          do_not_call_checked: !payload.doNotCall,
          policy_reasons: policy.reasons,
          telephony_configuration_id: telephonyConfigId,
          from_phone_number_id: fromPhoneNumberId,
          caller_id: phoneRoute.address,
          initiated_by: user.id,
          runtime_source: runtime.source,
        },
      })
      .select("id,status,external_run_id,started_at")
      .single();
    if (callError) throw callError;

    return NextResponse.json({ call }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_OUTBOUND_CALL", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (["INVALID_TARGET_TIMEZONE"].includes(message)) return NextResponse.json({ error: message }, { status: 400 });
    if ([
      "AGENT_NOT_FOUND",
      "AGENT_NOT_LIVE",
      "AGENT_NOT_CONFIGURED_FOR_OUTBOUND",
      "AGENT_VERSION_NOT_FOUND",
      "OUTBOUND_WORKFLOW_UUID_MISSING",
      "CALLER_ID_NOT_ACTIVE",
      "TELEPHONY_CONNECTION_NOT_ACTIVE",
      "INVALID_TELEPHONY_REFERENCE",
    ].includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")) return NextResponse.json({ error: message }, { status: 503 });
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
