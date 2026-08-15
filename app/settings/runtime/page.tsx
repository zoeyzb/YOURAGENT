import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ConnectDograhForm } from "./ConnectDograhForm";

export const dynamic = "force-dynamic";

export default async function RuntimeSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .in("role", ["owner", "admin"]);

  const organizationIds = (memberships ?? []).map((membership) => membership.organization_id);
  const { data: organizations } = organizationIds.length
    ? await supabase.from("organizations").select("id,name").in("id", organizationIds)
    : { data: [] as { id: string; name: string }[] };
  const { data: connections } = organizationIds.length
    ? await supabase
      .from("runtime_connections")
      .select("organization_id,provider,base_url,status,updated_at")
      .in("organization_id", organizationIds)
      .eq("provider", "dograh")
    : { data: [] as { organization_id: string; provider: string; base_url: string; status: string; updated_at: string }[] };

  return <main><div className="shell section">
    <div className="dash-top">
      <Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link>
      <Link className="btn" href="/dashboard">Dashboard</Link>
    </div>

    <span className="eyebrow">RUNTIME SETTINGS</span>
    <h1 style={{ fontSize: 58 }}>Connect each company to its own voice runtime.</h1>
    <p className="lede">Dograh API keys are verified server-side and stored through Supabase Vault. The browser never receives the saved key.</p>

    <div className="agent-detail-grid" style={{ marginTop: 28 }}>
      {(organizations ?? []).map((organization) => {
        const connection = (connections ?? []).find((item) => item.organization_id === organization.id);
        return <section className="card builder-card" key={organization.id}>
          <span className="eyebrow">ORGANIZATION</span>
          <h2>{organization.name}</h2>
          <p>{connection ? `Dograh ${String(connection.status).toUpperCase()} · ${connection.base_url}` : "No Dograh runtime connected."}</p>
          {connection?.updated_at ? <p style={{ color: "#9ca3af" }}>Last updated {new Date(connection.updated_at).toLocaleString()}</p> : null}
          <ConnectDograhForm
            organizationId={organization.id}
            initialBaseUrl={connection?.base_url ?? "https://api.dograh.com"}
            connected={Boolean(connection)}
          />
        </section>;
      })}
      {!organizations?.length ? <section className="card builder-card"><h2>No admin organizations.</h2><p>You need owner/admin access to configure runtime credentials.</p></section> : null}
    </div>
  </div></main>;
}
