import { NextResponse } from "next/server";
import { AgentConfigSchema } from "@/lib/domain";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { requireDograhEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function allowedOrigin(request: Request) {
  const raw = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
  if (!raw) throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_APP_ORIGIN");
  return url.origin;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let previewDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;

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
    const { baseUrl, apiKey } = requireDograhEnv();
    adapter = new DograhAdapter(baseUrl, apiKey);

    const preview = await adapter.deployPreview(config);
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
      })
      .select("id,expires_at")
      .single();
    if (sessionError) throw sessionError;

    previewDeploymentId = null;
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

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = ["SUPABASE_NOT_CONFIGURED", "DOGRAH_NOT_CONFIGURED", "APP_ORIGIN_NOT_CONFIGURED"].includes(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
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
      .select("id,external_deployment_id,status,created_by")
      .eq("id", sessionId)
      .eq("agent_id", id)
      .eq("created_by", auth.user.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return NextResponse.json({ error: "TEST_SESSION_NOT_FOUND" }, { status: 404 });

    if (session.status !== "completed" && session.status !== "expired") {
      const { baseUrl, apiKey } = requireDograhEnv();
      const adapter = new DograhAdapter(baseUrl, apiKey);
      await adapter.pause(session.external_deployment_id);
    }

    const { error: updateError } = await supabase
      .from("runtime_test_sessions")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return NextResponse.json({ status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "SUPABASE_NOT_CONFIGURED" || message === "DOGRAH_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
