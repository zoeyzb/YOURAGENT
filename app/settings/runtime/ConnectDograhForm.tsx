"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectDograhForm({
  organizationId,
  initialBaseUrl = "https://api.dograh.com",
  connected = false,
}: {
  organizationId: string;
  initialBaseUrl?: string;
  connected?: boolean;
}) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");

    const response = await fetch("/api/runtime/dograh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, baseUrl, apiKey }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error === "DOGRAH_CREDENTIALS_REJECTED"
        ? "Dograh rejected that API key. Check the key and runtime URL."
        : body.error ?? "Could not connect Dograh");
      return;
    }

    setApiKey("");
    setMessage("Dograh verified. The API key is stored in Supabase Vault, not in a readable app table.");
    router.refresh();
  }

  return (
    <form onSubmit={connect} style={{ display: "grid", gap: 14, marginTop: 18 }}>
      <label>
        <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Dograh API URL</span>
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
      </label>
      <label>
        <span style={{ display: "block", marginBottom: 7, color: "#9ca3af" }}>Dograh API key</span>
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          autoComplete="off"
          placeholder={connected ? "Paste a new key to rotate it" : "Paste organization-scoped API key"}
          required
        />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Verifying…" : connected ? "Verify & rotate key" : "Verify & connect Dograh"}
      </button>
      {message ? <p style={{ color: "#bbf7d0" }}>{message}</p> : null}
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
    </form>
  );
}
