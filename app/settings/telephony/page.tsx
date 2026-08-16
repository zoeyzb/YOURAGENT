import Link from "next/link";
import { headers } from "next/headers";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { hasRuntimeSecretEncryptionKey } from "@/lib/secrets";
import { TwilioConnectionForm } from "./TwilioConnectionForm";
import { PhoneRouteForm } from "./PhoneRouteForm";
import { OutboundCallForm } from "./OutboundCallForm";

export const dynamic = "force-dynamic";

type Organization = { id: string; name: string };
type RuntimeConnection = { organization_id: string; status: string };
type TelephonyConnection = { id: string; organization_id: string; provider: string; external_config_id: string; name: string; status: string; is_default_outbound: boolean; created_at: string };
type Agent = { id: string; organization_id: string; name: string; status: string; current_version: number };
type Deployment = { agent_id: string; organization_id: string; status: string; provider: string; external_workflow_uuid: string | null; created_at: string };
type PhoneRoute = { id: string; organization_id: string; telephony_connection_id: string; address: string; label: string | null; agent_id: string | null; is_active: boolean; is_default_caller_id: boolean; provider_sync_ok: boolean | null; provider_sync_message: string | null; created_at: string };
type Version = { agent_id: string; version: number; config: unknown };

export default async function TelephonySettingsPage() {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
    return <main><div className="shell section"><p>Neon Postgres backend setup is required.</p><Link className="btn" href="/api/health">Health</Link></div></main>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const encryptionReady = hasRuntimeSecretEncryptionKey();
  const organizations = (await query<Organization>(
    `select o.id, o.name
       from organizations o
       join organization_members m on m.organization_id = o.id
      where m.user_id = $1 and m.role in ('owner','admin')
      order by o.created_at asc`,
    [session.user.id],
  )).rows;
  const organizationIds = organizations.map((organization) => organization.id);

  const [runtimeConnections, telephonyConnections, agents, deployments, routes, versions] = organizationIds.length
    ? await Promise.all([
        query<RuntimeConnection>(`select organization_id, status from runtime_connections where organization_id = any($1::uuid[]) and provider = 'dograh'`, [organizationIds]).then((r) => r.rows),
        query<TelephonyConnection>(`select id, organization_id, provider, external_config_id, name, status, is_default_outbound, created_at from telephony_connections where organization_id = any($1::uuid[]) order by created_at desc`, [organizationIds]).then((r) => r.rows),
        query<Agent>(`select id, organization_id, name, status, current_version from agents where organization_id = any($1::uuid[])`, [organizationIds]).then((r) => r.rows),
        query<Deployment>(`select agent_id, organization_id, status, provider, external_workflow_uuid, created_at from runtime_deployments where organization_id = any($1::uuid[]) and provider = 'dograh' and status = 'ready'`, [organizationIds]).then((r) => r.rows),
        query<PhoneRoute>(`select id, organization_id, telephony_connection_id, address, label, agent_id, is_active, is_default_caller_id, provider_sync_ok, provider_sync_message, created_at from phone_number_routes where organization_id = any($1::uuid[]) order by created_at desc`, [organizationIds]).then((r) => r.rows),
        query<Version>(`select agent_id, version, config from agent_versions where organization_id = any($1::uuid[])`, [organizationIds]).then((r) => r.rows),
      ])
    : [[], [], [], [], [], []] as [RuntimeConnection[], TelephonyConnection[], Agent[], Deployment[], PhoneRoute[], Version[]];

  return <main><div className="shell section">
    <div className="dash-top"><Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link><div style={{ display: "flex", gap: 10 }}><Link className="btn" href="/settings/runtime">Runtime</Link><Link className="btn" href="/dashboard">Dashboard</Link></div></div>
    <span className="eyebrow">TELEPHONY</span><h1 style={{ fontSize: 58 }}>Connect numbers. Route calls to real agents.</h1><p className="lede">Twilio credentials are sent directly to the organization-scoped Dograh runtime. YOURAGENT stores only Dograh configuration and phone-number references.</p>
    {organizations.map((organization) => {
      const runtime = runtimeConnections.find((item) => item.organization_id === organization.id && item.status === "active");
      const runtimeReady = Boolean(runtime) && encryptionReady;
      const orgConnections = telephonyConnections.filter((item) => item.organization_id === organization.id);
      const readyDeployments = deployments.filter((item) => item.organization_id === organization.id && item.external_workflow_uuid);
      const readyAgentIds = new Set(readyDeployments.map((item) => item.agent_id));
      const orgAgents = agents.filter((item) => item.organization_id === organization.id && readyAgentIds.has(item.id));
      const orgRoutes = routes.filter((item) => item.organization_id === organization.id);
      const outboundAgents = orgAgents.filter((agent) => {
        const current = versions.find((version) => version.agent_id === agent.id && version.version === agent.current_version);
        const config = current?.config as { goal?: { direction?: string } } | undefined;
        return config?.goal?.direction === "outbound" || config?.goal?.direction === "both";
      });
      const activeCallerIds = orgRoutes.filter((route) => route.is_active && route.provider_sync_ok !== false);

      return <section key={organization.id} style={{ marginTop: 32 }}>
        <span className="eyebrow">{organization.name}</span>
        <div className="agent-detail-grid" style={{ marginTop: 14 }}>
          <section className="card builder-card"><h2>Connect Twilio</h2>{runtimeReady ? <><p>Create the telephony configuration inside this organization's Dograh runtime.</p><TwilioConnectionForm organizationId={organization.id} /></> : <><p style={{ color: "#fca5a5" }}>A healthy encrypted Dograh tenant runtime is required before Twilio can be connected.</p><Link className="btn" href="/settings/runtime">Configure runtime first</Link></>}</section>
          {orgConnections.map((connection) => <section className="card builder-card" key={connection.id}><span className="eyebrow">{connection.provider.toUpperCase()}</span><h2>{connection.name}</h2><p>Status: <strong>{connection.status}</strong>{connection.is_default_outbound ? " · default outbound" : ""}</p><p>Dograh config ID: <code>{connection.external_config_id}</code></p><PhoneRouteForm organizationId={organization.id} telephonyConnectionId={connection.id} agents={orgAgents.map((agent) => ({ id: agent.id, name: agent.name }))} /></section>)}
          <section className="card builder-card"><span className="eyebrow">OUTBOUND</span><h2>Place a policy-gated call</h2><p>Every manual outbound call requires explicit consent evidence, DNC-clear confirmation, target timezone, and jurisdiction before YOURAGENT asks Dograh to dial.</p><OutboundCallForm organizationId={organization.id} agents={outboundAgents.map((agent) => ({ id: agent.id, name: agent.name }))} callerIds={activeCallerIds.map((route) => ({ id: route.id, address: route.address, label: route.label }))} /></section>
          <section className="card builder-card"><span className="eyebrow">PHONE ROUTES</span><h2>{orgRoutes.length} configured</h2>{!orgRoutes.length ? <p>No phone numbers routed yet.</p> : null}{orgRoutes.map((route) => { const agent = agents.find((item) => item.id === route.agent_id); const live = route.is_active && route.provider_sync_ok !== false; return <div className="agent-row" key={route.id}><div><strong>{route.address}</strong><div style={{ color: live ? "#bbf7d0" : "#fde68a", marginTop: 4 }}>{live ? "LIVE" : "NEEDS ATTENTION"} · {agent?.name ?? "Unassigned"}{route.is_default_caller_id ? " · default caller ID" : ""}</div>{route.provider_sync_message ? <div style={{ color: "#fca5a5", marginTop: 4 }}>{route.provider_sync_message}</div> : null}</div></div>; })}</section>
        </div>
      </section>;
    })}
  </div></main>;
}
