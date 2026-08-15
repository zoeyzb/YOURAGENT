import { NextResponse } from "next/server";
import { AgentConfigSchema } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { resolveDograhConnection } from "@/lib/runtime-connection";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let remoteDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;

  try {
    const supabase = await createSupabaseServerClient();
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

    const localValidation = await adapter.validate(config);
    if (!localValidation.valid) {
      return NextResponse.json(
        { error: "RUNTIME_VALIDATION_FAILED", issues: localValidation.errors },
        { status: 422 },
      );
    }

    const deployment = await adapter.deploy(config);
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
        status: deployment.status,
        metadata: {
          runtime_source: runtime.source,
          external_organization_id: runtime.externalOrganizationId ?? null,
        },
      })
      .select("id,external_deployment_id,external_workflow_uuid,status,created_at")
      .single();
    if (persistenceError) throw persistenceError;

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
    return NextResponse.json({ deployment: persisted }, { status: 201 });
  } catch (error) {
    if (remoteDeploymentId && adapter) {
      try {
        await adapter.pause(remoteDeploymentId);
      } catch {
        // Preserve the original error. The orphan can be reconciled from runtime logs.
      }
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") || message === "SUPABASE_NOT_CONFIGURED"
      ? 503
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
