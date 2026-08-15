"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshCallButton({ callId, disabled = false }: { callId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/calls/${callId}/refresh`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Could not refresh call");
      return;
    }
    router.refresh();
  }

  return <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
    <button className="btn" type="button" onClick={refresh} disabled={disabled || busy}>
      {busy ? "Refreshing…" : "Refresh from runtime"}
    </button>
    {error ? <small style={{ color: "#fca5a5", maxWidth: 240, textAlign: "right" }}>{error}</small> : null}
  </div>;
}
