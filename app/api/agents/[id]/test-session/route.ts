import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { AgentConfigSchema } from "@/lib/domain";
import { hasDatabaseUrl, query } from "@/lib/db";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { provisionDograhWorkflowTools, rollbackProvisionedDograhTools } from "@/lib/runtime-tools";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const RegisterRunRequest = z.object({
  sessionId: z.string().uuid(),
  runId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
});

function allowedOrigin(request: Request) {
  const raw = request.headers.get("origin") || process.env.YOURAGENT_PUBLIC_URL || process.env.BETTER_AUTH_URL || "";
  if (!raw) throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_APP_ORIGIN");
  return url.origin;
}

function serviceUnavailable(message: string) {
  return message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") ||
    message === "DATABASE_NOT_CONFIGURED" ||
    message === "BACKEND_NOT_CONFIGURED" ||
    message === "APP_ORIGIN_NOT_CONFIGURED";
}

function createdToolUuidsFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as Record<string, unknown>).created_tool_uuids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

async function requireUser(request: Request) {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) throw new Error("BACKEND_NOT_CONFIGURED");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session.user;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let previewDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;
  let toolAdapter: DograhToolAdapter | null = null;
  let createdToolUuids: string[] = [];

  try {
    const user = await requireUser(request);
    const agent = (await query<{ id: string; organization_id: string; current_version: number }>(
      `select a.id, a.organization_id, a.current_version
         from agents a join organization_members m on m.organization_id = a.organization_id
        where a.id = $1 and m.user_id = $2 limit 1`,
      [id, user.id],
    )).rows[0];
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });

    const version = (await query<{ version: number; config: unknown }>(
      `select version, config from agent_versions where agent_id = $1 and version = $2 limit 1`,
      [id, agent.current_version],
    )).rows[0];
    if (!version) return NextResponse.json({ error: "AGENT_VERSION_NOT_FOUND" }, { status: 409 });

    const config = AgentConfigSchema.parse(version.config);
    const runtime = await resolveDograhConnection(agent.organization_id);
    adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    const provisioned = await provisionDograhWorkflowTools(config, toolAdapter);
    createdToolUuids = provisioned.createdToolUuids;

    const preview = await adapter.deployPreview(config, { toolBindings: provisioned.bindings });
    previewDeploymentId = preview.deploymentId;
    const origin = allowedOrigin(request);
    const embed = await adapter.createEmbedToken(preview.deploymentId, {
      allowedDomains: [origin], usageLimit: 5, expiresInDays: 1,
      settings: { widgetType: "voice", embedMode: "headless", autoStart: false, buttonText: "Test agent" },
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const session = (await query<{ id: string; expires_at: string }>(
      `insert into runtime_test_sessions
        (organization_id, agent_id, agent_version, created_by, provider, external_deployment_id, status, expires_at, metadata)
       values ($1,$2,$3,$4,'dograh',$5,'created',$6,$7::jsonb)
       returning id, expires_at`,
      [agent.organization_id, id, version.version, user.id, preview.deploymentId, expiresAt, JSON.stringify({ tool_bindings: provisioned.bindings, created_tool_uuids: createdToolUuids, runtime_source: runtime.source })],
    )).rows[0];

    previewDeploymentId = null;
    createdToolUuids = [];
    return NextResponse.json({
      testSession: { id: session.id, expiresAt: session.expires_at, scriptSrc: embed.scriptSrc, dograhEmbedTokenExpiresAt: embed.expiresAt },
    }, { status: 201 });
  } catch (error) {
    if (previewDeploymentId && adapter) {
      try { await adapter.pause(previewDeploymentId); } catch { /* reconciliation can archive orphan */ }
    }
    if (createdToolUuids.length && toolAdapter) await rollbackProvisionedDograhTools(toolAdapter, createdToolUuids);
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "UNAUTHENTICATED" ? 401 : serviceUnavailable(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const payload = RegisterRunRequest.parse(await request.json());
    const user = await requireUser(request);
    const session = (await query<{ id: string }>(
      `select id from runtime_test_sessions
        where id = $1 and agent_id = $2 and created_by = $3
          and status in ('created','active') and expires_at > now()
        limit 1`,
      [payload.sessionId, id, user.id],
    )).rows[0];
    if (!session) return NextResponse.json({ error: "TEST_SESSION_NOT_ACTIVE" }, { status: 409 });

    await query(`update runtime_test_sessions set workflow_run_id = $1, status = 'active', updated_at = now() where id = $2`, [String(payload.runId), session.id]);
    return NextResponse.json({ status: "active", runId: String(payload.runId) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_RUN_REGISTRATION", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : serviceUnavailable(message) ? 503 : 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "MISSING_TEST_SESSION" }, { status: 400 });

  try {
    const user = await requireUser(request);
    const session = (await query<{
      id: string; organization_id: string; agent_id: string; agent_version: number; external_deployment_id: string;
      status: string; created_by: string; workflow_run_id: string | null; metadata: Record<string, unknown> | null;
    }>(
      `select id, organization_id, agent_id, agent_version, external_deployment_id, status, created_by, workflow_run_id, metadata
         from runtime_test_sessions where id = $1 and agent_id = $2 and created_by = $3 limit 1`,
      [sessionId, id, user.id],
    )).rows[0];
    if (!session) return NextResponse.json({ error: "TEST_SESSION_NOT_FOUND" }, { status: 404 });

    const runtime = await resolveDograhConnection(session.organization_id);
    const adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    const toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    const createdToolUuids = createdToolUuidsFromMetadata(session.metadata);
    let callIngested = false;
    let warning: string | null = session.workflow_run_id ? null : "NO_RUNTIME_RUN_REGISTERED";

    if (session.workflow_run_id) {
      try {
        const run = await fetchDograhRun({ deploymentId: session.external_deployment_id, runId: session.workflow_run_id, baseUrl: runtime.baseUrl, apiKey: runtime.apiKey });
        const callMetadata = JSON.stringify({ mode: run.mode, initial_context: run.initial_context ?? null, annotations: run.annotations ?? null, runtime_source: runtime.source });
        await query(
          `insert into calls
            (organization_id, agent_id, agent_version, provider_call_id, runtime_provider, external_run_id, direction, status,
             started_at, transcript_url, recording_url, cost_info, usage_info, gathered_context, is_test, metadata)
           values ($1,$2,$3,$4,'dograh',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,true,$13::jsonb)
           on conflict (organization_id, runtime_provider, external_run_id)
             where runtime_provider is not null and external_run_id is not null
           do update set status = excluded.status, transcript_url = excluded.transcript_url, recording_url = excluded.recording_url,
             cost_info = excluded.cost_info, usage_info = excluded.usage_info, gathered_context = excluded.gathered_context, metadata = excluded.metadata`,
          [session.organization_id, session.agent_id, session.agent_version, String(run.id), run.call_type, run.is_completed ? "completed" : "in_progress", run.created_at, run.transcript_public_url ?? run.transcript_url ?? null, run.recording_public_url ?? run.recording_url ?? null, JSON.stringify(run.cost_info ?? null), JSON.stringify(run.usage_info ?? null), JSON.stringify(run.gathered_context ?? null), callMetadata],
        );
        callIngested = true;
      } catch (error) {
        warning = error instanceof Error ? error.message : "CALL_INGESTION_FAILED";
      }
    }

    if (session.status !== "completed" && session.status !== "expired") {
      try { await adapter.pause(session.external_deployment_id); } catch (error) { warning = warning ?? (error instanceof Error ? error.message : "PREVIEW_ARCHIVE_FAILED"); }
    }
    if (createdToolUuids.length) {
      const results = await Promise.allSettled(createdToolUuids.map((toolUuid) => toolAdapter.archiveTool(toolUuid)));
      if (results.some((result) => result.status === "rejected")) warning = warning ?? "PREVIEW_TOOL_CLEANUP_FAILED";
    }

    const finalStatus = warning || !callIngested ? "failed" : "completed";
    const finalWarning = warning ?? (!callIngested ? "RUNTIME_CALL_NOT_INGESTED" : null);
    await query(`update runtime_test_sessions set status = $1, last_error = $2, updated_at = now() where id = $3`, [finalStatus, finalWarning, session.id]);
    return NextResponse.json({ status: finalStatus, callIngested, warning: finalWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : serviceUnavailable(message) ? 503 : 500 });
  }
}
