import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { resolveDograhConnection } from "@/lib/runtime-connection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const WebhookSignal = z.object({
  workflow_run_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  workflow_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  youragent_call_id: z.string().optional().nullable(),
}).passthrough();

type ExistingCallRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length < 32) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const admin = createSupabaseAdminClient();
    const { data: deployment, error: deploymentError } = await admin
      .from("runtime_deployments")
      .select("id,organization_id,agent_id,agent_version,external_deployment_id,webhook_token_hash")
      .eq("provider", "dograh")
      .eq("webhook_token_hash", tokenHash)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const signal = WebhookSignal.parse(await request.json());
    const workflowId = Number(signal.workflow_id);
    const expectedWorkflowId = Number(String(deployment.external_deployment_id).replace(/^dograh-workflow:/, ""));
    if (!Number.isInteger(expectedWorkflowId) || workflowId !== expectedWorkflowId) {
      return NextResponse.json({ error: "WORKFLOW_MISMATCH" }, { status: 403 });
    }

    const runtime = await resolveDograhConnection(deployment.organization_id);
    const run = await fetchDograhRun({
      deploymentId: deployment.external_deployment_id,
      runId: String(signal.workflow_run_id),
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });
    if (run.workflow_id !== expectedWorkflowId) {
      return NextResponse.json({ error: "RUN_WORKFLOW_MISMATCH" }, { status: 403 });
    }

    let existingCall: ExistingCallRow | null = null;
    if (signal.youragent_call_id && z.string().uuid().safeParse(signal.youragent_call_id).success) {
      const { data, error } = await admin
        .from("calls")
        .select("id,metadata")
        .eq("id", signal.youragent_call_id)
        .eq("organization_id", deployment.organization_id)
        .eq("agent_id", deployment.agent_id)
        .maybeSingle();
      if (error) throw error;
      existingCall = data ? (data as unknown as ExistingCallRow) : null;
    }

    if (!existingCall) {
      const { data, error } = await admin
        .from("calls")
        .select("id,metadata")
        .eq("runtime_provider", "dograh")
        .eq("external_run_id", String(run.id))
        .maybeSingle();
      if (error) throw error;
      existingCall = data ? (data as unknown as ExistingCallRow) : null;
    }

    const previousMetadata = existingCall?.metadata && typeof existingCall.metadata === "object"
      ? existingCall.metadata
      : {};
    const callPayload = {
      organization_id: deployment.organization_id,
      agent_id: deployment.agent_id,
      agent_version: deployment.agent_version,
      provider_call_id: String(run.id),
      runtime_provider: "dograh",
      external_run_id: String(run.id),
      direction: run.call_type,
      status: run.is_completed ? "completed" : "in_progress",
      started_at: run.created_at,
      ended_at: run.is_completed ? new Date().toISOString() : null,
      transcript_url: run.transcript_public_url ?? run.transcript_url,
      recording_url: run.recording_public_url ?? run.recording_url,
      cost_info: run.cost_info,
      usage_info: run.usage_info ?? null,
      gathered_context: run.gathered_context ?? null,
      is_test: false,
      metadata: {
        ...previousMetadata,
        mode: run.mode,
        initial_context: run.initial_context ?? null,
        annotations: run.annotations ?? null,
        webhook_received_at: new Date().toISOString(),
        runtime_source: runtime.source,
      },
    };

    if (existingCall) {
      const { error } = await admin.from("calls").update(callPayload).eq("id", existingCall.id);
      if (error) throw error;
      return NextResponse.json({ ok: true, callId: existingCall.id, updated: true });
    }

    const callId = randomUUID();
    const { error: insertError } = await admin.from("calls").insert({ id: callId, ...callPayload });
    if (insertError) throw insertError;
    return NextResponse.json({ ok: true, callId, created: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_WEBHOOK_PAYLOAD" }, { status: 400 });
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
