import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentConfigSchema } from "@/lib/domain";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { provisionDograhWorkflowTools, rollbackProvisionedDograhTools } from "@/lib/runtime-tools";
import { resolveDograhConnection } from "@/lib/runtime-connection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RegisterRunRequest = z.object({
  sessionId: z.string().uuid(),
  runId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
});

function allowedOrigin(request: Request) {
  const raw = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
  if (!raw) throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_APP_ORIGIN");
  return url.origin;
}

function serviceUnavailable(message: string) {
  return message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") ||
    message === "SUPABASE_NOT_CONFIGURED" ||
    message === "APP_ORIGIN_NOT_CONFIGURED";
}

function createdToolUuidsFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as Record<string, unknown>).created_tool_uuids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let previewDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;
  let toolAdapter: DograhToolAdapter | null = null;
  let createdToolUuids: string[] = [];

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,organization_id,current_version")
      .eq("id", id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });

    const { data: version, error: versionError } = await supabase
      .from("agent_versions")
      .select("version,config")
      .eq("agent_id", id)
      .eq("version", agent.current_version)
      .maybeSingle();
    if (versionError) throw versionError;
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
      allowedDomains: [origin],
      usageLimit: 5,
      expiresInDays: 1,
      settings: {
        widgetType: "voice",
        embedMode: "headless",
        autoStart: false,
        buttonText: "Test agent",
      },
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: session, error: sessionError } = await supabase
      .from("runtime_test_sessions")
      .insert({
        organization_id: agent.organization_id,
        agent_id: id,
        agent_version: version.version,
        created_by: auth.user.id,
        provider: "dograh",
        external_deployment_id: preview.deploymentId,
        status: "created",
        expires_at: expiresAt,
        metadata: {
          tool_bindings: provisioned.bindings,
          created_tool_uuids: createdToolUuids,
          runtime_source: runtime.source,
        },
      })
      .select("id,expires_at")
      .single();
    if (sessionError) throw sessionError;

    previewDeploymentId = null;
    createdToolUuids = [];
    return NextResponse.json({
      testSession: {
        id: session.id,
        expiresAt: session.expires_at,
        scriptSrc: embed.scriptSrc,
        dograhEmbedTokenExpiresAt: embed.expiresAt,
      },
    }, { status: 201 });
  } catch (error) {
    if (previewDeploymentId && adapter) {
      try {
        await adapter.pause(previewDeploymentId);
      } catch {
        // Preserve the root error. A reconciliation task can archive the orphan later.
      }
    }
    if (createdToolUuids.length && toolAdapter) {
      await rollbackProvisionedDograhTools(toolAdapter, createdToolUuids);
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: serviceUnavailable(message) ? 503 : 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const payload = RegisterRunRequest.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: session, error: sessionError } = await supabase
      .from("runtime_test_sessions")
      .select("id")
      .eq("id", payload.sessionId)
      .eq("agent_id", id)
      .eq("created_by", auth.user.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return NextResponse.json({ error: "TEST_SESSION_NOT_FOUND" }, { status: 404 });

    const { error: updateError } = await supabase
      .from("runtime_test_sessions")
      .update({
        workflow_run_id: String(payload.runId),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return NextResponse.json({ status: "active", runId: String(payload.runId) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_RUN_REGISTRATION", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: message === "SUPABASE_NOT_CONFIGURED" ? 503 : 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "MISSING_TEST_SESSION" }, { status: 400 });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: session, error: sessionError } = await supabase
      .from("runtime_test_sessions")
      .select("id,organization_id,agent_id,agent_version,external_deployment_id,status,created_by,workflow_run_id,metadata")
      .eq("id", sessionId)
      .eq("agent_id", id)
      .eq("created_by", auth.user.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return NextResponse.json({ error: "TEST_SESSION_NOT_FOUND" }, { status: 404 });

    const runtime = await resolveDograhConnection(session.organization_id);
    const adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    const toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    const createdToolUuids = createdToolUuidsFromMetadata(session.metadata);
    let callIngested = false;
    let warning: string | null = null;

    if (session.workflow_run_id) {
      try {
        const run = await fetchDograhRun({
          deploymentId: session.external_deployment_id,
          runId: session.workflow_run_id,
          baseUrl: runtime.baseUrl,
          apiKey: runtime.apiKey,
        });

        const callPayload = {
          organization_id: session.organization_id,
          agent_id: session.agent_id,
          agent_version: session.agent_version,
          provider_call_id: String(run.id),
          runtime_provider: "dograh",
          external_run_id: String(run.id),
          direction: run.call_type,
          status: run.is_completed ? "completed" : "in_progress",
          started_at: run.created_at,
          transcript_url: run.transcript_public_url ?? run.transcript_url,
          recording_url: run.recording_public_url ?? run.recording_url,
          cost_info: run.cost_info,
          usage_info: run.usage_info ?? null,
          gathered_context: run.gathered_context ?? null,
          is_test: true,
          metadata: {
            mode: run.mode,
            initial_context: run.initial_context ?? null,
            annotations: run.annotations ?? null,
            runtime_source: runtime.source,
          },
        };

        const { data: existingCall, error: existingCallError } = await supabase
          .from("calls")
          .select("id")
          .eq("runtime_provider", "dograh")
          .eq("external_run_id", String(run.id))
          .maybeSingle();
        if (existingCallError) throw existingCallError;

        const write = existingCall
          ? await supabase.from("calls").update(callPayload).eq("id", existingCall.id)
          : await supabase.from("calls").insert(callPayload);
        if (write.error) throw write.error;
        callIngested = true;
      } catch (error) {
        warning = error instanceof Error ? error.message : "CALL_INGESTION_FAILED";
      }
    }

    if (session.status !== "completed" && session.status !== "expired") {
      try {
        await adapter.pause(session.external_deployment_id);
      } catch (error) {
        warning = warning ?? (error instanceof Error ? error.message : "PREVIEW_ARCHIVE_FAILED");
      }
    }

    if (createdToolUuids.length) {
      const results = await Promise.allSettled(createdToolUuids.map((toolUuid) => toolAdapter.archiveTool(toolUuid)));
      if (results.some((result) => result.status === "rejected")) {
        warning = warning ?? "PREVIEW_TOOL_CLEANUP_FAILED";
      }
    }

    const { error: updateError } = await supabase
      .from("runtime_test_sessions")
      .update({
        status: warning ? "failed" : "completed",
        last_error: warning,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return NextResponse.json({ status: warning ? "failed" : "completed", callIngested, warning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: serviceUnavailable(message) ? 503 : 500 });
  }
}
