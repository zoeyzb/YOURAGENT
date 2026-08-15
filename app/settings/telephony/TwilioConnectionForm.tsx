"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TwilioConnectionForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [name, setName] = useState("Twilio Default");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [amdEnabled, setAmdEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/telephony/twilio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        name,
        accountSid,
        authToken,
        amdEnabled,
        isDefaultOutbound: true,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not connect Twilio");
      return;
    }

    setAccountSid("");
    setAuthToken("");
    setMessage("Twilio is connected through this organization's Dograh runtime.");
    router.refresh();
  }

  return <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Connection name</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Twilio Account SID</span><input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} autoComplete="off" required /></label>
    <label><span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Twilio Auth Token</span><input value={authToken} onChange={(e) => setAuthToken(e.target.value)} type="password" autoComplete="off" required /></label>
    <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={amdEnabled} onChange={(e) => setAmdEnabled(e.target.checked)} style={{ width: 18 }} /><span>Enable answering-machine detection for outbound calls</span></label>
    <button className="btn btn-primary" disabled={busy}>{busy ? "Connecting…" : "Connect Twilio"}</button>
    {message ? <p style={{ color: "#bbf7d0" }}>{message}</p> : null}
    {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
  </form>;
}
