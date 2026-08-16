import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { query } from "@/lib/db";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const WebhookSignal = z.object({
  workflow_run_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  workflow_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  youragent_call_id: z.string().optional().nullable(),
}).passthrough();

type ExistingCallRow = { id: string; metadata: Record<string, unknown> | null };

export async function POST(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length < 32) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const deployment = (await query<{
      id: string; organization_id: string; agent_id: string; agent_version: number; external_deployment_id: string; webhook_token_hash: string | null;
    }>(
      `select id, organization_id, agent_id, agent_version, external_deployment_id, webhook_token_hash
         from runtime_deployments where provider = 'dograh' and webhook_token_hash = $1 limit 1`,
      [tokenHash],
    )).rows[0];
    if (!deployment) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const signal = WebhookSignal.parse(await request.json());
    const workflowId = Number(signal.workflow_id);
    const expectedWorkflowId = Number(deployment.external_deployment_id.replace(/^dograh-workflow:/, ""));
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
    if (run.workflow_id !== expectedWorkflowId) return NextResponse.json({ error: "RUN_WORKFLOW_MISMATCH" }, { status: 403 });

    let existingCall: ExistingCallRow | null = null;
    if (signal.youragent_call_id && z.string().uuid().safeParse(signal.youragent_call_id).success) {
      existingCall = (await query<ExistingCallRow>(
        `select id, metadata from calls where id = $1 and organization_id = $2 and agent_id = $3 limit 1`,
        [signal.youragent_call_id, deployment.organization_id, deployment.agent_id],
      )).rows[0] ?? null;
    }
    if (!existingCall) {
      existingCall = (await query<ExistingCallRow>(
        `select id, metadata from calls where runtime_provider = 'dograh' and external_run_id = $1 limit 1`,
        [String(run.id)],
      )).rows[0] ?? null;
    }

    const metadata = {
      ...(existingCall?.metadata ?? {}),
      mode: run.mode,
      initial_context: run.initial_context ?? null,
      annotations: run.annotations ?? null,
      webhook_received_at: new Date().toISOString(),
      runtime_source: runtime.source,
    };
    const values = [
      deployment.organization_id,
      deployment.agent_id,
      deployment.agent_version,
      String(run.id),
      run.call_type,
      run.is_completed ? "completed" : "in_progress",
      run.created_at,
      run.is_completed ? new Date().toISOString() : null,
      run.transcript_public_url ?? run.transcript_url ?? null,
      run.recording_public_url ?? run.recording_url ?? null,
      JSON.stringify(run.cost_info ?? null),
      JSON.stringify(run.usage_info ?? null),
      JSON.stringify(run.gathered_context ?? null),
      JSON.stringify(metadata),
    ];

    if (existingCall) {
      await query(
        `update calls set
           organization_id=$1, agent_id=$2, agent_version=$3, provider_call_id=$4, runtime_provider='dograh', external_run_id=$4,
           direction=$5, status=$6, started_at=$7, ended_at=$8, transcript_url=$9, recording_url=$10,
           cost_info=$11::jsonb, usage_info=$12::jsonb, gathered_context=$13::jsonb, is_test=false, metadata=$14::jsonb
         where id=$15`,
        [...values, existingCall.id],
      );
      return NextResponse.json({ ok: true, callId: existingCall.id, updated: true });
    }

    const callId = randomUUID();
    await query(
      `insert into calls
        (id, organization_id, agent_id, agent_version, provider_call_id, runtime_provider, external_run_id, direction, status,
         started_at, ended_at, transcript_url, recording_url, cost_info, usage_info, gathered_context, is_test, metadata)
       values ($15,$1,$2,$3,$4,'dograh',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,false,$14::jsonb)`,
      [...values, callId],
    );
    return NextResponse.json({ ok: true, callId, created: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_WEBHOOK_PAYLOAD" }, { status: 400 });
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") || message === "DATABASE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
