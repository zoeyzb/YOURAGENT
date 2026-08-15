import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { AgentConfigSchema } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { provisionDograhWorkflowTools, rollbackProvisionedDograhTools } from "@/lib/runtime-tools";
import { resolveDograhConnection } from "@/lib/runtime-connection";

type DeploymentRow = {
  id: string;
  external_deployment_id: string;
  agent_version: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type PhoneRouteRow = {
  id: string;
  telephony_connection_id: string;
  external_phone_number_id: string;
  external_workflow_id: string | null;
  label: string | null;
  is_active: boolean;
};

type TelephonyConnectionRow = {
  id: string;
  external_config_id: string;
  status: string;
};

type SwitchedRoute = {
  route: PhoneRouteRow;
  configurationId: string;
  oldWorkflowId: number;
};

function workflowId(deploymentId: string) {
  const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
  if (!match) throw new Error("INVALID_DOGRAH_DEPLOYMENT_ID");
  return Number(match[1]);
}

function createdTools(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.created_tool_uuids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

async function rollbackPhoneRoutes(
  telephonyAdapter: DograhTelephonyAdapter,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  switched: SwitchedRoute[],
) {
  for (const item of [...switched].reverse()) {
    try {
      const restored = await telephonyAdapter.updatePhoneNumber({
        configurationId: item.configurationId,
        phoneNumberId: item.route.external_phone_number_id,
        inboundWorkflowId: item.oldWorkflowId,
        label: item.route.label,
        isActive: item.route.is_active,
      });
      await supabase
        .from("phone_number_routes")
        .update({
          external_workflow_id: String(item.oldWorkflowId),
          provider_sync_ok: restored.provider_sync?.ok ?? null,
          provider_sync_message: restored.provider_sync?.message ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.route.id);
    } catch {
      await supabase
        .from("phone_number_routes")
        .update({
          provider_sync_ok: false,
          provider_sync_message: "Automatic rollback failed; provider reconciliation required",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.route.id);
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let remoteDeploymentId: string | null = null;
  let persistedDeploymentId: string | null = null;
  let adapter: DograhAdapter | null = null;
  let toolAdapter: DograhToolAdapter | null = null;
  let telephonyAdapter: DograhTelephonyAdapter | null = null;
  let createdToolUuids: string[] = [];
  let switchedRoutes: SwitchedRoute[] = [];
  let previousDeployment: DeploymentRow | null = null;
  let previousPaused = false;
  let versionPublished = false;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let deployingVersion: number | null = null;

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
    deployingVersion = version.version;

    const { data: priorDeploymentData, error: priorDeploymentError } = await supabase
      .from("runtime_deployments")
      .select("id,external_deployment_id,agent_version,metadata,created_at")
      .eq("organization_id", agent.organization_id)
      .eq("agent_id", id)
      .eq("provider", "dograh")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorDeploymentError) throw priorDeploymentError;
    const priorDeployment = priorDeploymentData as DeploymentRow | null;
    previousDeployment = priorDeployment;

    if (priorDeployment && priorDeployment.agent_version === version.version) {
      return NextResponse.json({
        error: "VERSION_ALREADY_DEPLOYED",
        deploymentId: priorDeployment.id,
      }, { status: 409 });
    }

    const config = AgentConfigSchema.parse(version.config);
    const runtime = await resolveDograhConnection(agent.organization_id);
    adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    telephonyAdapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);

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
    const newWorkflowId = workflowId(deployment.deploymentId);

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
          replaces_deployment_id: priorDeployment?.id ?? null,
        },
      })
      .select("id,external_deployment_id,external_workflow_uuid,status,created_at")
      .single();
    if (persistenceError) throw persistenceError;
    persistedDeploymentId = persisted.id;

    if (priorDeployment) {
      const oldWorkflowId = workflowId(priorDeployment.external_deployment_id);
      const { data: routesData, error: routesError } = await supabase
        .from("phone_number_routes")
        .select("id,telephony_connection_id,external_phone_number_id,external_workflow_id,label,is_active")
        .eq("organization_id", agent.organization_id)
        .eq("agent_id", id)
        .eq("is_active", true);
      if (routesError) throw routesError;
      const routes = (routesData ?? []) as PhoneRouteRow[];

      const connectionIds = [...new Set(routes.map((route) => route.telephony_connection_id))];
      let connections: TelephonyConnectionRow[] = [];
      if (connectionIds.length) {
        const { data: connectionData, error: connectionError } = await supabase
          .from("telephony_connections")
          .select("id,external_config_id,status")
          .eq("organization_id", agent.organization_id)
          .in("id", connectionIds);
        if (connectionError) throw connectionError;
        connections = (connectionData ?? []) as TelephonyConnectionRow[];
      }
      const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

      for (const route of routes) {
        const connection = connectionById.get(route.telephony_connection_id);
        if (!connection || connection.status !== "active") throw new Error(`PHONE_ROUTE_CONNECTION_INACTIVE:${route.id}`);
        const moved = await telephonyAdapter.updatePhoneNumber({
          configurationId: connection.external_config_id,
          phoneNumberId: route.external_phone_number_id,
          inboundWorkflowId: newWorkflowId,
          label: route.label,
          isActive: route.is_active,
        });
        if (moved.provider_sync?.ok === false) {
          throw new Error(`PHONE_ROUTE_PROVIDER_SYNC_FAILED:${route.id}:${moved.provider_sync.message ?? "unknown"}`);
        }

        const { error: routeUpdateError } = await supabase
          .from("phone_number_routes")
          .update({
            external_workflow_id: String(newWorkflowId),
            provider_sync_ok: moved.provider_sync?.ok ?? null,
            provider_sync_message: moved.provider_sync?.message ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", route.id);
        if (routeUpdateError) throw routeUpdateError;
        switchedRoutes.push({ route, configurationId: connection.external_config_id, oldWorkflowId });
      }

      await adapter.pause(priorDeployment.external_deployment_id);
      previousPaused = true;
      const { error: oldStatusError } = await supabase
        .from("runtime_deployments")
        .update({
          status: "paused",
          last_error: null,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(priorDeployment.metadata ?? {}),
            replaced_by_deployment_id: persisted.id,
            replaced_at: new Date().toISOString(),
          },
        })
        .eq("id", priorDeployment.id);
      if (oldStatusError) throw oldStatusError;
    }

    const { error: versionPublishError } = await supabase
      .from("agent_versions")
      .update({ status: "published" })
      .eq("agent_id", id)
      .eq("version", version.version);
    if (versionPublishError) throw versionPublishError;
    versionPublished = true;

    const { error: agentPublishError } = await supabase
      .from("agents")
      .update({ status: "published" })
      .eq("id", id)
      .eq("current_version", version.version);
    if (agentPublishError) throw agentPublishError;

    const phoneRoutesSwitched = switchedRoutes.length;
    remoteDeploymentId = null;
    createdToolUuids = [];
    switchedRoutes = [];
    previousPaused = false;
    versionPublished = false;

    if (priorDeployment && toolAdapter) {
      const oldToolUuids = createdTools(priorDeployment.metadata);
      if (oldToolUuids.length) {
        const cleanupErrors: string[] = [];
        for (const toolUuid of oldToolUuids) {
          try {
            await toolAdapter.archiveTool(toolUuid);
          } catch (error) {
            cleanupErrors.push(error instanceof Error ? error.message : `Could not archive ${toolUuid}`);
          }
        }
        if (cleanupErrors.length) {
          await supabase
            .from("runtime_deployments")
            .update({
              last_error: `CLEANUP_REQUIRED: ${cleanupErrors.join("; ").slice(0, 1500)}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", priorDeployment.id);
        }
      }
    }

    return NextResponse.json({
      deployment: persisted,
      replacedDeploymentId: priorDeployment?.id ?? null,
      phoneRoutesSwitched,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (switchedRoutes.length && telephonyAdapter && supabase) {
      await rollbackPhoneRoutes(telephonyAdapter, supabase, switchedRoutes);
    }
    if (previousPaused && previousDeployment && adapter && supabase) {
      try {
        await adapter.resume(previousDeployment.external_deployment_id);
        await supabase
          .from("runtime_deployments")
          .update({ status: "ready", last_error: null, updated_at: new Date().toISOString() })
          .eq("id", previousDeployment.id);
      } catch {
        await supabase
          .from("runtime_deployments")
          .update({
            status: "failed",
            last_error: "ROLLBACK_FAILED: previous workflow could not be resumed automatically",
            updated_at: new Date().toISOString(),
          })
          .eq("id", previousDeployment.id);
      }
    }
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
    if (versionPublished && deployingVersion && supabase) {
      await supabase
        .from("agent_versions")
        .update({ status: "draft" })
        .eq("agent_id", id)
        .eq("version", deployingVersion);
    }
    if (persistedDeploymentId && supabase) {
      await supabase
        .from("runtime_deployments")
        .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
        .eq("id", persistedDeploymentId);
    }

    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED") || message === "SUPABASE_NOT_CONFIGURED"
      ? 503
      : message === "VERSION_ALREADY_DEPLOYED"
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
