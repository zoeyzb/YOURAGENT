import { describe, expect, it, vi } from "vitest";
import { buildAgentConfig } from "@/lib/agent-builder";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";

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
