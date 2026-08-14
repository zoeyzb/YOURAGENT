import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasDograhEnv } from "@/lib/env";
import { DeployButton } from "./DeployButton";
import { RuntimeStatusButton } from "./RuntimeStatusButton";

type WorkflowNodeView = { id: string; label: string; type: string };
type SkillView = { id: string; name: string; category: string; version: number };

type AgentConfigView = {
  goal?: { objective?: string; direction?: string; industry?: string };
  voiceProfile?: string;
  workflow?: { nodes?: WorkflowNodeView[] };
  skills?: SkillView[];
};

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id,name,status,current_version,created_at")
    .eq("id", id)
    .maybeSingle();
  if (!agent) notFound();

  const [{ data: version }, { data: deployment }] = await Promise.all([
    supabase
      .from("agent_versions")
      .select("version,status,config,config_hash,created_at")
      .eq("agent_id", id)
      .eq("version", agent.current_version)
      .maybeSingle(),
    supabase
      .from("runtime_deployments")
      .select("provider,external_deployment_id,status,created_at,last_error")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const config = (version?.config ?? {}) as AgentConfigView;
  const nodes = config.workflow?.nodes ?? [];
  const skills = config.skills ?? [];
  const dograhConfigured = hasDograhEnv();

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
          <div className="metric"><span>Version</span><strong>v{agent.current_version}</strong></div>
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
        <span className="eyebrow">DEPLOYMENT</span>
        {deployment ? <>
          <h2>{String(deployment.status).toUpperCase()} on {deployment.provider}</h2>
          <p>Real runtime ID: <code>{deployment.external_deployment_id}</code></p>
          <p>Created {new Date(deployment.created_at).toLocaleString()}</p>
          <RuntimeStatusButton agentId={id} action={deployment.status === "paused" ? "resume" : "pause"} />
          {deployment.last_error ? <p style={{color:'#fca5a5'}}>{deployment.last_error}</p> : null}
        </> : <>
          <h2>Not deployed yet.</h2>
          <p>The configuration is persisted and versioned. Publishing calls Dograh's real workflow API, validates the returned workflow, then stores the external workflow ID.</p>
          <DeployButton agentId={id} disabled={!dograhConfigured} />
          {!dograhConfigured ? <p style={{marginTop:12}}>Dograh credentials are not configured yet, so deployment is safely disabled.</p> : null}
        </>}
        <code className="hash">{version?.config_hash ?? "no version hash"}</code>
      </section>
    </div>
  </div></main>;
}
