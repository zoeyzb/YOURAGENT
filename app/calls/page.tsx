import Link from "next/link";
import { headers } from "next/headers";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { RefreshCallButton } from "./RefreshCallButton";

export const dynamic = "force-dynamic";

type CostInfo = Record<string, unknown> | null;
type CallRow = {
  id: string;
  agent_id: string;
  agent_version: number;
  direction: string;
  status: string;
  started_at: string | null;
  created_at: string;
  runtime_provider: string | null;
  external_run_id: string | null;
  transcript_url: string | null;
  recording_url: string | null;
  cost_info: CostInfo;
  usage_info: Record<string, unknown> | null;
  gathered_context: Record<string, unknown> | null;
  is_test: boolean;
  metadata: Record<string, unknown>;
};

function summarizeCost(cost: CostInfo) {
  if (!cost) return "—";
  for (const key of ["total_cost", "total", "cost", "amount"]) {
    const value = cost[key];
    if (typeof value === "number") return `$${value.toFixed(4)}`;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Recorded";
}

export default async function CallsPage() {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
    return <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><h1>Calls need a Postgres backend.</h1><p>Connect the Neon database and run the secured bootstrap before call history can load.</p></div></div></main>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const result = await query<CallRow>(
    `select distinct c.id, c.agent_id, c.agent_version, c.direction, c.status, c.started_at, c.created_at,
            c.runtime_provider, c.external_run_id, c.transcript_url, c.recording_url, c.cost_info,
            c.usage_info, c.gathered_context, c.is_test, c.metadata
       from calls c
       join organization_members m on m.organization_id = c.organization_id
      where m.user_id = $1
      order by c.created_at desc
      limit 100`,
    [session.user.id],
  );
  const calls = result.rows;

  return <main><div className="shell section">
    <div className="dash-top"><Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link><Link className="btn" href="/dashboard">Agents</Link></div>
    <div style={{ marginTop: 30 }}><span className="eyebrow">CALL HISTORY</span><h1 style={{ fontSize: 58 }}>Every run leaves evidence.</h1><p className="lede">Dograh run IDs, completion state, artifacts, usage and cost are persisted here. Test calls are marked separately from production calls.</p></div>
    <div className="card builder-card" style={{ marginTop: 28 }}>
      <h2>{calls.length} recent calls</h2>
      {!calls.length ? <p>No calls recorded yet. Run a browser voice test from an agent page.</p> : null}
      {calls.map((call) => <article className="agent-row" key={call.id} style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><strong>{call.is_test ? "TEST CALL" : "CALL"} · {call.status.toUpperCase()}</strong><span className="eyebrow">{call.direction}</span><span className="eyebrow">{call.runtime_provider ?? "unknown provider"}</span></div>
          <div style={{ color: "#9ca3af", marginTop: 8 }}>Run {call.external_run_id ?? "—"} · agent v{call.agent_version} · {new Date(call.started_at ?? call.created_at).toLocaleString()}</div>
          {call.gathered_context && Object.keys(call.gathered_context).length ? <details style={{ marginTop: 12 }}><summary>Gathered context</summary><pre className="hash">{JSON.stringify(call.gathered_context, null, 2)}</pre></details> : null}
        </div>
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}><strong>{summarizeCost(call.cost_info)}</strong>{call.external_run_id ? <RefreshCallButton callId={call.id} /> : null}{call.transcript_url ? <a className="btn" href={call.transcript_url} target="_blank" rel="noreferrer">Transcript</a> : null}{call.recording_url ? <a className="btn" href={call.recording_url} target="_blank" rel="noreferrer">Recording</a> : null}<Link className="btn" href={`/agents/${call.agent_id}`}>Agent</Link></div>
      </article>)}
    </div>
  </div></main>;
}
