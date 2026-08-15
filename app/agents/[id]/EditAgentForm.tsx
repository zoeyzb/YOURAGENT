"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type InitialAction = {
  label: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  credentialUuid?: string;
} | null;

type InitialTransfer = {
  label: string;
  destination: string;
  message?: string;
} | null;

export function EditAgentForm(props: {
  agentId: string;
  name: string;
  industry: string;
  objective: string;
  direction: "inbound" | "outbound" | "both";
  voiceProfile: string;
  httpAction: InitialAction;
  transfer: InitialTransfer;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [addHttpAction, setAddHttpAction] = useState(Boolean(props.httpAction));
  const [addTransfer, setAddTransfer] = useState(Boolean(props.transfer));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/agents/${props.agentId}`, {
      method: "PATCH",
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
      setError(body.error ?? "Could not create the new agent version.");
      return;
    }
    setSaved(`Created v${body.agent.current_version}. Test it, then deploy to replace the live version.`);
    router.refresh();
  }

  return <form className="builder-form" onSubmit={submit}>
    <div className="form-grid">
      <label>Agent name<input name="name" defaultValue={props.name} required minLength={2} /></label>
      <label>Industry<input name="industry" defaultValue={props.industry} required minLength={2} /></label>
      <label>Direction<select name="direction" defaultValue={props.direction}><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="both">Both</option></select></label>
      <label>Voice<select name="voiceProfile" defaultValue={props.voiceProfile}><option value="warm-professional">Warm professional</option><option value="direct-concise">Direct & concise</option><option value="friendly-receptionist">Friendly receptionist</option></select></label>
    </div>
    <label>Objective<textarea name="objective" defaultValue={props.objective} required minLength={10} rows={4} /></label>

    <div className="card" style={{ padding: 16 }}>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="checkbox" checked={addHttpAction} onChange={(event) => setAddHttpAction(event.target.checked)} style={{ width: 18 }} />
        <strong>API action</strong>
      </label>
      {addHttpAction ? <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Action name<input name="httpActionLabel" defaultValue={props.httpAction?.label ?? ""} required={addHttpAction} /></label>
        <label>Method<select name="httpActionMethod" defaultValue={props.httpAction?.method ?? "POST"}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
        <label style={{ gridColumn: "1 / -1" }}>Endpoint URL<input name="httpActionUrl" type="url" defaultValue={props.httpAction?.url ?? ""} required={addHttpAction} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Dograh credential UUID<input name="httpActionCredentialUuid" defaultValue={props.httpAction?.credentialUuid ?? ""} placeholder="Optional" /></label>
      </div> : null}
    </div>

    <div className="card" style={{ padding: 16 }}>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="checkbox" checked={addTransfer} onChange={(event) => setAddTransfer(event.target.checked)} style={{ width: 18 }} />
        <strong>Human transfer</strong>
      </label>
      {addTransfer ? <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Step name<input name="transferLabel" defaultValue={props.transfer?.label ?? ""} required={addTransfer} /></label>
        <label>Transfer number<input name="transferDestination" defaultValue={props.transfer?.destination ?? ""} placeholder="+13125551234" required={addTransfer} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Message<input name="transferMessage" defaultValue={props.transfer?.message ?? ""} /></label>
      </div> : null}
    </div>

    {error ? <p className="form-error">{error}</p> : null}
    {saved ? <p style={{ color: "#bbf7d0" }}>{saved}</p> : null}
    <button className="btn btn-primary" disabled={busy}>{busy ? "Saving version…" : "Save as new version"}</button>
  </form>;
}
