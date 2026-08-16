"use client";

import { useState } from "react";

export function CleanupTestSessionsButton({ organizationId }: { organizationId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function cleanup() {
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/runtime/test-sessions/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not clean expired test previews");
      return;
    }

    const remaining = Number(body.remainingEligible ?? 0);
    setMessage(
      `Cleaned ${Number(body.cleaned ?? 0)} expired preview${Number(body.cleaned ?? 0) === 1 ? "" : "s"}.` +
      (Number(body.failed ?? 0) ? ` ${Number(body.failed)} need reconciliation.` : "") +
      (remaining ? ` ${remaining} still eligible for cleanup.` : ""),
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button className="btn" onClick={cleanup} disabled={busy}>
        {busy ? "Cleaning previews…" : "Clean expired test previews"}
      </button>
      {message ? <p style={{ color: "#bbf7d0", marginTop: 10 }}>{message}</p> : null}
      {error ? <p style={{ color: "#fca5a5", marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
