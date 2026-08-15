import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { AgentConfigSchema } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { provisionDograhWorkflowTools, rollbackProvisionedDograhTools } from "@/lib/runtime-tools";
import { resolveDograhConnection } from "@/lib/runtime-connection";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let remoteDeploymentId: string | null = null;
  let persistedDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;
  let toolAdapter: DograhToolAdapter | null = null;
  let createdToolUuids: string[] = [];
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;

  try {
    supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,organization_id,current_version,status")
      .eq("id", id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });

    const { data: version, error: versionError } = await supabase
      .from("agent_versions")
      .select("version,status,config,config_hash")
      .eq("agent_id", id)
      .eq("version", agent.current_version)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) return NextResponse.json({ error: "AGENT_VERSION_NOT_FOUND" }, { status: 409 });

    const config = AgentConfigSchema.parse(version.config);
    const runtime = await resolveDograhConnection(agent.organization_id);
    adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);

    const localValidation = await adapter.validate(config);
    if (!localValidation.valid) {
      return NextResponse.json(
        { error: "RUNTIME_VALIDATION_FAILED", issues: localValidation.errors },
        { status: 422 },
      );
    }

    const provisioned = await provisionDograhWorkflowTools(config, toolAdapter);
    createdToolUuids = provisioned.createdToolUuids;

    const webhookToken = randomBytes(32).toString("base64url");
    const webhookTokenHash = createHash("sha256").update(webhookToken).digest("hex");
    const appOrigin = new URL(request.url).origin;
    const completionWebhookUrl = `${appOrigin}/api/webhooks/dograh?token=${encodeURIComponent(webhookToken)}`;

    const deployment = await adapter.deploy(config, {
      completionWebhookUrl,
      toolBindings: provisioned.bindings,
    });
    remoteDeploymentId = deployment.deploymentId;

    const { data: persisted, error: persistenceError } = await supabase
      .from("runtime_deployments")
      .insert({
        organization_id: agent.organization_id,
        agent_id: id,
        agent_version: version.version,
        provider: "dograh",
        external_deployment_id: deployment.deploymentId,
        external_workflow_uuid: deployment.workflowUuid,
        webhook_token_hash: webhookTokenHash,
        status: deployment.status,
        metadata: {
          runtime_source: runtime.source,
          external_organization_id: runtime.externalOrganizationId ?? null,
          completion_webhook_configured: true,
          tool_bindings: provisioned.bindings,
          created_tool_uuids: createdToolUuids,
        },
      })
      .select("id,external_deployment_id,external_workflow_uuid,status,created_at")
      .single();
    if (persistenceError) throw persistenceError;
    persistedDeploymentId = persisted.id;

    const { error: versionPublishError } = await supabase
      .from("agent_versions")
      .update({ status: "published" })
      .eq("agent_id", id)
      .eq("version", version.version);
    if (versionPublishError) throw versionPublishError;

    const { error: agentPublishError } = await supabase
      .from("agents")
      .update({ status: "published" })
      .eq("id", id);
    if (agentPublishError) throw agentPublishError;

    remoteDeploymentId = null;
    createdToolUuids = [];
    return NextResponse.json({ deployment: persisted }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (remoteDeploymentId && adapter) {
      try {
        await adapter.pause(remoteDeploymentId);
      } catch {
        // Preserve the root failure; deployment row below records reconciliation need.
      }
    }
    if (createdToolUuids.length && toolAdapter) {
      await rollbackProvisionedDograhTools(toolAdapter, createdToolUuids);
    }
    if (persistedDeploymentId && supabase) {
      await supabase
        .from("runtime_deployments")
        .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", persistedDeploymentId);
    }

    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") || message === "SUPABASE_NOT_CONFIGURED"
      ? 503
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
