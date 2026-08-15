import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/env";
import { RefreshCallButton } from "./RefreshCallButton";

export const dynamic = "force-dynamic";

type CostInfo = Record<string, unknown> | null;

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
  if (!hasSupabaseEnv()) {
    return <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="setup-card"><h1>Calls need the YOURAGENT database.</h1><p>Connect the dedicated Supabase project and apply migrations before call history can load.</p></div></div></main>;
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return <main><div className="shell section"><p>Please sign in.</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></main>;
  }

  const { data: calls, error } = await supabase
    .from("calls")
    .select("id,agent_id,agent_version,direction,status,started_at,created_at,runtime_provider,external_run_id,transcript_url,recording_url,cost_info,usage_info,gathered_context,is_test,metadata")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  return <main><div className="shell section">
    <div className="dash-top">
      <Link className="brand" href="/dashboard"><span className="brand-dot" />YOURAGENT</Link>
      <Link className="btn" href="/dashboard">Agents</Link>
    </div>

    <div style={{ marginTop: 30 }}>
      <span className="eyebrow">CALL HISTORY</span>
      <h1 style={{ fontSize: 58 }}>Every run leaves evidence.</h1>
      <p className="lede">Dograh run IDs, completion state, artifacts, usage and cost are persisted here. Test calls are marked separately from production calls.</p>
    </div>

    <div className="card builder-card" style={{ marginTop: 28 }}>
      <h2>{calls?.length ?? 0} recent calls</h2>
      {!calls?.length ? <p>No calls recorded yet. Run a browser voice test from an agent page.</p> : null}
      {calls?.map((call) => (
        <article className="agent-row" key={call.id} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong>{call.is_test ? "TEST CALL" : "CALL"} · {String(call.status).toUpperCase()}</strong>
              <span className="eyebrow">{call.direction}</span>
              <span className="eyebrow">{call.runtime_provider ?? "unknown provider"}</span>
            </div>
            <div style={{ color: "#9ca3af", marginTop: 8 }}>
              Run {call.external_run_id ?? "—"} · agent v{call.agent_version} · {new Date(call.started_at ?? call.created_at).toLocaleString()}
            </div>
            {call.gathered_context && Object.keys(call.gathered_context as Record<string, unknown>).length ? (
              <details style={{ marginTop: 12 }}><summary>Gathered context</summary><pre className="hash">{JSON.stringify(call.gathered_context, null, 2)}</pre></details>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <strong>{summarizeCost(call.cost_info as CostInfo)}</strong>
            {call.external_run_id ? <RefreshCallButton callId={call.id} /> : null}
            {call.transcript_url ? <a className="btn" href={call.transcript_url} target="_blank" rel="noreferrer">Transcript</a> : null}
            {call.recording_url ? <a className="btn" href={call.recording_url} target="_blank" rel="noreferrer">Recording</a> : null}
            <Link className="btn" href={`/agents/${call.agent_id}`}>Agent</Link>
          </div>
        </article>
      ))}
    </div>
  </div></main>;
}
