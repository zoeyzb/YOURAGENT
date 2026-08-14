"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateAgentForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        industry: form.get("industry"),
        objective: form.get("objective"),
        direction: form.get("direction"),
        voiceProfile: form.get("voiceProfile"),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error === "UNAUTHENTICATED" ? "Sign in first." : body.error ?? "Could not create agent.");
      return;
    }
    router.push(`/agents/${body.agent.id}`);
    router.refresh();
  }

  return (
    <form className="builder-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Agent name<input name="name" placeholder="Jessica" required minLength={2} /></label>
        <label>Industry<input name="industry" placeholder="HVAC" required minLength={2} /></label>
        <label>Direction<select name="direction" defaultValue="inbound"><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="both">Both</option></select></label>
        <label>Voice<select name="voiceProfile" defaultValue="warm-professional"><option value="warm-professional">Warm professional</option><option value="direct-concise">Direct & concise</option><option value="friendly-receptionist">Friendly receptionist</option></select></label>
      </div>
      <label>What should this agent do?<textarea name="objective" placeholder="Answer missed HVAC calls, understand the problem, collect contact details, and book a service appointment." required minLength={10} rows={5} /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create agent"}</button>
    </form>
  );
}
