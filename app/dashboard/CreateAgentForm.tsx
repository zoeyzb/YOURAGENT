"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ParameterType = "string" | "number" | "boolean" | "object" | "array";
type ParameterDraft = { id: string; name: string; type: ParameterType; description: string; required: boolean };
type ActionDraft = { id: string; label: string; url: string; method: HttpMethod; credentialUuid: string; parameters: ParameterDraft[] };

function newParameter(): ParameterDraft {
  return { id: crypto.randomUUID(), name: "", type: "string", description: "", required: true };
}
function newAction(): ActionDraft {
  return { id: crypto.randomUUID(), label: "", url: "", method: "POST", credentialUuid: "", parameters: [] };
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
  function patchParameter(actionId: string, parameterId: string, patch: Partial<ParameterDraft>) {
    setHttpActions((current) => current.map((action) => action.id !== actionId ? action : {
      ...action,
      parameters: action.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, ...patch } : parameter),
    }));
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
        name: form.get("name"), industry: form.get("industry"), objective: form.get("objective"),
        direction: form.get("direction"), voiceProfile: form.get("voiceProfile"),
        httpActions: httpActions.map(({ id: _id, credentialUuid, parameters, ...action }) => ({
          ...action,
          parameters: parameters.map(({ id: _parameterId, ...parameter }) => parameter),
          ...(credentialUuid.trim() ? { credentialUuid: credentialUuid.trim() } : {}),
        })),
        transfer: addTransfer ? {
          label: form.get("transferLabel"), destination: form.get("transferDestination"),
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

  return <form className="builder-form" onSubmit={submit}>
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
      <h3 style={{ marginTop: 8 }}>Give the agent real actions, not fake integrations.</h3>
      <p style={{ color: "#9ca3af", marginTop: 6 }}>Each API card is one independent callable tool. Under it, define the caller information that tool needs. The agent can then ask naturally for missing required inputs before calling it.</p>

      {httpActions.map((action, index) => <div className="card" key={action.id} style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <strong>API action {index + 1}</strong>
          <button className="btn" type="button" onClick={() => setHttpActions((current) => current.filter((item) => item.id !== action.id))}>Remove API</button>
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>Action name<input value={action.label} onChange={(event) => patchAction(action.id, { label: event.target.value })} placeholder="Book appointment" required minLength={2} /></label>
          <label>Method<select value={action.method} onChange={(event) => patchAction(action.id, { method: event.target.value as HttpMethod })}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
          <label style={{ gridColumn: "1 / -1" }}>Endpoint URL<input value={action.url} onChange={(event) => patchAction(action.id, { url: event.target.value })} type="url" placeholder="https://api.example.com/book" required /></label>
          <label style={{ gridColumn: "1 / -1" }}>Dograh credential UUID <span style={{ color: "#9ca3af" }}>(optional; never paste API secrets here)</span><input value={action.credentialUuid} onChange={(event) => patchAction(action.id, { credentialUuid: event.target.value })} placeholder="Credential UUID from Dograh" /></label>
        </div>

        <div style={{ marginTop: 14 }}>
          <strong>Inputs this API needs</strong>
          <p style={{ color: "#9ca3af", marginTop: 4 }}>Example: <code>customer_name</code>, <code>phone</code>, <code>appointment_time</code>. These become typed tool arguments.</p>
          {action.parameters.map((parameter, parameterIndex) => <div className="form-grid" key={parameter.id} style={{ marginTop: 10 }}>
            <label>Input {parameterIndex + 1} name<input value={parameter.name} onChange={(event) => patchParameter(action.id, parameter.id, { name: event.target.value })} placeholder="customer_name" required /></label>
            <label>Type<select value={parameter.type} onChange={(event) => patchParameter(action.id, parameter.id, { type: event.target.value as ParameterType })}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option><option value="object">Object</option><option value="array">List</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>What should the agent collect?<input value={parameter.description} onChange={(event) => patchParameter(action.id, parameter.id, { description: event.target.value })} placeholder="Customer's full name for the appointment" required minLength={3} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={parameter.required} onChange={(event) => patchParameter(action.id, parameter.id, { required: event.target.checked })} style={{ width: 18 }} />Required before calling</label>
            <button className="btn" type="button" onClick={() => patchAction(action.id, { parameters: action.parameters.filter((item) => item.id !== parameter.id) })}>Remove input</button>
          </div>)}
          <button className="btn" type="button" style={{ marginTop: 10 }} onClick={() => patchAction(action.id, { parameters: [...action.parameters, newParameter()] })}>+ Add input this API needs</button>
        </div>
      </div>)}

      <button className="btn" type="button" style={{ marginTop: 14 }} onClick={() => setHttpActions((current) => [...current, newAction()])}>+ Add another API action</button>
      <p style={{ color: "#9ca3af", marginTop: 8 }}>Click again for API action 2, 3, 4, etc. Up to 12 separate API tools can be attached in this simple builder.</p>
    </div>

    <div className="card" style={{ padding: 18 }}>
      <span className="eyebrow">STEP 3 · HUMAN HANDOFF · OPTIONAL</span>
      <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}><input type="checkbox" checked={addTransfer} onChange={(event) => setAddTransfer(event.target.checked)} style={{ width: 18 }} /><strong>Allow the agent to transfer a call to a person</strong></label>
      {addTransfer ? <div className="form-grid" style={{ marginTop: 12 }}>
        <label>Step name<input name="transferLabel" placeholder="Transfer to dispatcher" required={addTransfer} /></label>
        <label>Transfer number<input name="transferDestination" placeholder="+13125551234" required={addTransfer} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Message before transfer<input name="transferMessage" placeholder="I’ll connect you with our dispatcher now." /></label>
      </div> : null}
    </div>

    <div className="card" style={{ padding: 18 }}>
      <span className="eyebrow">STEP 4 · BUILD → TEST → DEPLOY</span>
      <p style={{ color: "#9ca3af", marginTop: 8 }}>Create saves a draft only. The next screen tests the real Dograh runtime and tools; deployment stays separate so a broken draft cannot silently replace a working live agent.</p>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Creating draft…" : `Create agent${httpActions.length ? ` with ${httpActions.length} API ${httpActions.length === 1 ? "action" : "actions"}` : ""}`}</button>
    </div>
  </form>;
}
