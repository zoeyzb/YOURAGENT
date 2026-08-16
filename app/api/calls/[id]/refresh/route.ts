import { NextResponse } from "next/server";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { resolveDograhConnection } from "@/lib/runtime-connection";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const callResult = await query<{
      id: string;
      organization_id: string;
      agent_id: string;
      agent_version: number;
      runtime_provider: string | null;
      external_run_id: string | null;
      metadata: Record<string, unknown> | null;
    }>(`select id, organization_id, agent_id, agent_version, runtime_provider, external_run_id, metadata from calls where id = $1 limit 1`, [id]);
    const call = callResult.rows[0];
    if (!call) return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });

    await requireOrganizationAdmin(call.organization_id, request.headers);
    if (call.runtime_provider !== "dograh") return NextResponse.json({ error: "UNSUPPORTED_RUNTIME_PROVIDER" }, { status: 409 });
    if (!call.external_run_id) return NextResponse.json({ error: "CALL_RUN_NOT_REGISTERED" }, { status: 409 });

    const deploymentResult = await query<{ external_deployment_id: string; agent_version: number; created_at: string }>(
      `select external_deployment_id, agent_version, created_at
         from runtime_deployments
        where organization_id = $1 and agent_id = $2 and agent_version = $3 and provider = 'dograh'
        order by created_at desc limit 1`,
      [call.organization_id, call.agent_id, call.agent_version],
    );
    const deployment = deploymentResult.rows[0];
    if (!deployment) return NextResponse.json({ error: "DEPLOYMENT_NOT_FOUND" }, { status: 409 });

    const runtime = await resolveDograhConnection(call.organization_id);
    const run = await fetchDograhRun({
      deploymentId: deployment.external_deployment_id,
      runId: call.external_run_id,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });

    const metadata = {
      ...(call.metadata ?? {}),
      mode: run.mode,
      initial_context: run.initial_context ?? null,
      annotations: run.annotations ?? null,
      reconciled_at: new Date().toISOString(),
      runtime_source: runtime.source,
    };
    const updatedResult = await query<{
      id: string;
      status: string;
      external_run_id: string | null;
      transcript_url: string | null;
      recording_url: string | null;
      cost_info: Record<string, unknown> | null;
      usage_info: Record<string, unknown> | null;
      gathered_context: Record<string, unknown> | null;
      ended_at: string | null;
    }>(
      `update calls set
         provider_call_id = $1,
         external_run_id = $1,
         direction = $2,
         status = $3,
         transcript_url = $4,
         recording_url = $5,
         cost_info = $6::jsonb,
         usage_info = $7::jsonb,
         gathered_context = $8::jsonb,
         ended_at = $9,
         metadata = $10::jsonb
       where id = $11
       returning id, status, external_run_id, transcript_url, recording_url, cost_info, usage_info, gathered_context, ended_at`,
      [
        String(run.id), run.call_type, run.is_completed ? "completed" : "in_progress",
        run.transcript_public_url ?? run.transcript_url ?? null,
        run.recording_public_url ?? run.recording_url ?? null,
        JSON.stringify(run.cost_info ?? null), JSON.stringify(run.usage_info ?? null), JSON.stringify(run.gathered_context ?? null),
        run.is_completed ? new Date().toISOString() : null, JSON.stringify(metadata), call.id,
      ],
    );

    return NextResponse.json({ call: updatedResult.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")) return NextResponse.json({ error: message }, { status: 503 });
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
