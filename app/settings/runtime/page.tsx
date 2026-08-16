import Link from "next/link";
import { headers } from "next/headers";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { hasRuntimeSecretEncryptionKey } from "@/lib/secrets";
import { ConnectDograhForm } from "./ConnectDograhForm";

export const dynamic = "force-dynamic";

export default async function RuntimeSettingsPage() {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
    return <main><div className="shell section"><p>Neon Postgres backend setup is required.</p><Link className="btn" href="/api/health">Health</Link></div></main>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const encryptionReady = hasRuntimeSecretEncryptionKey();
  const organizationsResult = await query<{ id: string; name: string; role: string }>(
    `select o.id, o.name, m.role
       from organizations o
       join organization_members m on m.organization_id = o.id
      where m.user_id = $1 and m.role in ('owner','admin')
      order by o.created_at asc`,
    [session.user.id],
  );
  const organizations = organizationsResult.rows;
  const organizationIds = organizations.map((organization) => organization.id);

  const connections = organizationIds.length
    ? (await query<{ organization_id: string; provider: string; base_url: string; status: string; updated_at: string }>(
        `select organization_id, provider, base_url, status, updated_at
           from runtime_connections
          where organization_id = any($1::uuid[]) and provider = 'dograh'`,
        [organizationIds],
      )).rows
    : [];

  return <main><div className="shell section">
    <div className="dash-top">
      <Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link>
      <Link className="btn" href="/dashboard">Dashboard</Link>
    </div>
    <span className="eyebrow">RUNTIME SETTINGS</span>
    <h1 style={{ fontSize: 58 }}>Connect each company to its own voice runtime.</h1>
    <p className="lede">Dograh API keys are verified server-side and encrypted with AES-256-GCM before they are stored in Postgres. The browser never receives the saved key.</p>
    <p style={{ color: encryptionReady ? "#bbf7d0" : "#fca5a5" }}>
      Runtime secret encryption: {encryptionReady ? "READY" : "NOT CONFIGURED"}
    </p>
    <div className="agent-detail-grid" style={{ marginTop: 28 }}>
      {organizations.map((organization) => {
        const connection = connections.find((item) => item.organization_id === organization.id);
        return <section className="card builder-card" key={organization.id}>
          <span className="eyebrow">ORGANIZATION</span>
          <h2>{organization.name}</h2>
          <p>{connection ? `Dograh ${connection.status.toUpperCase()} · ${connection.base_url}` : "No Dograh runtime connected."}</p>
          {connection?.updated_at ? <p style={{ color: "#9ca3af" }}>Last updated {new Date(connection.updated_at).toLocaleString()}</p> : null}
          <ConnectDograhForm organizationId={organization.id} initialBaseUrl={connection?.base_url ?? "https://api.dograh.com"} connected={Boolean(connection)} encryptionReady={encryptionReady} />
        </section>;
      })}
      {!organizations.length ? <section className="card builder-card"><h2>No admin organizations.</h2><p>Create your first agent from the dashboard; YOURAGENT will create your organization automatically.</p></section> : null}
    </div>
  </div></main>;
}
