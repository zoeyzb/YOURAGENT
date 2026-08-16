import { describe, expect, it, vi } from "vitest";
import { buildAgentConfig } from "@/lib/agent-builder";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import type { AgentConfig } from "@/lib/domain";

const agentId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";

describe("immutable agent configuration building", () => {
  it("builds a new version with real action and transfer nodes", () => {
    const config = buildAgentConfig({
      agentId,
      organizationId,
      version: 2,
      payload: {
        name: "Jessica",
        industry: "HVAC",
        objective: "Qualify the caller and book the correct service appointment.",
        direction: "both",
        voiceProfile: "warm-professional",
        httpAction: {
          label: "Book appointment",
          method: "POST",
          url: "https://calendar.example/book",
          credentialUuid: "credential-uuid",
        },
        transfer: {
          label: "Transfer to dispatcher",
          destination: "+13125551234",
          message: "I’ll connect you with our dispatcher now.",
        },
      },
    });

    expect(config.version).toBe(2);
    expect(config.status).toBe("draft");
    expect(config.workflow.nodes.map((node) => node.type)).toEqual(["say", "ask", "tool", "transfer", "end"]);
    expect(config.workflow.edges).toEqual([
      { from: "start", to: "discover" },
      { from: "discover", to: "action-1" },
      { from: "action-1", to: "transfer-1" },
      { from: "transfer-1", to: "finish" },
    ]);
    expect(config.transferNumber).toBe("+13125551234");
    expect(config.complianceProfile).toBe("us-outbound-default-deny");
  });

  it("preserves a custom workflow graph when ordinary settings change", () => {
    const previous: AgentConfig = {
      id: agentId,
      organizationId,
      name: "Jessica",
      goal: { objective: "Old objective", direction: "inbound", industry: "HVAC" },
      status: "draft",
      version: 4,
      voiceProfile: "warm-professional",
      llmProfile: "balanced-reasoning",
      sttProfile: "fast-english",
      skills: [],
      workflow: {
        nodes: [
          { id: "start", type: "say", label: "Custom greeting", config: { prompt: "Welcome back." } },
          { id: "discover", type: "ask", label: "Custom discovery", config: { objective: "Old objective", prompt: "What happened?" } },
          { id: "route", type: "decision", label: "Urgency route", config: { rubric: "urgent-vs-normal" } },
          { id: "urgent", type: "say", label: "Urgent response", config: { prompt: "We can help now." } },
          { id: "normal", type: "say", label: "Normal response", config: { prompt: "Let's schedule." } },
          { id: "finish", type: "end", label: "Custom close", config: {} },
        ],
        edges: [
          { from: "start", to: "discover" },
          { from: "discover", to: "route" },
          { from: "route", to: "urgent", condition: "urgent" },
          { from: "route", to: "normal", condition: "normal" },
          { from: "urgent", to: "finish" },
          { from: "normal", to: "finish" },
        ],
      },
      tools: [],
      knowledgeBaseIds: [],
      complianceProfile: "inbound-standard",
      createdAt: "2026-08-16T00:00:00.000Z",
    };

    const next = buildAgentConfig({
      agentId,
      organizationId,
      version: 5,
      previous,
      payload: {
        name: "Jessica Updated",
        industry: "HVAC",
        objective: "Identify the issue and route the caller without losing custom logic.",
        direction: "inbound",
        voiceProfile: "calm-professional",
      },
    });

    expect(next.workflow.nodes.map((node) => node.id)).toEqual(previous.workflow.nodes.map((node) => node.id));
    expect(next.workflow.edges).toEqual(previous.workflow.edges);
    expect(next.workflow.nodes.find((node) => node.id === "route")?.config).toEqual({ rubric: "urgent-vs-normal" });
    expect(next.workflow.nodes.find((node) => node.id === "discover")?.config).toEqual({
      objective: "Identify the issue and route the caller without losing custom logic.",
      prompt: "What happened?",
    });
    expect(next.name).toBe("Jessica Updated");
    expect(next.voiceProfile).toBe("calm-professional");
  });

  it("removes only the simple managed action node when the settings action is cleared", () => {
    const previous = buildAgentConfig({
      agentId,
      organizationId,
      version: 1,
      payload: {
        name: "Jessica",
        industry: "HVAC",
        objective: "Qualify callers and book the right appointment quickly.",
        direction: "inbound",
        voiceProfile: "warm-professional",
        httpAction: { label: "Book", method: "POST", url: "https://calendar.example/book" },
      },
    });

    const next = buildAgentConfig({
      agentId,
      organizationId,
      version: 2,
      previous,
      payload: {
        name: "Jessica",
        industry: "HVAC",
        objective: "Qualify callers and book the right appointment quickly.",
        direction: "inbound",
        voiceProfile: "warm-professional",
      },
    });

    expect(next.workflow.nodes.map((node) => node.id)).toEqual(["start", "discover", "finish"]);
    expect(next.workflow.edges).toEqual([
      { from: "start", to: "discover" },
      { from: "discover", to: "finish" },
    ]);
  });
});

describe("Dograh phone-number lifecycle", () => {
  it("moves an existing phone number to a replacement workflow with PUT", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 91,
      telephony_configuration_id: 7,
      address: "+13125551234",
      address_normalized: "+13125551234",
      address_type: "pstn",
      country_code: "US",
      label: "Main line",
      inbound_workflow_id: 84,
      inbound_workflow_name: "Jessica v2",
      is_active: true,
      is_default_caller_id: true,
      provider_sync: { ok: true, message: null },
    }), { status: 200 }));

    const adapter = new DograhTelephonyAdapter("https://dograh.example", "dg_test", mockFetch);
    const updated = await adapter.updatePhoneNumber({
      configurationId: 7,
      phoneNumberId: 91,
      inboundWorkflowId: 84,
      label: "Main line",
      isActive: true,
    });

    expect(updated.inbound_workflow_id).toBe(84);
    expect(updated.provider_sync?.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/organizations/telephony-configs/7/phone-numbers/91",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"inbound_workflow_id":84'),
      }),
    );
  });

  it("can deactivate a routed number when an agent is paused", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 91,
      telephony_configuration_id: 7,
      address: "+13125551234",
      address_normalized: "+13125551234",
      address_type: "pstn",
      country_code: "US",
      label: "Main line",
      inbound_workflow_id: 84,
      inbound_workflow_name: "Jessica v2",
      is_active: false,
      is_default_caller_id: true,
      provider_sync: { ok: true, message: null },
    }), { status: 200 }));

    const adapter = new DograhTelephonyAdapter("https://dograh.example", "dg_test", mockFetch);
    const updated = await adapter.updatePhoneNumber({
      configurationId: 7,
      phoneNumberId: 91,
      inboundWorkflowId: 84,
      label: "Main line",
      isActive: false,
    });

    expect(updated.is_active).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/organizations/telephony-configs/7/phone-numbers/91",
      expect.objectContaining({ body: expect.stringContaining('"is_active":false') }),
    );
  });
});
