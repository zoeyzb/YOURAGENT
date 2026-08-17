"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ParameterType = "string" | "number" | "boolean" | "object" | "array";
type InitialParameter = { name: string; type: ParameterType; description: string; required: boolean };
type ParameterDraft = InitialParameter & { id: string };
type InitialAction = { label: string; url: string; method: HttpMethod; credentialUuid?: string; parameters?: InitialParameter[]; bodyTemplate?: unknown };
type ActionDraft = Omit<InitialAction, "parameters" | "bodyTemplate"> & { id: string; credentialUuid: string; parameters: ParameterDraft[]; bodyTemplateText: string };
type InitialTransfer = { label: string; destination: string; message?: string } | null;

function makeParameter(parameter?: InitialParameter): ParameterDraft {
  return { id: crypto.randomUUID(), name: parameter?.name ?? "", type: parameter?.type ?? "string", description: parameter?.description ?? "", required: parameter?.required ?? true };
}
function makeAction(action?: InitialAction): ActionDraft {
  return {
    id: crypto.randomUUID(),
    label: action?.label ?? "",
    url: action?.url ?? "",
    method: action?.method ?? "POST",
    credentialUuid: action?.credentialUuid ?? "",
    parameters: (action?.parameters ?? []).map(makeParameter),
    bodyTemplateText: action?.bodyTemplate === undefined ? "" : JSON.stringify(action.bodyTemplate, null, 2),
  };
}
function usesJsonBody(method: HttpMethod) {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

export function EditAgentForm(props: {
  agentId: string; name: string; industry: string; objective: string;
  direction: "inbound" | "outbound" | "both"; voiceProfile: string;
  httpActions: InitialAction[]; transfer: InitialTransfer;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [httpActions, setHttpActions] = useState<ActionDraft[]>(() => props.httpActions.map(makeAction));
  const [addTransfer, setAddTransfer] = useState(Boolean(props.transfer));

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
    event.preventDefault(); setBusy(true); setError(""); setSaved("");
    const form = new FormData(event.currentTarget);

    let normalizedActions: Array<Record<string, unknown>>;
    try {
      normalizedActions = httpActions.map(({ id: _id, credentialUuid, parameters, bodyTemplateText, ...action }) => {
        const bodyTemplate = usesJsonBody(action.method) && bodyTemplateText.trim() ? JSON.parse(bodyTemplateText) : undefined;
        return {
          ...action,
          parameters: parameters.map(({ id: _parameterId, ...parameter }) => parameter),
          ...(credentialUuid.trim() ? { credentialUuid: credentialUuid.trim() } : {}),
          ...(bodyTemplate !== undefined ? { bodyTemplate } : {}),
        };
      });
    } catch {
      setBusy(false);
      setError("One API body template is not valid JSON. Fix it before saving this immutable version.");
      return;
    }

    const response = await fetch(`/api/agents/${props.agentId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), industry: form.get("industry"), objective: form.get("objective"), direction: form.get("direction"), voiceProfile: form.get("voiceProfile"),
        httpActions: normalizedActions,
        transfer: addTransfer ? { label: form.get("transferLabel"), destination: form.get("transferDestination"), message: form.get("transferMessage") || undefined } : undefined,
      }),
    });
    const body = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(body.error ?? "Could not create the new agent version."); return; }
    setSaved(`Created v${body.agent.current_version}. Test it, then deploy to replace the live version.`); router.refresh();
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
      <span className="eyebrow">TOOLS & APIS</span>
      <h3 style={{ marginTop: 8 }}>{httpActions.length} API {httpActions.length === 1 ? "action" : "actions"} attached</h3>
      <p style={{ color: "#9ca3af" }}>Each API is a separate Dograh HTTP tool. GET/DELETE inputs become query parameters; POST/PUT/PATCH inputs become JSON automatically unless you provide an exact body template.</p>
      {httpActions.map((action, index) => <div className="card" key={action.id} style={{ padding: 14, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong>API action {index + 1}</strong><button className="btn" type="button" onClick={() => setHttpActions((current) => current.filter((item) => item.id !== action.id))}>Remove API</button></div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <label>Action name<input value={action.label} onChange={(event) => patchAction(action.id, { label: event.target.value })} required minLength={2} /></label>
          <label>Method<select value={action.method} onChange={(event) => patchAction(action.id, { method: event.target.value as HttpMethod })}><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
          <label style={{ gridColumn: "1 / -1" }}>Endpoint URL<input value={action.url} onChange={(event) => patchAction(action.id, { url: event.target.value })} type="url" required /></label>
          <label style={{ gridColumn: "1 / -1" }}>Dograh credential UUID<input value={action.credentialUuid} onChange={(event) => patchAction(action.id, { credentialUuid: event.target.value })} placeholder="Optional; never paste a raw API secret" /></label>
        </div>
        <div style={{ marginTop: 12 }}>
          <strong>Inputs this API needs</strong>
          {action.parameters.map((parameter, parameterIndex) => <div className="form-grid" key={parameter.id} style={{ marginTop: 10 }}>
            <label>Input {parameterIndex + 1} name<input value={parameter.name} onChange={(event) => patchParameter(action.id, parameter.id, { name: event.target.value })} required /></label>
            <label>Type<select value={parameter.type} onChange={(event) => patchParameter(action.id, parameter.id, { type: event.target.value as ParameterType })}><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option><option value="object">Object</option><option value="array">List</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>What should the agent collect?<input value={parameter.description} onChange={(event) => patchParameter(action.id, parameter.id, { description: event.target.value })} required minLength={3} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={parameter.required} onChange={(event) => patchParameter(action.id, parameter.id, { required: event.target.checked })} style={{ width: 18 }} />Required before calling</label>
            <button className="btn" type="button" onClick={() => patchAction(action.id, { parameters: action.parameters.filter((item) => item.id !== parameter.id) })}>Remove input</button>
          </div>)}
          <button className="btn" type="button" style={{ marginTop: 10 }} onClick={() => patchAction(action.id, { parameters: [...action.parameters, makeParameter()] })}>+ Add input this API needs</button>
        </div>
        {usesJsonBody(action.method) ? <label style={{ display: "grid", gap: 7, marginTop: 14 }}>
          <span>Exact JSON body template <small style={{ color: "#9ca3af" }}>(optional)</small></span>
          <textarea
            rows={6}
            value={action.bodyTemplateText}
            onChange={(event) => patchAction(action.id, { bodyTemplateText: event.target.value })}
            placeholder={'{"customer":{"email":"{{email}}"},"tags":["voice"]}'}
          />
          <small style={{ color: "#9ca3af" }}>Leave blank to send all collected inputs directly. Use Dograh placeholders such as {"{{email}}"}; nested objects and arrays are supported.</small>
        </label> : <p style={{ color: "#9ca3af", marginTop: 12 }}>Dograh sends collected inputs for {action.method} as query parameters, so no request body is used.</p>}
      </div>)}
      <button className="btn" type="button" style={{ marginTop: 12 }} onClick={() => setHttpActions((current) => [...current, makeAction()])}>+ Add another API action</button>
    </div>

    <div className="card" style={{ padding: 16 }}>
      <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={addTransfer} onChange={(event) => setAddTransfer(event.target.checked)} style={{ width: 18 }} /><strong>Human transfer</strong></label>
      {addTransfer ? <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Step name<input name="transferLabel" defaultValue={props.transfer?.label ?? ""} required={addTransfer} /></label>
        <label>Transfer number<input name="transferDestination" defaultValue={props.transfer?.destination ?? ""} placeholder="+13125551234" required={addTransfer} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Message<input name="transferMessage" defaultValue={props.transfer?.message ?? ""} /></label>
      </div> : null}
    </div>

    {error ? <p className="form-error">{error}</p> : null}{saved ? <p style={{ color: "#bbf7d0" }}>{saved}</p> : null}
    <button className="btn btn-primary" disabled={busy}>{busy ? "Saving version…" : "Save as new version"}</button>
  </form>;
}
