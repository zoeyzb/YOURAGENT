import { describe, expect, it } from "vitest";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";

const base = {
  name: "Jessica",
  industry: "HVAC",
  objective: "Answer calls and complete the requested service task.",
  direction: "inbound" as const,
  voiceProfile: "warm-professional",
};
const ids = { agentId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002" };

describe("multi API agent builder", () => {
  it("creates each configured API with independent typed caller inputs", () => {
    const payload = AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Book appointment", url: "https://api.example.com/book", method: "POST", parameters: [
        { name: "customer_name", type: "string", description: "Customer full name", required: true },
        { name: "preferred_time", type: "string", description: "Requested appointment time", required: true },
      ] },
      { label: "Update CRM", url: "https://api.example.com/crm", method: "PATCH", credentialUuid: "cred-crm", parameters: [
        { name: "lead_score", type: "number", description: "Qualified lead score", required: false },
      ] },
    ] });
    const config = buildAgentConfig({ ...ids, version: 1, payload });
    const tools = config.workflow.nodes.filter((node) => node.type === "tool");
    expect(tools.map((node) => node.id)).toEqual(["action-1", "action-2"]);
    expect(tools[0].config.parameters).toEqual([
      { name: "customer_name", type: "string", description: "Customer full name", required: true },
      { name: "preferred_time", type: "string", description: "Requested appointment time", required: true },
    ]);
    expect(tools[1].config.parameters).toEqual([
      { name: "lead_score", type: "number", description: "Qualified lead score", required: false },
    ]);
    expect(tools[1].config.credentialUuid).toBe("cred-crm");
    expect(config.workflow.edges).toContainEqual({ from: "action-1", to: "action-2" });
  });

  it("stores nested Dograh JSON body templates on managed API nodes", () => {
    const bodyTemplate = {
      customer: { email: "{{email}}" },
      tags: ["voice", "{{source}}"],
    };
    const payload = AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Create lead", url: "https://api.example.com/leads", method: "POST", bodyTemplate, parameters: [
        { name: "email", type: "string", description: "Customer email", required: true },
        { name: "source", type: "string", description: "Lead source", required: true },
      ] },
    ] });
    const config = buildAgentConfig({ ...ids, version: 1, payload });
    expect(config.workflow.nodes.find((node) => node.id === "action-1")?.config.bodyTemplate).toEqual(bodyTemplate);
  });

  it("preserves an existing body template when a later settings save omits it", () => {
    const previous = buildAgentConfig({ ...ids, version: 1, payload: AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Create lead", url: "https://api.example.com/leads", method: "POST", bodyTemplate: { email: "{{email}}" } },
    ] }) });
    const next = buildAgentConfig({ ...ids, version: 2, payload: AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Create lead updated", url: "https://api.example.com/leads", method: "POST" },
    ] }), previous });
    expect(next.workflow.nodes.find((node) => node.id === "action-1")?.config.bodyTemplate).toEqual({ email: "{{email}}" });
  });

  it("rejects unsafe or malformed tool argument names", () => {
    expect(() => AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Bad action", url: "https://api.example.com", method: "POST", parameters: [
        { name: "customer name", type: "string", description: "Customer name", required: true },
      ] },
    ] })).toThrow();
  });

  it("keeps legacy singular API payloads working", () => {
    const payload = AgentBuilderInputSchema.parse({ ...base, httpAction: { label: "Legacy action", url: "https://api.example.com/legacy", method: "POST" } });
    const config = buildAgentConfig({ ...ids, version: 1, payload });
    expect(config.workflow.nodes.find((node) => node.id === "action-1")?.label).toBe("Legacy action");
  });

  it("never overwrites a custom graph tool when settings add managed APIs", () => {
    const previous = buildAgentConfig({ ...ids, version: 1, payload: AgentBuilderInputSchema.parse({ ...base }) });
    previous.workflow.nodes.splice(2, 0, { id: "custom-tool", type: "tool", label: "Custom graph tool", config: { dograhToolUuid: "tool-custom" } });
    previous.workflow.edges = [{ from: "start", to: "discover" }, { from: "discover", to: "custom-tool" }, { from: "custom-tool", to: "finish" }];
    const next = buildAgentConfig({ ...ids, version: 2, payload: AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "Managed API", url: "https://api.example.com/managed", method: "POST", parameters: [{ name: "phone", type: "string", description: "Caller phone number", required: true }] },
    ] }), previous });
    expect(next.workflow.nodes.find((node) => node.id === "custom-tool")?.config.dograhToolUuid).toBe("tool-custom");
    expect(next.workflow.nodes.find((node) => node.id === "action-1")?.config.parameters).toEqual([{ name: "phone", type: "string", description: "Caller phone number", required: true }]);
  });

  it("removes only surplus managed actions when a later version has fewer APIs", () => {
    const previous = buildAgentConfig({ ...ids, version: 1, payload: AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "One", url: "https://api.example.com/one", method: "POST" }, { label: "Two", url: "https://api.example.com/two", method: "POST" },
    ] }) });
    const next = buildAgentConfig({ ...ids, version: 2, payload: AgentBuilderInputSchema.parse({ ...base, httpActions: [
      { label: "One updated", url: "https://api.example.com/one-v2", method: "PUT" },
    ] }), previous });
    expect(next.workflow.nodes.find((node) => node.id === "action-1")?.label).toBe("One updated");
    expect(next.workflow.nodes.some((node) => node.id === "action-2")).toBe(false);
  });
});
