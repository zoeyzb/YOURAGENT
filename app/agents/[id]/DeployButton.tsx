"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeployButton({ agentId, disabled = false }: { agentId: string; disabled?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "deploying" | "error">("idle");
  const [error, setError] = useState("");

  async function deploy() {
    setState("deploying");
    setError("");

    const response = await fetch(`/api/agents/${agentId}/deploy`, { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(body.error ?? "Deployment failed");
      setState("error");
      return;
    }

    setState("idle");
    router.refresh();
  }

  return (
    <div>
      <button className="btn btn-primary" disabled={disabled || state === "deploying"} onClick={deploy}>
        {state === "deploying" ? "Deploying…" : "Deploy to Dograh"}
      </button>
      {error ? <p style={{ color: "#fca5a5", marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}
