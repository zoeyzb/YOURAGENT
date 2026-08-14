"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RuntimeStatusButton({ agentId, action }: { agentId: string; action: "pause" | "resume" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changeStatus() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/agents/${agentId}/deployment-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      setError(body.error ?? `Failed to ${action} agent`);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <button className="btn" onClick={changeStatus} disabled={busy}>
        {busy ? `${action === "pause" ? "Pausing" : "Resuming"}…` : action === "pause" ? "Pause runtime" : "Resume runtime"}
      </button>
      {error ? <p style={{ color: "#fca5a5", marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
