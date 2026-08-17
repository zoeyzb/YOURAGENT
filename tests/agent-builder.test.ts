import { describe, expect, it } from "vitest";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";

const base = {
  name: "Jessica",
  industry: "HVAC",
  objective: "Answer calls and complete the requested service task.",
  direction: "inbound" as const,
  voiceProfile: "warm-professional",
};

const ids = {
  agentId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
};

describe("multi API agent builder", () => {
  it("creates each configured API as an independent workflow tool", () => {
    const payload = AgentBuilderInputSchema.parse({
      ...base,
      httpActions: [
        { label: "Book appointment", url: "https://api.example.com/book", method: "POST" },
        { label: "Update CRM", url: "https://api.example.com/crm", method: "PATCH", credentialUuid: "cred-crm" },
      ],
    });
    const config = buildAgentConfig({ ...ids, version: 1, payload });
    const tools = config.workflow.nodes.filter((node) => node.type === "tool");

    expect(tools.map((node) => node.id)).toEqual(["action-1", "action-2"]);
    expect(tools.map((node) => node.label)).toEqual(["Book appointment", "Update CRM"]);
    expect(tools[1].config.credentialUuid).toBe("cred-crm");
    expect(config.workflow.edges).toContainEqual({ from: "action-1", to: "action-2" });
  });

  it("keeps legacy singular API payloads working", () => {
    const payload = AgentBuilderInputSchema.parse({
      ...base,
      httpAction: { label: "Legacy action", url: "https://api.example.com/legacy", method: "POST" },
    });
    const config = buildAgentConfig({ ...ids, version: 1, payload });
    expect(config.workflow.nodes.find((node) => node.id === "action-1")?.label).toBe("Legacy action");
  });

  it("never overwrites a custom graph tool when settings add managed APIs", () => {
    const initialPayload = AgentBuilderInputSchema.parse({ ...base });
    const previous = buildAgentConfig({ ...ids, version: 1, payload: initialPayload });
    previous.workflow.nodes.splice(2, 0, {
      id: "custom-tool",
      type: "tool",
      label: "Custom graph tool",
      config: { dograhToolUuid: "tool-custom" },
    });
    previous.workflow.edges = [
      { from: "start", to: "discover" },
      { from: "discover", to: "custom-tool" },
      { from: "custom-tool", to: "finish" },
    ];

    const nextPayload = AgentBuilderInputSchema.parse({
      ...base,
      httpActions: [
        { label: "Managed API", url: "https://api.example.com/managed", method: "POST" },
      ],
    });
    const next = buildAgentConfig({ ...ids, version: 2, payload: nextPayload, previous });

    expect(next.workflow.nodes.find((node) => node.id === "custom-tool")?.config.dograhToolUuid).toBe("tool-custom");
    expect(next.workflow.nodes.find((node) => node.id === "action-1")?.label).toBe("Managed API");
  });

  it("removes only surplus managed actions when a later version has fewer APIs", () => {
    const v1Payload = AgentBuilderInputSchema.parse({
      ...base,
      httpActions: [
        { label: "One", url: "https://api.example.com/one", method: "POST" },
        { label: "Two", url: "https://api.example.com/two", method: "POST" },
      ],
    });
    const previous = buildAgentConfig({ ...ids, version: 1, payload: v1Payload });
    const v2Payload = AgentBuilderInputSchema.parse({
      ...base,
      httpActions: [{ label: "One updated", url: "https://api.example.com/one-v2", method: "PUT" }],
    });
    const next = buildAgentConfig({ ...ids, version: 2, payload: v2Payload, previous });

    expect(next.workflow.nodes.find((node) => node.id === "action-1")?.label).toBe("One updated");
    expect(next.workflow.nodes.some((node) => node.id === "action-2")).toBe(false);
  });
});
