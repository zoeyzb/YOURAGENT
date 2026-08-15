import { NextResponse } from "next/server";
import { z } from "zod";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
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
    const { supabase } = await requireOrganizationAdmin(payload.organizationId);
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

    const { data: persisted, error: persistenceError } = await supabase
      .from("telephony_connections")
      .insert({
        organization_id: payload.organizationId,
        provider: "twilio",
        external_config_id: String(remote.id),
        name: remote.name,
        status: remote.inactive ? "error" : "active",
        is_default_outbound: remote.is_default_outbound,
        metadata: {
          runtime_source: runtime.source,
          dograh_inactive: remote.inactive,
        },
      })
      .select("id,provider,external_config_id,name,status,is_default_outbound,created_at")
      .single();
    if (persistenceError) throw persistenceError;

    remoteConfigId = null;
    return NextResponse.json({ connection: persisted }, { status: 201 });
  } catch (error) {
    if (remoteConfigId && adapter) {
      try {
        await adapter.deleteConfiguration(remoteConfigId);
      } catch {
        // Preserve the original failure. Reconciliation can remove the orphan later.
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_TWILIO_CONFIGURATION", issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")
      ? 503
      : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
