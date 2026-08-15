import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TwilioConnectionForm } from "./TwilioConnectionForm";
import { PhoneRouteForm } from "./PhoneRouteForm";

export const dynamic = "force-dynamic";

export default async function TelephonySettingsPage() {
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
  const organizationIds = (memberships ?? []).map((item) => item.organization_id);

  const [{ data: organizations }, { data: telephonyConnections }, { data: agents }, { data: deployments }, { data: routes }] = await Promise.all([
    organizationIds.length ? supabase.from("organizations").select("id,name").in("id", organizationIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    organizationIds.length ? supabase.from("telephony_connections").select("id,organization_id,provider,external_config_id,name,status,is_default_outbound,created_at").in("organization_id", organizationIds) : Promise.resolve({ data: [] as never[] }),
    organizationIds.length ? supabase.from("agents").select("id,organization_id,name,status").in("organization_id", organizationIds) : Promise.resolve({ data: [] as never[] }),
    organizationIds.length ? supabase.from("runtime_deployments").select("agent_id,organization_id,status,provider,created_at").in("organization_id", organizationIds).eq("provider", "dograh").eq("status", "ready") : Promise.resolve({ data: [] as never[] }),
    organizationIds.length ? supabase.from("phone_number_routes").select("id,organization_id,telephony_connection_id,address,label,agent_id,is_active,is_default_caller_id,provider_sync_ok,provider_sync_message,created_at").in("organization_id", organizationIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as never[] }),
  ]);

  return <main><div className="shell section">
    <div className="dash-top">
      <Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link>
      <div style={{ display: "flex", gap: 10 }}><Link className="btn" href="/settings/runtime">Runtime</Link><Link className="btn" href="/dashboard">Dashboard</Link></div>
    </div>

    <span className="eyebrow">TELEPHONY</span>
    <h1 style={{ fontSize: 58 }}>Connect numbers. Route calls to real agents.</h1>
    <p className="lede">Twilio credentials are sent directly to the organization-scoped Dograh runtime. YOURAGENT stores only Dograh configuration and phone-number references.</p>

    {(organizations ?? []).map((organization) => {
      const orgConnections = (telephonyConnections ?? []).filter((item) => item.organization_id === organization.id);
      const readyAgentIds = new Set((deployments ?? []).filter((item) => item.organization_id === organization.id).map((item) => item.agent_id));
      const orgAgents = (agents ?? []).filter((item) => item.organization_id === organization.id && readyAgentIds.has(item.id));
      const orgRoutes = (routes ?? []).filter((item) => item.organization_id === organization.id);

      return <section key={organization.id} style={{ marginTop: 32 }}>
        <span className="eyebrow">{organization.name}</span>
        <div className="agent-detail-grid" style={{ marginTop: 14 }}>
          <section className="card builder-card">
            <h2>Connect Twilio</h2>
            <p>Create the telephony configuration inside this organization's Dograh runtime.</p>
            <TwilioConnectionForm organizationId={organization.id} />
          </section>

          {orgConnections.map((connection) => <section className="card builder-card" key={connection.id}>
            <span className="eyebrow">{connection.provider.toUpperCase()}</span>
            <h2>{connection.name}</h2>
            <p>Status: <strong>{connection.status}</strong>{connection.is_default_outbound ? " · default outbound" : ""}</p>
            <p>Dograh config ID: <code>{connection.external_config_id}</code></p>
            <PhoneRouteForm organizationId={organization.id} telephonyConnectionId={connection.id} agents={orgAgents.map((agent) => ({ id: agent.id, name: agent.name }))} />
          </section>)}

          <section className="card builder-card">
            <span className="eyebrow">PHONE ROUTES</span>
            <h2>{orgRoutes.length} configured</h2>
            {!orgRoutes.length ? <p>No phone numbers routed yet.</p> : null}
            {orgRoutes.map((route) => {
              const agent = (agents ?? []).find((item) => item.id === route.agent_id);
              const live = route.is_active && route.provider_sync_ok !== false;
              return <div className="agent-row" key={route.id}>
                <div>
                  <strong>{route.address}</strong>
                  <div style={{ color: live ? "#bbf7d0" : "#fde68a", marginTop: 4 }}>{live ? "LIVE" : "NEEDS ATTENTION"} · {agent?.name ?? "Unassigned"}{route.is_default_caller_id ? " · default caller ID" : ""}</div>
                  {route.provider_sync_message ? <div style={{ color: "#fca5a5", marginTop: 4 }}>{route.provider_sync_message}</div> : null}
                </div>
              </div>;
            })}
          </section>
        </div>
      </section>;
    })}
  </div></main>;
}
