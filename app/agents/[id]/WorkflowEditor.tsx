"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type WorkflowNode = {
  id: string;
  type: "say" | "ask" | "decision" | "tool" | "transfer" | "end";
  label: string;
  config: Record<string, unknown>;
};

type WorkflowEdge = {
  from: string;
  to: string;
  condition?: string;
};

const conversationTypes: WorkflowNode["type"][] = ["say", "ask", "decision", "end"];

function promptText(node: WorkflowNode) {
  const value = node.config.prompt ?? node.config.objective;
  return typeof value === "string" ? value : "";
}

export function WorkflowEditor({
  agentId,
  initialNodes,
  initialEdges,
}: {
  agentId: string;
  initialNodes: WorkflowNode[];
  initialEdges: WorkflowEdge[];
}) {
  const router = useRouter();
  const [nodes, setNodes] = useState<WorkflowNode[]>(initialNodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>(initialEdges);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const structure = useMemo(() => {
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    return {
      entries: nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).length,
      ends: nodes.filter((node) => node.type === "end").length,
    };
  }, [nodes, edges]);

  function updateNode(index: number, patch: Partial<WorkflowNode>) {
    setNodes((current) => current.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...patch } : node));
  }

  function updatePrompt(index: number, value: string) {
    setNodes((current) => current.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node;
      const config = { ...node.config };
      if (node.type === "ask") {
        if (value.trim()) config.objective = value;
        else delete config.objective;
      } else {
        if (value.trim()) config.prompt = value;
        else delete config.prompt;
      }
      return { ...node, config };
    }));
  }

  function addNode() {
    const id = `step-${crypto.randomUUID().slice(0, 8)}`;
    setNodes((current) => [...current, { id, type: "ask", label: "New conversation step", config: {} }]);
  }

  function removeNode(id: string) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.from !== id && edge.to !== id));
  }

  function updateEdge(index: number, patch: Partial<WorkflowEdge>) {
    setEdges((current) => current.map((edge, edgeIndex) => edgeIndex === index ? { ...edge, ...patch } : edge));
  }

  function addEdge() {
    if (nodes.length < 2) return;
    setEdges((current) => [...current, { from: nodes[0].id, to: nodes[nodes.length - 1].id, condition: "" }]);
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");

    const response = await fetch(`/api/agents/${agentId}/workflow`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes, edges }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      if (body.error === "INVALID_WORKFLOW" && Array.isArray(body.issues)) {
        setError(body.issues.map((issue: { message?: string }) => issue.message).filter(Boolean).join(" · ") || "Invalid workflow");
      } else {
        setError(body.error ?? "Could not save workflow version");
      }
      return;
    }

    setMessage(`Workflow saved as immutable v${body.agent?.current_version ?? "next"}.`);
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="status">{nodes.length} NODES</span>
          <span className="status">{edges.length} EDGES</span>
          <span className="status" style={{ color: structure.entries === 1 ? "#bbf7d0" : "#fca5a5" }}>{structure.entries} ENTRY</span>
          <span className="status" style={{ color: structure.ends >= 1 ? "#bbf7d0" : "#fca5a5" }}>{structure.ends} END</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" type="button" onClick={addNode}>+ Node</button>
          <button className="btn" type="button" onClick={addEdge} disabled={nodes.length < 2}>+ Edge</button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save as new version"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {nodes.map((node, index) => {
          const actionNode = node.type === "tool" || node.type === "transfer";
          return <section className="card" key={node.id} style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <span className="eyebrow">NODE {index + 1}</span>
              <button className="btn" type="button" onClick={() => removeNode(node.id)} disabled={nodes.length <= 1}>Remove</button>
            </div>
            <code style={{ display: "block", margin: "10px 0", color: "#9ca3af" }}>{node.id}</code>
            <label style={{ display: "grid", gap: 7, marginTop: 10 }}>
              <span>Type</span>
              {actionNode
                ? <input value={node.type} disabled />
                : <select value={node.type} onChange={(event) => updateNode(index, { type: event.target.value as WorkflowNode["type"] })}>
                    {conversationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>}
            </label>
            <label style={{ display: "grid", gap: 7, marginTop: 10 }}>
              <span>Label</span>
              <input value={node.label} onChange={(event) => updateNode(index, { label: event.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 7, marginTop: 10 }}>
              <span>{node.type === "ask" ? "Objective" : "Prompt override"}</span>
              <textarea
                rows={3}
                value={promptText(node)}
                onChange={(event) => updatePrompt(index, event.target.value)}
                placeholder={actionNode ? "Optional conversation prompt; action credentials stay in the action configuration." : "Leave blank to let YOURAGENT compile a prompt from the node label and agent objective."}
              />
            </label>
            {actionNode ? <p style={{ color: "#fde68a", marginTop: 10 }}>Action-specific URL/credential/transfer settings are preserved here and managed in the agent action form below.</p> : null}
          </section>;
        })}
      </div>

      <section className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div><span className="eyebrow">ROUTING</span><h3 style={{ marginTop: 6 }}>Edges and conditions</h3></div>
          <button className="btn" type="button" onClick={addEdge} disabled={nodes.length < 2}>+ Edge</button>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {edges.map((edge, index) => <div key={`${edge.from}-${edge.to}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(140px,1fr) auto minmax(140px,1fr) minmax(180px,2fr) auto", gap: 10, alignItems: "center" }}>
            <select value={edge.from} onChange={(event) => updateEdge(index, { from: event.target.value })}>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            <span>→</span>
            <select value={edge.to} onChange={(event) => updateEdge(index, { to: event.target.value })}>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            <input value={edge.condition ?? ""} onChange={(event) => updateEdge(index, { condition: event.target.value })} placeholder="Condition, e.g. caller is qualified" />
            <button className="btn" type="button" onClick={() => setEdges((current) => current.filter((_, edgeIndex) => edgeIndex !== index))}>Remove</button>
          </div>)}
          {!edges.length ? <p style={{ color: "#fde68a" }}>No edges. Add routing so the workflow has exactly one entry and a path to an end node.</p> : null}
        </div>
      </section>

      {message ? <p style={{ color: "#bbf7d0" }}>{message}</p> : null}
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
    </div>
  );
}
