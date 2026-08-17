import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { AgentConfigSchema } from "@/lib/domain";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
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
type VerifiedTestRow = { id: string; workflow_run_id: string; updated_at: string };
type PhoneRouteRow = {
  id: string;
  telephony_connection_id: string;
  external_phone_number_id: string;
  external_workflow_id: string | null;
  label: string | null;
  is_active: boolean;
};
type TelephonyConnectionRow = { id: string; external_config_id: string; status: string };
type SwitchedRoute = { route: PhoneRouteRow; configurationId: string; oldWorkflowId: number };

function workflowId(deploymentId: string) {
  const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
  if (!match) throw new Error("INVALID_DOGRAH_DEPLOYMENT_ID");
  return Number(match[1]);
}

function createdTools(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.created_tool_uuids;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

async function rollbackPhoneRoutes(telephonyAdapter: DograhTelephonyAdapter, switched: SwitchedRoute[]) {
  for (const item of [...switched].reverse()) {
    try {
      const restored = await telephonyAdapter.updatePhoneNumber({
        configurationId: item.configurationId,
        phoneNumberId: item.route.external_phone_number_id,
        inboundWorkflowId: item.oldWorkflowId,
        label: item.route.label,
        isActive: item.route.is_active,
      });
      await query(
        `update phone_number_routes set external_workflow_id = $1, provider_sync_ok = $2, provider_sync_message = $3, updated_at = now() where id = $4`,
        [String(item.oldWorkflowId), restored.provider_sync?.ok ?? null, restored.provider_sync?.message ?? null, item.route.id],
      );
    } catch {
      await query(
        `update phone_number_routes set provider_sync_ok = false, provider_sync_message = 'Automatic rollback failed; provider reconciliation required', updated_at = now() where id = $1`,
        [item.route.id],
      ).catch(() => undefined);
    }
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  let deployingVersion: number | null = null;

  try {
    const agent = (await query<{ id: string; organization_id: string; current_version: number; status: string }>(
      `select id, organization_id, current_version, status from agents where id = $1 limit 1`,
      [id],
    )).rows[0];
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });
    await requireOrganizationAdmin(agent.organization_id, request.headers);

    const version = (await query<{ version: number; status: string; config: unknown; config_hash: string }>(
      `select version, status, config, config_hash from agent_versions where agent_id = $1 and version = $2 limit 1`,
      [id, agent.current_version],
    )).rows[0];
    if (!version) return NextResponse.json({ error: "AGENT_VERSION_NOT_FOUND" }, { status: 409 });
    deployingVersion = version.version;

    previousDeployment = (await query<DeploymentRow>(
      `select id, external_deployment_id, agent_version, metadata, created_at
         from runtime_deployments
        where organization_id = $1 and agent_id = $2 and provider = 'dograh' and status = 'ready'
        order by created_at desc limit 1`,
      [agent.organization_id, id],
    )).rows[0] ?? null;

    if (previousDeployment?.agent_version === version.version) {
      return NextResponse.json({ error: "VERSION_ALREADY_DEPLOYED", deploymentId: previousDeployment.id }, { status: 409 });
    }

    const verifiedTest = (await query<VerifiedTestRow>(
      `select id, workflow_run_id, updated_at
         from runtime_test_sessions
        where organization_id = $1 and agent_id = $2 and agent_version = $3
          and provider = 'dograh' and status = 'completed' and workflow_run_id is not null
        order by updated_at desc limit 1`,
      [agent.organization_id, id, version.version],
    )).rows[0] ?? null;
    if (!verifiedTest) {
      return NextResponse.json({
        error: "VERSION_NOT_TESTED",
        message: `Agent v${version.version} must complete a real Dograh test run before deployment.`,
      }, { status: 409 });
    }

    const config = AgentConfigSchema.parse(version.config);
    const runtime = await resolveDograhConnection(agent.organization_id);
    adapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    telephonyAdapter = new DograhTelephonyAdapter(runtime.baseUrl, runtime.apiKey);

    const localValidation = await adapter.validate(config);
    if (!localValidation.valid) {
      return NextResponse.json({ error: "RUNTIME_VALIDATION_FAILED", issues: localValidation.errors }, { status: 422 });
    }

    const provisioned = await provisionDograhWorkflowTools(config, toolAdapter);
    createdToolUuids = provisioned.createdToolUuids;
    const webhookToken = randomBytes(32).toString("base64url");
    const webhookTokenHash = createHash("sha256").update(webhookToken).digest("hex");
    const appOrigin = new URL(request.url).origin;
    const completionWebhookUrl = `${appOrigin}/api/webhooks/dograh?token=${encodeURIComponent(webhookToken)}`;

    const deployment = await adapter.deploy(config, { completionWebhookUrl, toolBindings: provisioned.bindings });
    remoteDeploymentId = deployment.deploymentId;
    const newWorkflowId = workflowId(deployment.deploymentId);

    const persisted = (await query<{
      id: string; external_deployment_id: string; external_workflow_uuid: string | null; status: string; created_at: string;
    }>(
      `insert into runtime_deployments
        (organization_id, agent_id, agent_version, provider, external_deployment_id, external_workflow_uuid, webhook_token_hash, status, metadata)
       values ($1,$2,$3,'dograh',$4,$5,$6,$7,$8::jsonb)
       returning id, external_deployment_id, external_workflow_uuid, status, created_at`,
      [
        agent.organization_id, id, version.version, deployment.deploymentId, deployment.workflowUuid, webhookTokenHash, deployment.status,
        JSON.stringify({
          runtime_source: runtime.source,
          external_organization_id: runtime.externalOrganizationId ?? null,
          completion_webhook_configured: true,
          tool_bindings: provisioned.bindings,
          created_tool_uuids: createdToolUuids,
          replaces_deployment_id: previousDeployment?.id ?? null,
          verified_test_session_id: verifiedTest.id,
          verified_test_workflow_run_id: verifiedTest.workflow_run_id,
          verified_test_completed_at: verifiedTest.updated_at,
        }),
      ],
    )).rows[0];
    persistedDeploymentId = persisted.id;

    if (previousDeployment) {
      const oldWorkflowId = workflowId(previousDeployment.external_deployment_id);
      const routes = (await query<PhoneRouteRow>(
        `select id, telephony_connection_id, external_phone_number_id, external_workflow_id, label, is_active
           from phone_number_routes where organization_id = $1 and agent_id = $2 and is_active = true`,
        [agent.organization_id, id],
      )).rows;
      const connectionIds = [...new Set(routes.map((route) => route.telephony_connection_id))];
      const connections = connectionIds.length
        ? (await query<TelephonyConnectionRow>(
            `select id, external_config_id, status from telephony_connections where organization_id = $1 and id = any($2::uuid[])`,
            [agent.organization_id, connectionIds],
          )).rows
        : [];
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
        if (moved.provider_sync?.ok === false) throw new Error(`PHONE_ROUTE_PROVIDER_SYNC_FAILED:${route.id}:${moved.provider_sync.message ?? "unknown"}`);
        await query(
          `update phone_number_routes set external_workflow_id = $1, provider_sync_ok = $2, provider_sync_message = $3, updated_at = now() where id = $4`,
          [String(newWorkflowId), moved.provider_sync?.ok ?? null, moved.provider_sync?.message ?? null, route.id],
        );
        switchedRoutes.push({ route, configurationId: connection.external_config_id, oldWorkflowId });
      }

      await adapter.pause(previousDeployment.external_deployment_id);
      previousPaused = true;
      await query(
        `update runtime_deployments set status = 'paused', last_error = null, updated_at = now(), metadata = coalesce(metadata,'{}'::jsonb) || $1::jsonb where id = $2`,
        [JSON.stringify({ replaced_by_deployment_id: persisted.id, replaced_at: new Date().toISOString() }), previousDeployment.id],
      );
    }

    await query(`update agent_versions set status = 'published' where agent_id = $1 and version = $2`, [id, version.version]);
    versionPublished = true;
    await query(`update agents set status = 'published' where id = $1 and current_version = $2`, [id, version.version]);

    const phoneRoutesSwitched = switchedRoutes.length;
    remoteDeploymentId = null;
    createdToolUuids = [];
    switchedRoutes = [];
    previousPaused = false;
    versionPublished = false;

    if (previousDeployment && toolAdapter) {
      const cleanupErrors: string[] = [];
      for (const toolUuid of createdTools(previousDeployment.metadata)) {
        try { await toolAdapter.archiveTool(toolUuid); }
        catch (error) { cleanupErrors.push(error instanceof Error ? error.message : `Could not archive ${toolUuid}`); }
      }
      if (cleanupErrors.length) {
        await query(`update runtime_deployments set last_error = $1, updated_at = now() where id = $2`, [`CLEANUP_REQUIRED: ${cleanupErrors.join("; ").slice(0, 1500)}`, previousDeployment.id]);
      }
    }

    return NextResponse.json({ deployment: persisted, replacedDeploymentId: previousDeployment?.id ?? null, phoneRoutesSwitched }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (switchedRoutes.length && telephonyAdapter) await rollbackPhoneRoutes(telephonyAdapter, switchedRoutes);
    if (previousPaused && previousDeployment && adapter) {
      try {
        await adapter.resume(previousDeployment.external_deployment_id);
        await query(`update runtime_deployments set status = 'ready', last_error = null, updated_at = now() where id = $1`, [previousDeployment.id]);
      } catch {
        await query(`update runtime_deployments set status = 'failed', last_error = 'ROLLBACK_FAILED: previous workflow could not be resumed automatically', updated_at = now() where id = $1`, [previousDeployment.id]).catch(() => undefined);
      }
    }
    if (remoteDeploymentId && adapter) {
      try { await adapter.pause(remoteDeploymentId); } catch { /* persisted row records reconciliation need */ }
    }
    if (createdToolUuids.length && toolAdapter) await rollbackProvisionedDograhTools(toolAdapter, createdToolUuids);
    if (versionPublished && deployingVersion) await query(`update agent_versions set status = 'draft' where agent_id = $1 and version = $2`, [id, deployingVersion]).catch(() => undefined);
    if (persistedDeploymentId) await query(`update runtime_deployments set status = 'failed', last_error = $1, updated_at = now() where id = $2`, [message, persistedDeploymentId]).catch(() => undefined);

    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")
      ? 503
      : message === "VERSION_ALREADY_DEPLOYED" || message === "VERSION_NOT_TESTED"
        ? 409
        : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
