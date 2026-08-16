import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { triggerDograhOutboundCall } from "@/lib/adapters/dograh-outbound";
import { query } from "@/lib/db";
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
  dncClear: z.literal(true),
  consentNote: z.string().min(3).max(500),
});

function localHour(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
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
    const { user } = await requireOrganizationAdmin(payload.organizationId, request.headers);

    const hour = localHour(payload.timezone);
    const policy = evaluateCallPolicy({
      direction: "outbound",
      consent: payload.consent,
      doNotCall: !payload.dncClear,
      localHour: hour,
      jurisdiction: payload.jurisdiction,
    });
    if (!policy.allowed) {
      return NextResponse.json({ error: "OUTBOUND_POLICY_BLOCKED", reasons: policy.reasons }, { status: 422 });
    }

    const agent = (await query<{ id: string; organization_id: string; current_version: number; status: string }>(
      `select id, organization_id, current_version, status from agents where id = $1 and organization_id = $2 limit 1`,
      [payload.agentId, payload.organizationId],
    )).rows[0];
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    if (agent.status !== "published") throw new Error("AGENT_NOT_LIVE");

    const version = (await query<{ version: number; config: unknown }>(
      `select version, config from agent_versions where agent_id = $1 and version = $2 limit 1`,
      [agent.id, agent.current_version],
    )).rows[0];
    if (!version) throw new Error("AGENT_VERSION_NOT_FOUND");
    const config = AgentConfigSchema.parse(version.config);
    if (config.goal.direction === "inbound") throw new Error("AGENT_NOT_CONFIGURED_FOR_OUTBOUND");

    const deployment = (await query<{ external_workflow_uuid: string | null; status: string; created_at: string }>(
      `select external_workflow_uuid, status, created_at from runtime_deployments
        where organization_id = $1 and agent_id = $2 and provider = 'dograh' and status = 'ready' and external_workflow_uuid is not null
        order by created_at desc limit 1`,
      [payload.organizationId, payload.agentId],
    )).rows[0];
    if (!deployment?.external_workflow_uuid) throw new Error("OUTBOUND_WORKFLOW_UUID_MISSING");

    const phoneRoute = (await query<{
      id: string; telephony_connection_id: string; external_phone_number_id: string; address: string; is_active: boolean; provider_sync_ok: boolean | null;
    }>(
      `select id, telephony_connection_id, external_phone_number_id, address, is_active, provider_sync_ok
         from phone_number_routes where id = $1 and organization_id = $2 limit 1`,
      [payload.phoneRouteId, payload.organizationId],
    )).rows[0];
    if (!phoneRoute || !phoneRoute.is_active || phoneRoute.provider_sync_ok === false) throw new Error("CALLER_ID_NOT_ACTIVE");

    const telephony = (await query<{ external_config_id: string; status: string }>(
      `select external_config_id, status from telephony_connections where id = $1 and organization_id = $2 limit 1`,
      [phoneRoute.telephony_connection_id, payload.organizationId],
    )).rows[0];
    if (!telephony || telephony.status !== "active") throw new Error("TELEPHONY_CONNECTION_NOT_ACTIVE");

    const telephonyConfigId = Number(telephony.external_config_id);
    const fromPhoneNumberId = Number(phoneRoute.external_phone_number_id);
    if (!Number.isInteger(telephonyConfigId) || !Number.isInteger(fromPhoneNumberId)) throw new Error("INVALID_TELEPHONY_REFERENCE");

    const runtime = await resolveDograhConnection(payload.organizationId);
    const callId = randomUUID();
    const startedAt = new Date().toISOString();
    const baseMetadata = {
      target_phone_number: payload.phoneNumber,
      target_timezone: payload.timezone,
      target_local_hour: hour,
      jurisdiction: payload.jurisdiction,
      consent_note: payload.consentNote,
      consent_confirmed: payload.consent,
      do_not_call_checked: payload.dncClear,
      policy_reasons: policy.reasons,
      telephony_configuration_id: telephonyConfigId,
      from_phone_number_id: fromPhoneNumberId,
      caller_id: phoneRoute.address,
      initiated_by: user.id,
      runtime_source: runtime.source,
      dispatch_state: "pending",
    };

    await query(
      `insert into calls
        (id, organization_id, agent_id, agent_version, runtime_provider, direction, status, started_at, is_test, metadata)
       values ($1,$2,$3,$4,'dograh','outbound','dispatching',$5,false,$6::jsonb)`,
      [callId, payload.organizationId, payload.agentId, version.version, startedAt, JSON.stringify(baseMetadata)],
    );

    let triggered;
    try {
      triggered = await triggerDograhOutboundCall({
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        workflowUuid: deployment.external_workflow_uuid,
        phoneNumber: payload.phoneNumber,
        telephonyConfigurationId: telephonyConfigId,
        fromPhoneNumberId,
        initialContext: { source: "youragent_manual_outbound", youragent_call_id: callId },
      });
    } catch (dispatchError) {
      const dispatchMessage = dispatchError instanceof Error ? dispatchError.message : "DOGRAH_DISPATCH_FAILED";
      await query(
        `update calls set status = 'failed', ended_at = now(), metadata = $1::jsonb where id = $2`,
        [JSON.stringify({ ...baseMetadata, dispatch_state: "failed", dispatch_error: dispatchMessage }), callId],
      );
      throw dispatchError;
    }

    try {
      const call = (await query<{ id: string; status: string; external_run_id: string | null; started_at: string | null }>(
        `update calls set
           provider_call_id = $1,
           external_run_id = $1,
           status = $2,
           metadata = $3::jsonb
         where id = $4
         returning id, status, external_run_id, started_at`,
        [String(triggered.workflow_run_id), triggered.status, JSON.stringify({ ...baseMetadata, dispatch_state: "accepted", workflow_run_name: triggered.workflow_run_name }), callId],
      )).rows[0];
      if (!call) throw new Error("CALL_PERSISTENCE_FAILED");
      return NextResponse.json({ call }, { status: 201 });
    } catch (persistError) {
      await query(
        `update calls set status = 'dispatch_uncertain', metadata = $1::jsonb where id = $2`,
        [JSON.stringify({ ...baseMetadata, dispatch_state: "accepted_but_persistence_failed", workflow_run_id: triggered.workflow_run_id, workflow_run_name: triggered.workflow_run_name }), callId],
      );
      throw persistError;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_OUTBOUND_CALL", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "INVALID_TARGET_TIMEZONE") return NextResponse.json({ error: message }, { status: 400 });
    if ([
      "AGENT_NOT_FOUND", "AGENT_NOT_LIVE", "AGENT_NOT_CONFIGURED_FOR_OUTBOUND", "AGENT_VERSION_NOT_FOUND",
      "OUTBOUND_WORKFLOW_UUID_MISSING", "CALLER_ID_NOT_ACTIVE", "TELEPHONY_CONNECTION_NOT_ACTIVE", "INVALID_TELEPHONY_REFERENCE",
    ].includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")) return NextResponse.json({ error: message }, { status: 503 });
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
