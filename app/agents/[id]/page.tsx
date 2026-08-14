import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;

  const { data: agent } = await supabase.from("agents").select("id,name,status,current_version,created_at").eq("id", id).maybeSingle();
  if (!agent) notFound();
  const { data: version } = await supabase.from("agent_versions").select("version,status,config,config_hash,created_at").eq("agent_id", id).eq("version", agent.current_version).maybeSingle();

  const config = (version?.config ?? {}) as Record<string, any>;
  const nodes = config.workflow?.nodes ?? [];
  const skills = config.skills ?? [];

  return <main><div className="shell section">
    <div className="dash-top"><Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link><span className="status">{String(agent.status).toUpperCase()}</span></div>
    <div className="agent-detail-grid">
      <section className="card builder-card"><span className="eyebrow">AGENT</span><h1 style={{fontSize:58}}>{agent.name}</h1><p className="lede">{config.goal?.objective}</p><div className="metric-grid"><div className="metric"><span>Version</span><strong>v{agent.current_version}</strong></div><div className="metric"><span>Direction</span><strong>{config.goal?.direction ?? "—"}</strong></div><div className="metric"><span>Industry</span><strong>{config.goal?.industry ?? "—"}</strong></div><div className="metric"><span>Voice</span><strong>{config.voiceProfile ?? "—"}</strong></div></div></section>
      <section className="card builder-card"><span className="eyebrow">WORKFLOW</span><h2>{nodes.length} nodes</h2>{nodes.map((node: any, index: number) => <div className="agent-row" key={node.id}><div><strong>{index + 1}. {node.label}</strong><div style={{color:'#9ca3af',marginTop:4}}>{node.type}</div></div></div>)}</section>
      <section className="card builder-card"><span className="eyebrow">SKILLS</span><h2>{skills.length} attached</h2>{skills.map((skill: any) => <div className="agent-row" key={skill.id}><div><strong>{skill.name}</strong><div style={{color:'#9ca3af',marginTop:4}}>{skill.category} · v{skill.version}</div></div></div>)}</section>
      <section className="card builder-card"><span className="eyebrow">DEPLOYMENT</span><h2>Draft, not pretending to be live.</h2><p>The configuration is persisted and versioned. Voice-runtime deployment remains disabled until Dograh/telephony credentials and a verified runtime adapter are configured.</p><code className="hash">{version?.config_hash ?? "no version hash"}</code></section>
    </div>
  </div></main>;
}
