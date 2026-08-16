import { describe, expect, it } from "vitest";
import { WorkflowDraftSchema } from "@/lib/workflow-editor";

const validWorkflow = {
  nodes: [
    { id: "start", type: "say" as const, label: "Greeting", config: {} },
    { id: "discover", type: "ask" as const, label: "Discovery", config: {} },
    { id: "finish", type: "end" as const, label: "Close", config: {} },
  ],
  edges: [
    { from: "start", to: "discover" },
    { from: "discover", to: "finish" },
  ],
};

describe("workflow editor validation", () => {
  it("accepts a graph with one entry and an end node", () => {
    expect(WorkflowDraftSchema.parse(validWorkflow)).toEqual(validWorkflow);
  });

  it("rejects duplicate node ids", () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validWorkflow,
      nodes: [...validWorkflow.nodes, { id: "start", type: "ask" as const, label: "Duplicate", config: {} }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("Duplicate workflow node id"))).toBe(true);
  });

  it("rejects edges that reference missing nodes", () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validWorkflow,
      edges: [{ from: "start", to: "missing" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("Unknown target node"))).toBe(true);
  });

  it("rejects workflows with multiple entry nodes", () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validWorkflow,
      edges: [{ from: "start", to: "finish" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("exactly one entry node"))).toBe(true);
  });

  it("rejects workflows without an end node", () => {
    const result = WorkflowDraftSchema.safeParse({
      nodes: [
        { id: "start", type: "say", label: "Greeting", config: {} },
        { id: "discover", type: "ask", label: "Discovery", config: {} },
      ],
      edges: [{ from: "start", to: "discover" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("end node"))).toBe(true);
  });
});
