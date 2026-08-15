"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AgentOption = { id: string; name: string };

export function PhoneRouteForm({
  organizationId,
  telephonyConnectionId,
  agents,
}: {
  organizationId: string;
  telephonyConnectionId: string;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [label, setLabel] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [defaultCaller, setDefaultCaller] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/telephony/phone-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        telephonyConnectionId,
        agentId,
        address,
        countryCode: countryCode.trim() ? countryCode.trim().toUpperCase() : undefined,
        label: label.trim() || undefined,
        isDefaultCallerId: defaultCaller,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not route phone number");
      return;
    }

    setAddress("");
    setCountryCode("");
    setLabel("");
    setMessage(body.live === false
      ? `Number was saved, but provider sync warned: ${body.providerSync?.message ?? "Twilio webhook sync failed"}`
      : "Phone number is routed to the deployed agent.");
    router.refresh();
  }

  if (!agents.length) {
    return <p style={{ color: "#fca5a5" }}>Deploy at least one agent before assigning an inbound phone number.</p>;
  }

  return <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Phone number</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="+13125551234" required /></label>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Country code if number has no + prefix</span><input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="US" maxLength={2} /></label>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Label</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main sales line" /></label>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Route inbound calls to</span><select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={defaultCaller} onChange={(e) => setDefaultCaller(e.target.checked)} style={{ width: 18 }} /><span>Use as default outbound caller ID</span></label>
    <button className="btn btn-primary" disabled={busy}>{busy ? "Routing…" : "Add & route number"}</button>
    {message ? <p style={{ color: message.startsWith("Number was saved") ? "#fde68a" : "#bbf7d0" }}>{message}</p> : null}
    {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
  </form>;
}
