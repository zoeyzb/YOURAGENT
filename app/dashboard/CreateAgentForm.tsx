"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateAgentForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addHttpAction, setAddHttpAction] = useState(false);
  const [addTransfer, setAddTransfer] = useState(false);

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
        httpAction: addHttpAction ? {
          label: form.get("httpActionLabel"),
          url: form.get("httpActionUrl"),
          method: form.get("httpActionMethod"),
          credentialUuid: form.get("httpActionCredentialUuid") || undefined,
        } : undefined,
        transfer: addTransfer ? {
          label: form.get("transferLabel"),
          destination: form.get("transferDestination"),
          message: form.get("transferMessage") || undefined,
        } : undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));
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

      <div className="card" style={{ padding: 18 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={addHttpAction} onChange={(event) => setAddHttpAction(event.target.checked)} style={{ width: 18 }} />
          <strong>Add an API action</strong>
        </label>
        <p style={{ color: "#9ca3af", marginTop: 6 }}>For booking, CRM updates, webhooks, or another HTTP API. Credentials stay in Dograh; paste only a Dograh credential UUID if the endpoint needs authentication.</p>
        {addHttpAction ? <div className="form-grid" style={{ marginTop: 12 }}>
          <label>Action name<input name="httpActionLabel" placeholder="Book appointment" required={addHttpAction} /></label>
          <label>Method<select name="httpActionMethod" defaultValue="POST"><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
          <label style={{ gridColumn: "1 / -1" }}>Endpoint URL<input name="httpActionUrl" type="url" placeholder="https://api.example.com/book" required={addHttpAction} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Dograh credential UUID <span style={{ color: "#9ca3af" }}>(optional)</span><input name="httpActionCredentialUuid" placeholder="Only if the endpoint needs auth" /></label>
        </div> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={addTransfer} onChange={(event) => setAddTransfer(event.target.checked)} style={{ width: 18 }} />
          <strong>Add human transfer</strong>
        </label>
        {addTransfer ? <div className="form-grid" style={{ marginTop: 12 }}>
          <label>Step name<input name="transferLabel" placeholder="Transfer to dispatcher" required={addTransfer} /></label>
          <label>Transfer number<input name="transferDestination" placeholder="+13125551234" required={addTransfer} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Message before transfer<input name="transferMessage" placeholder="I’ll connect you with our dispatcher now." /></label>
        </div> : null}
      </div>

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create agent"}</button>
    </form>
  );
}
