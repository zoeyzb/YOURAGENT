"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AgentOption = { id: string; name: string };
type CallerIdOption = { id: string; address: string; label?: string | null };

export function OutboundCallForm({
  organizationId,
  agents,
  callerIds,
}: {
  organizationId: string;
  agents: AgentOption[];
  callerIds: CallerIdOption[];
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [phoneRouteId, setPhoneRouteId] = useState(callerIds[0]?.id ?? "");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [jurisdiction, setJurisdiction] = useState("US-IL");
  const [consent, setConsent] = useState(false);
  const [dncClear, setDncClear] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canSubmit = useMemo(
    () => Boolean(agentId && phoneRouteId && phoneNumber && timezone && jurisdiction && consent && dncClear && consentNote.trim()),
    [agentId, phoneRouteId, phoneNumber, timezone, jurisdiction, consent, dncClear, consentNote],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/calls/outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        agentId,
        phoneRouteId,
        phoneNumber,
        timezone,
        jurisdiction,
        consent,
        dncClear,
        consentNote,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      if (body.error === "OUTBOUND_POLICY_BLOCKED") {
        setError(`Call blocked: ${(body.reasons ?? []).join(", ")}`);
      } else {
        setError(body.error ?? "Could not start outbound call");
      }
      return;
    }

    setMessage(`Call initiated. Dograh run ${body.call?.external_run_id ?? "created"}.`);
    setPhoneNumber("");
    setConsent(false);
    setDncClear(false);
    setConsentNote("");
    router.refresh();
  }

  if (!agents.length || !callerIds.length) {
    return <p style={{ color: "#fde68a" }}>You need a live outbound-capable agent and an active synced caller ID before placing a call.</p>;
  }

  return <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Agent</span>
      <select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
    </label>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Caller ID</span>
      <select value={phoneRouteId} onChange={(e) => setPhoneRouteId(e.target.value)} required>
        {callerIds.map((route) => <option key={route.id} value={route.id}>{route.label ? `${route.label} · ` : ""}{route.address}</option>)}
      </select>
    </label>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Number to call</span>
      <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+13125551234" required />
    </label>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Target timezone</span>
      <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Chicago" required />
    </label>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Jurisdiction</span>
      <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="US-IL" required />
    </label>
    <label>
      <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Consent evidence</span>
      <textarea value={consentNote} onChange={(e) => setConsentNote(e.target.value)} placeholder="Example: Customer requested a callback on the web form on Aug 15." required rows={3} />
    </label>
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 18, marginTop: 3 }} />
      <span>I confirm this person has consented to this outbound call.</span>
    </label>
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <input type="checkbox" checked={dncClear} onChange={(e) => setDncClear(e.target.checked)} style={{ width: 18, marginTop: 3 }} />
      <span>I confirm this number is clear under the applicable do-not-call/suppression rules.</span>
    </label>
    <button className="btn btn-primary" disabled={busy || !canSubmit}>{busy ? "Calling…" : "Start outbound call"}</button>
    {message ? <p style={{ color: "#bbf7d0" }}>{message}</p> : null}
    {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
  </form>;
}
