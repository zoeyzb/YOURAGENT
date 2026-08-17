"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ActionDraft = {
  id: string;
  label: string;
  url: string;
  method: HttpMethod;
  credentialUuid: string;
};

function newAction(): ActionDraft {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    method: "POST",
    credentialUuid: "",
  };
}

export default function CreateAgentForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [httpActions, setHttpActions] = useState<ActionDraft[]>([]);
  const [addTransfer, setAddTransfer] = useState(false);

  function patchAction(id: string, patch: Partial<ActionDraft>) {
    setHttpActions((current) => current.map((action) => action.id === id ? { ...action, ...patch } : action));
  }

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
        httpActions: httpActions.map(({ id: _id, credentialUuid, ...action }) => ({
          ...action,
          ...(credentialUuid.trim() ? { credentialUuid: credentialUuid.trim() } : {}),
        })),
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
      <div className="card" style={{ padding: 18 }}>
        <span className="eyebrow">STEP 1 · DESCRIBE THE AGENT</span>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>Agent name<input name="name" placeholder="Jessica" required minLength={2} /></label>
          <label>Industry<input name="industry" placeholder="HVAC" required minLength={2} /></label>
          <label>Direction<select name="direction" defaultValue="inbound"><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="both">Both</option></select></label>
          <label>Voice<select name="voiceProfile" defaultValue="warm-professional"><option value="warm-professional">Warm professional</option><option value="direct-concise">Direct & concise</option><option value="friendly-receptionist">Friendly receptionist</option></select></label>
        </div>
        <label>What should this agent do?<textarea name="objective" placeholder="Answer missed HVAC calls, understand the problem, collect contact details, and book a service appointment." required minLength={10} rows={5} /></label>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <span className="eyebrow">STEP 2 · CONNECT TOOLS & APIS · OPTIONAL</span>
        <h3 style={{ marginTop: 8 }}>Give the agent actions it can actually perform.</h3>
        <p style={{ color: "#9ca3af", marginTop: 6 }}>
          Add as many separate API actions as the agent needs—for example one for booking, another for CRM updates, and another for sending a webhook. Each card becomes its own callable tool. Credentials stay in Dograh; YOURAGENT stores only the Dograh credential UUID.
        </p>

        {httpActions.map((action, index) => (
          <div className="card" key={action.id} style={{ padding: 16, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <strong>API action {index + 1}</strong>
              <button className="btn" type="button" onClick={() => setHttpActions((current) => current.filter((item) => item.id !== action.id))}>Remove</button>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>Action name<input value={action.label} onChange={(event) => patchAction(action.id, { label: event.target.value })} placeholder="Book appointment" required minLength={2} /></label>
              <label>Method<select value={action.method} onChange={(event) => patchAction(action.id, { method: event.target.value as HttpMethod })}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
              <label style={{ gridColumn: "1 / -1" }}>Endpoint URL<input value={action.url} onChange={(event) => patchAction(action.id, { url: event.target.value })} type="url" placeholder="https://api.example.com/book" required /></label>
              <label style={{ gridColumn: "1 / -1" }}>Dograh credential UUID <span style={{ color: "#9ca3af" }}>(optional)</span><input value={action.credentialUuid} onChange={(event) => patchAction(action.id, { credentialUuid: event.target.value })} placeholder="Only if this endpoint needs authentication" /></label>
            </div>
          </div>
        ))}

        <button className="btn" type="button" style={{ marginTop: 14 }} onClick={() => setHttpActions((current) => [...current, newAction()])}>
          + Add another API action
        </button>
        <p style={{ color: "#9ca3af", marginTop: 8 }}>You can click this again for API action 2, 3, 4, and so on. They are independent tools—not duplicate fields for one API.</p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <span className="eyebrow">STEP 3 · HUMAN HANDOFF · OPTIONAL</span>
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={addTransfer} onChange={(event) => setAddTransfer(event.target.checked)} style={{ width: 18 }} />
          <strong>Allow the agent to transfer a call to a person</strong>
        </label>
        {addTransfer ? <div className="form-grid" style={{ marginTop: 12 }}>
          <label>Step name<input name="transferLabel" placeholder="Transfer to dispatcher" required={addTransfer} /></label>
          <label>Transfer number<input name="transferDestination" placeholder="+13125551234" required={addTransfer} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Message before transfer<input name="transferMessage" placeholder="I’ll connect you with our dispatcher now." /></label>
        </div> : null}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <span className="eyebrow">STEP 4 · BUILD</span>
        <p style={{ color: "#9ca3af", marginTop: 8 }}>Creating the agent saves a draft. On the next screen you test the real runtime first, then deploy it when it passes.</p>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating draft…" : `Create agent${httpActions.length ? ` with ${httpActions.length} API ${httpActions.length === 1 ? "action" : "actions"}` : ""}`}</button>
      </div>
    </form>
  );
}
