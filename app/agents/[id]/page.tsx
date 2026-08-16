import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { hasDograhEnv } from "@/lib/env";
import { hasRuntimeSecretEncryptionKey } from "@/lib/secrets";
import { DeployButton } from "./DeployButton";
import { EditAgentForm } from "./EditAgentForm";
import { RestoreVersionButton } from "./RestoreVersionButton";
import { RuntimeStatusButton } from "./RuntimeStatusButton";
import { TestAgentButton } from "./TestAgentButton";
import { WorkflowEditor } from "./WorkflowEditor";

type WorkflowNodeView = { id: string; label: string; type: "say" | "ask" | "decision" | "tool" | "transfer" | "end"; config?: Record<string, unknown> };
type WorkflowEdgeView = { from: string; to: string; condition?: string };
type SkillView = { id: string; name: string; category: string; version: number };
type AgentConfigView = {
  goal?: { objective?: string; direction?: "inbound" | "outbound" | "both"; industry?: string };
  voiceProfile?: string;
  workflow?: { nodes?: WorkflowNodeView[]; edges?: WorkflowEdgeView[] };
  skills?: SkillView[];
};
type DeploymentRow = { id: string; agent_version: number; provider: string; external_deployment_id: string; status: string; created_at: string; last_error: string | null };
type VersionHistoryRow = { version: number; status: string; config_hash: string; created_at: string; restored_from_version: number | null };

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
    return <main><div className="shell section"><p>Neon Postgres backend setup is required.</p><Link className="btn" href="/api/health">Health</Link></div></main>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const agentResult = await query<{
    id: string; organization_id: string; name: string; status: string; current_version: number; created_at: string;
  }>(
    `select a.id, a.organization_id, a.name, a.status, a.current_version, a.created_at
       from agents a
       join organization_members m on m.organization_id = a.organization_id
      where a.id = $1 and m.user_id = $2
      limit 1`,
    [id, session.user.id],
  );
  const agent = agentResult.rows[0];
  if (!agent) notFound();

  const [versionResult, currentDeploymentResult, liveDeploymentResult, runtimeResult, versionsResult] = await Promise.all([
    query<{ version: number; status: string; config: unknown; config_hash: string; created_at: string }>(
      `select version, status, config, config_hash, created_at from agent_versions where agent_id = $1 and version = $2 limit 1`,
      [id, agent.current_version],
    ),
    query<DeploymentRow>(
      `select id, agent_version, provider, external_deployment_id, status, created_at, last_error
         from runtime_deployments where agent_id = $1 and agent_version = $2 order by created_at desc limit 1`,
      [id, agent.current_version],
    ),
    query<DeploymentRow>(
      `select id, agent_version, provider, external_deployment_id, status, created_at, last_error
         from runtime_deployments where agent_id = $1 and status = 'ready' order by created_at desc limit 1`,
      [id],
    ),
    query<{ provider: string; status: string; external_organization_id: string | null }>(
      `select provider, status, external_organization_id from runtime_connections
        where organization_id = $1 and provider = 'dograh' and status = 'active' limit 1`,
      [agent.organization_id],
    ),
    query<VersionHistoryRow>(
      `select version, status, config_hash, created_at, restored_from_version from agent_versions where agent_id = $1 order by version desc limit 10`,
      [id],
    ),
  ]);

  const version = versionResult.rows[0];
  const currentDeployment = currentDeploymentResult.rows[0];
  const liveDeployment = liveDeploymentResult.rows[0];
  const runtimeConnection = runtimeResult.rows[0];
  const versions = versionsResult.rows;
  const config = (version?.config ?? {}) as AgentConfigView;
  const nodes = config.workflow?.nodes ?? [];
  const edges = config.workflow?.edges ?? [];
  const skills = config.skills ?? [];
  const actionNode = nodes.find((node) => node.type === "tool") ?? null;
  const transferNode = nodes.find((node) => node.type === "transfer") ?? null;
  const encryptionReady = hasRuntimeSecretEncryptionKey();
  const devFallbackEnabled = process.env.ALLOW_GLOBAL_DOGRAH_FALLBACK === "true" && hasDograhEnv();
  const tenantRuntimeReady = Boolean(runtimeConnection) && encryptionReady;
  const runtimeConfigured = tenantRuntimeReady || devFallbackEnabled;
  const runtimeLabel = runtimeConnection
    ? encryptionReady
      ? `Tenant Dograh${runtimeConnection.external_organization_id ? ` · ${runtimeConnection.external_organization_id}` : ""}`
      : "Tenant Dograh · encryption unavailable"
    : devFallbackEnabled ? "Development Dograh fallback" : "No tenant runtime";

  const currentIsLive = currentDeployment?.status === "ready";
  const currentIsPaused = currentDeployment?.status === "paused";
  const olderVersionLive = liveDeployment && liveDeployment.agent_version !== agent.current_version;

  return <main><div className="shell section">
    <div className="dash-top"><Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link><span className="status">{agent.status.toUpperCase()}</span></div>
    <div className="agent-detail-grid">
      <section className="card builder-card"><span className="eyebrow">AGENT</span><h1 style={{fontSize:58}}>{agent.name}</h1><p className="lede">{config.goal?.objective}</p><div className="metric-grid"><div className="metric"><span>Current version</span><strong>v{agent.current_version}</strong></div><div className="metric"><span>Direction</span><strong>{config.goal?.direction ?? "—"}</strong></div><div className="metric"><span>Industry</span><strong>{config.goal?.industry ?? "—"}</strong></div><div className="metric"><span>Voice</span><strong>{config.voiceProfile ?? "—"}</strong></div></div></section>
      <section className="card builder-card"><span className="eyebrow">WORKFLOW</span><h2>{nodes.length} nodes · {edges.length} edges</h2>{nodes.map((node,index)=><div className="agent-row" key={node.id}><div><strong>{index+1}. {node.label}</strong><div style={{color:'#9ca3af',marginTop:4}}>{node.type}</div></div></div>)}</section>
      <section className="card builder-card"><span className="eyebrow">SKILLS</span><h2>{skills.length} attached</h2>{skills.map((skill)=><div className="agent-row" key={skill.id}><div><strong>{skill.name}</strong><div style={{color:'#9ca3af',marginTop:4}}>{skill.category} · v{skill.version}</div></div></div>)}</section>
      <section className="card builder-card"><span className="eyebrow">VOICE RUNTIME</span><h2>{runtimeLabel}</h2><TestAgentButton agentId={id} disabled={!runtimeConfigured}/>{!runtimeConfigured?<p style={{marginTop:12}}>{runtimeConnection && !encryptionReady ? "Runtime secret encryption must be restored before testing or deploying this tenant runtime." : "Connect this organization to Dograh before testing or deploying."}</p>:null}</section>
      <section className="card builder-card"><span className="eyebrow">DEPLOYMENT</span>{currentIsLive?<><h2>v{agent.current_version} is LIVE on {currentDeployment.provider}</h2><p>Runtime ID: <code>{currentDeployment.external_deployment_id}</code></p><RuntimeStatusButton agentId={id} action="pause"/></>:currentIsPaused?<><h2>v{agent.current_version} is PAUSED</h2><p>Runtime ID: <code>{currentDeployment.external_deployment_id}</code></p><RuntimeStatusButton agentId={id} action="resume"/></>:<><h2>v{agent.current_version} is not live yet.</h2>{olderVersionLive?<p>v{liveDeployment.agent_version} stays live until this version deploys successfully.</p>:<p>No older live deployment exists.</p>}{currentDeployment?.status==="failed"&&currentDeployment.last_error?<p style={{color:'#fca5a5'}}>Last deployment failed: {currentDeployment.last_error}</p>:null}<DeployButton agentId={id} disabled={!runtimeConfigured}/></>}<code className="hash">{version?.config_hash ?? "no version hash"}</code></section>
      <section className="card builder-card" style={{gridColumn:"1 / -1"}}><span className="eyebrow">FLOW BUILDER · SAVES A NEW IMMUTABLE VERSION</span><h2>Edit the conversation graph.</h2><p>Change conversation steps, prompts, routing, and conditional edges. Existing tool/transfer credentials remain attached to their action nodes.</p><WorkflowEditor agentId={id} initialNodes={nodes.map((node) => ({ ...node, config: node.config ?? {} }))} initialEdges={edges} /></section>
      <section className="card builder-card" style={{gridColumn:"1 / -1"}}><span className="eyebrow">AGENT SETTINGS · CREATES A NEW IMMUTABLE VERSION</span><h2>Change the agent without rewriting history.</h2><EditAgentForm agentId={id} name={agent.name} industry={config.goal?.industry??"General"} objective={config.goal?.objective??"Help callers and complete the requested business task."} direction={config.goal?.direction??"inbound"} voiceProfile={config.voiceProfile??"warm-professional"} httpAction={actionNode?{label:actionNode.label,url:text(actionNode.config?.url),method:(["GET","POST","PUT","PATCH","DELETE"].includes(text(actionNode.config?.method))?text(actionNode.config?.method):"POST") as "GET"|"POST"|"PUT"|"PATCH"|"DELETE",credentialUuid:text(actionNode.config?.credentialUuid)||undefined}:null} transfer={transferNode?{label:transferNode.label,destination:text(transferNode.config?.destination),message:text(transferNode.config?.message)||undefined}:null}/></section>
      <section className="card builder-card" style={{gridColumn:"1 / -1"}}><span className="eyebrow">VERSION HISTORY</span><h2>{versions.length} recent versions</h2><p>Restoring an older version creates a new draft. The currently live workflow stays untouched until the restored draft passes testing and deploys through the safe cutover.</p>{versions.map((item)=><div className="agent-row" key={item.version}><div><strong>v{item.version} · {item.status.toUpperCase()}</strong><div style={{color:'#9ca3af',marginTop:4}}>{new Date(item.created_at).toLocaleString()}{item.restored_from_version ? ` · restored from v${item.restored_from_version}` : ""}</div></div><div style={{display:"flex",alignItems:"center",gap:12}}><code className="hash">{item.config_hash.slice(0,16)}…</code>{item.version < agent.current_version ? <RestoreVersionButton agentId={id} version={item.version} /> : null}</div></div>)}</section>
    </div>
  </div></main>;
}
