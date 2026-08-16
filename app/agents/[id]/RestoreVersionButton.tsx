"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RestoreVersionButton({
  agentId,
  version,
}: {
  agentId: string;
  version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    if (!window.confirm(`Restore v${version} as a new draft version? The existing live deployment will stay live until you deploy the restored version.`)) {
      return;
    }

    setBusy(true);
    setError("");
    const response = await fetch(`/api/agents/${agentId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetVersion: version }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      setError(body.error ?? "Could not restore this version");
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <button className="btn" onClick={restore} disabled={busy}>
        {busy ? "Restoring…" : `Restore v${version}`}
      </button>
      {error ? <span style={{ color: "#fca5a5", fontSize: 13 }}>{error}</span> : null}
    </div>
  );
}
