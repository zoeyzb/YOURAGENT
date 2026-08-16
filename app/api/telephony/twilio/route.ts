import { NextResponse } from "next/server";
import { z } from "zod";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const ConnectTwilioRequest = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(64),
  accountSid: z.string().min(10),
  authToken: z.string().min(8),
  amdEnabled: z.boolean().optional().default(false),
  isDefaultOutbound: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  let remoteConfigId: number | null = null;
  let adapter: DograhTelephonyAdapter | null = null;

  try {
    const payload = ConnectTwilioRequest.parse(await request.json());
    await requireOrganizationAdmin(payload.organizationId, request.headers);
    const runtime = await resolveDograhConnection(payload.organizationId);
    adapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);

    const remote = await adapter.createTwilioConfiguration({
      name: payload.name,
      accountSid: payload.accountSid,
      authToken: payload.authToken,
      amdEnabled: payload.amdEnabled,
      isDefaultOutbound: payload.isDefaultOutbound,
    });
    remoteConfigId = remote.id;

    const result = await query<{
      id: string; provider: string; external_config_id: string; name: string; status: string; is_default_outbound: boolean; created_at: string;
    }>(
      `insert into telephony_connections
        (organization_id, provider, external_config_id, name, status, is_default_outbound, metadata)
       values ($1, 'twilio', $2, $3, $4, $5, $6::jsonb)
       returning id, provider, external_config_id, name, status, is_default_outbound, created_at`,
      [
        payload.organizationId,
        String(remote.id),
        remote.name,
        remote.inactive ? "error" : "active",
        remote.is_default_outbound,
        JSON.stringify({ runtime_source: runtime.source, dograh_inactive: remote.inactive }),
      ],
    );

    remoteConfigId = null;
    return NextResponse.json({ connection: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (remoteConfigId && adapter) {
      try { await adapter.deleteConfiguration(remoteConfigId); } catch { /* preserve root failure */ }
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_TWILIO_CONFIGURATION", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") ? 503 : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
