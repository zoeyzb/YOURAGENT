import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasDograhEnv } from "@/lib/env";
import { DeployButton } from "./DeployButton";
import { EditAgentForm } from "./EditAgentForm";
import { RuntimeStatusButton } from "./RuntimeStatusButton";
import { TestAgentButton } from "./TestAgentButton";

type WorkflowNodeView = { id: string; label: string; type: string; config?: Record<string, unknown> };
type SkillView = { id: string; name: string; category: string; version: number };

type AgentConfigView = {
  goal?: { objective?: string; direction?: "inbound" | "outbound" | "both"; industry?: string };
  voiceProfile?: string;
  workflow?: { nodes?: WorkflowNodeView[] };
  skills?: SkillView[];
};

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id,organization_id,name,status,current_version,created_at")
    .eq("id", id)
    .maybeSingle();
  if (!agent) notFound();

  const [
    { data: version },
    { data: currentDeployment },
    { data: liveDeployment },
    { data: runtimeConnection },
    { data: versions },
  ] = await Promise.all([
    supabase
      .from("agent_versions")
      .select("version,status,config,config_hash,created_at")
      .eq("agent_id", id)
      .eq("version", agent.current_version)
      .maybeSingle(),
    supabase
      .from("runtime_deployments")
      .select("id,agent_version,provider,external_deployment_id,status,created_at,last_error")
      .eq("agent_id", id)
      .eq("agent_version", agent.current_version)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("runtime_deployments")
      .select("id,agent_version,provider,external_deployment_id,status,created_at,last_error")
      .eq("agent_id", id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("runtime_connections")
      .select("provider,status,external_organization_id")
      .eq("organization_id", agent.organization_id)
      .eq("provider", "dograh")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("agent_versions")
      .select("version,status,config_hash,created_at")
      .eq("agent_id", id)
      .order("version", { ascending: false })
      .limit(10),
  ]);

  const config = (version?.config ?? {}) as AgentConfigView;
  const nodes = config.workflow?.nodes ?? [];
  const skills = config.skills ?? [];
  const actionNode = nodes.find((node) => node.type === "tool") ?? null;
  const transferNode = nodes.find((node) => node.type === "transfer") ?? null;
  const devFallbackEnabled = process.env.ALLOW_GLOBAL_DOGRAH_FALLBACK === "true" && hasDograhEnv();
  const runtimeConfigured = Boolean(runtimeConnection) || devFallbackEnabled;
  const runtimeLabel = runtimeConnection
    ? `Tenant Dograh${runtimeConnection.external_organization_id ? ` · ${runtimeConnection.external_organization_id}` : ""}`
    : devFallbackEnabled
      ? "Development Dograh fallback"
      : "No tenant runtime";

  const currentIsLive = currentDeployment?.status === "ready";
  const currentIsPaused = currentDeployment?.status === "paused";
  const olderVersionLive = liveDeployment && liveDeployment.agent_version !== agent.current_version;

  return <main><div className="shell section">
    <div className="dash-top">
      <Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link>
      <span className="status">{String(agent.status).toUpperCase()}</span>
    </div>
    <div className="agent-detail-grid">
      <section className="card builder-card">
        <span className="eyebrow">AGENT</span>
        <h1 style={{fontSize:58}}>{agent.name}</h1>
        <p className="lede">{config.goal?.objective}</p>
        <div className="metric-grid">
          <div className="metric"><span>Current version</span><strong>v{agent.current_version}</strong></div>
          <div className="metric"><span>Direction</span><strong>{config.goal?.direction ?? "—"}</strong></div>
          <div className="metric"><span>Industry</span><strong>{config.goal?.industry ?? "—"}</strong></div>
          <div className="metric"><span>Voice</span><strong>{config.voiceProfile ?? "—"}</strong></div>
        </div>
      </section>

      <section className="card builder-card">
        <span className="eyebrow">WORKFLOW</span>
        <h2>{nodes.length} nodes</h2>
        {nodes.map((node, index) => <div className="agent-row" key={node.id}><div><strong>{index + 1}. {node.label}</strong><div style={{color:'#9ca3af',marginTop:4}}>{node.type}</div></div></div>)}
      </section>

      <section className="card builder-card">
        <span className="eyebrow">SKILLS</span>
        <h2>{skills.length} attached</h2>
        {skills.map((skill) => <div className="agent-row" key={skill.id}><div><strong>{skill.name}</strong><div style={{color:'#9ca3af',marginTop:4}}>{skill.category} · v{skill.version}</div></div></div>)}
      </section>

      <section className="card builder-card">
        <span className="eyebrow">VOICE RUNTIME</span>
        <h2>{runtimeLabel}</h2>
        <TestAgentButton agentId={id} disabled={!runtimeConfigured} />
        {!runtimeConfigured ? <p style={{marginTop:12}}>Connect this organization to its own Dograh runtime before testing or deploying.</p> : null}
      </section>

      <section className="card builder-card">
        <span className="eyebrow">DEPLOYMENT</span>
        {currentIsLive ? <>
          <h2>v{agent.current_version} is LIVE on {currentDeployment.provider}</h2>
          <p>Runtime ID: <code>{currentDeployment.external_deployment_id}</code></p>
          <p>Created {new Date(currentDeployment.created_at).toLocaleString()}</p>
          <RuntimeStatusButton agentId={id} action="pause" />
        </> : currentIsPaused ? <>
          <h2>v{agent.current_version} is PAUSED</h2>
          <p>Runtime ID: <code>{currentDeployment.external_deployment_id}</code></p>
          <RuntimeStatusButton agentId={id} action="resume" />
        </> : <>
          <h2>v{agent.current_version} is not live yet.</h2>
          {olderVersionLive ? <p>v{liveDeployment.agent_version} stays live until this version is deployed successfully. Cutover is transactional.</p> : <p>No older live deployment exists.</p>}
          {currentDeployment?.status === "failed" && currentDeployment.last_error ? <p style={{color:'#fca5a5'}}>Last deployment failed: {currentDeployment.last_error}</p> : null}
          <DeployButton agentId={id} disabled={!runtimeConfigured} />
          {!runtimeConfigured ? <p style={{marginTop:12}}>Tenant Dograh credentials are not configured, so deployment is safely disabled.</p> : null}
        </>}
        <code className="hash">{version?.config_hash ?? "no version hash"}</code>
      </section>

      <section className="card builder-card" style={{ gridColumn: "1 / -1" }}>
        <span className="eyebrow">EDIT · CREATES A NEW IMMUTABLE VERSION</span>
        <h2>Change the agent without rewriting history.</h2>
        <EditAgentForm
          agentId={id}
          name={agent.name}
          industry={config.goal?.industry ?? "General"}
          objective={config.goal?.objective ?? "Help callers and complete the requested business task."}
          direction={config.goal?.direction ?? "inbound"}
          voiceProfile={config.voiceProfile ?? "warm-professional"}
          httpAction={actionNode ? {
            label: actionNode.label,
            url: text(actionNode.config?.url),
            method: (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(text(actionNode.config?.method)) ? text(actionNode.config?.method) : "POST") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
            credentialUuid: text(actionNode.config?.credentialUuid) || undefined,
          } : null}
          transfer={transferNode ? {
            label: transferNode.label,
            destination: text(transferNode.config?.destination),
            message: text(transferNode.config?.message) || undefined,
          } : null}
        />
      </section>

      <section className="card builder-card" style={{ gridColumn: "1 / -1" }}>
        <span className="eyebrow">VERSION HISTORY</span>
        <h2>{versions?.length ?? 0} recent versions</h2>
        {(versions ?? []).map((item) => <div className="agent-row" key={item.version}>
          <div><strong>v{item.version} · {String(item.status).toUpperCase()}</strong><div style={{color:'#9ca3af',marginTop:4}}>{new Date(item.created_at).toLocaleString()}</div></div>
          <code className="hash">{String(item.config_hash).slice(0, 16)}…</code>
        </div>)}
      </section>
    </div>
  </div></main>;
}
