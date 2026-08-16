import Link from "next/link";
import { headers } from "next/headers";
import CreateAgentForm from "./CreateAgentForm";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
    return (
      <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><span className="eyebrow">BACKEND SETUP REQUIRED</span><h1 style={{fontSize:52}}>The app is deployed. Postgres is not connected yet.</h1><p className="lede">YOURAGENT uses Neon Postgres with Neon Managed Auth. Connect the production <code>DATABASE_URL</code> to activate login, agent creation, calls, runtime settings, and telephony.</p></div></div></main>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><h2>Sign in to operate your agents.</h2><Link className="btn btn-primary" href="/login">Sign in</Link></div></div></main>;
  }

  const [agentsResult, callsResult] = await Promise.all([
    query<{ id: string; name: string; status: string; current_version: number; created_at: string }>(
      `select distinct a.id, a.name, a.status, a.current_version, a.created_at
         from agents a
         join organization_members m on m.organization_id = a.organization_id
        where m.user_id = $1
        order by a.created_at desc`,
      [session.user.id],
    ),
    query<{ count: string }>(
      `select count(distinct c.id)::text as count
         from calls c
         join organization_members m on m.organization_id = c.organization_id
        where m.user_id = $1`,
      [session.user.id],
    ),
  ]);

  const agents = agentsResult.rows;
  const callCount = Number(callsResult.rows[0]?.count ?? 0);

  return (
    <main><div className="shell section">
      <div className="dash-top">
        <Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link className="btn" href="/calls">Calls · {callCount}</Link>
          <Link className="btn" href="/settings/runtime">Runtime</Link>
          <Link className="btn" href="/settings/telephony">Telephony</Link>
          <span className="eyebrow">SIGNED IN</span>
        </div>
      </div>
      <div className="builder-layout">
        <section className="card builder-card"><span className="eyebrow">NEW AGENT</span><h2>Create a working agent configuration.</h2><p>Create writes an organization-scoped agent plus an immutable version record to Postgres.</p><CreateAgentForm /></section>
        <section className="card builder-card"><span className="eyebrow">YOUR AGENTS</span><h2>{agents.length} agents</h2>{!agents.length && <p>No agents yet. Create the first one.</p>}{agents.map((agent) => <Link className="agent-row" href={`/agents/${agent.id}`} key={agent.id}><div><strong>{agent.name}</strong><div style={{color:'#9ca3af',marginTop:4}}>v{agent.current_version} · {agent.status}</div></div><span>Open →</span></Link>)}</section>
      </div>
    </div></main>
  );
}
