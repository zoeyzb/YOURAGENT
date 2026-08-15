import Link from "next/link";
import CreateAgentForm from "./CreateAgentForm";
import { hasSupabaseEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!hasSupabaseEnv()) {
    return (
      <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><span className="eyebrow">BACKEND SETUP REQUIRED</span><h1 style={{fontSize:52}}>The UI is ready. The database is not connected yet.</h1><p className="lede">YOURAGENT now has a real create-agent API, authentication boundary, tenant model, and persistent version model. Add the new Supabase project credentials to Vercel and apply the migrations to turn this screen live.</p></div></div></main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><h2>Sign in to operate your agents.</h2><Link className="btn btn-primary" href="/login">Sign in</Link></div></div></main>;
  }

  const [{ data: agents }, { count: callCount }] = await Promise.all([
    supabase.from("agents").select("id,name,status,current_version,created_at").order("created_at", { ascending: false }),
    supabase.from("calls").select("id", { count: "exact", head: true }),
  ]);

  return (
    <main><div className="shell section">
      <div className="dash-top">
        <Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link className="btn" href="/calls">Calls · {callCount ?? 0}</Link>
          <Link className="btn" href="/settings/runtime">Runtime</Link>
          <Link className="btn" href="/settings/telephony">Telephony</Link>
          <span className="eyebrow">SIGNED IN</span>
        </div>
      </div>
      <div className="builder-layout">
        <section className="card builder-card"><span className="eyebrow">NEW AGENT</span><h2>Create a working agent configuration.</h2><p>Nothing here is stored only in the browser. Create writes an organization-scoped agent plus an immutable version record.</p><CreateAgentForm /></section>
        <section className="card builder-card"><span className="eyebrow">YOUR AGENTS</span><h2>{agents?.length ?? 0} agents</h2>{!agents?.length && <p>No agents yet. Create the first one.</p>}{agents?.map((agent) => <Link className="agent-row" href={`/agents/${agent.id}`} key={agent.id}><div><strong>{agent.name}</strong><div style={{color:'#9ca3af',marginTop:4}}>v{agent.current_version} · {agent.status}</div></div><span>Open →</span></Link>)}</section>
      </div>
    </div></main>
  );
}
