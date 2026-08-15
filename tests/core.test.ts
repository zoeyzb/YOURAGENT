import { describe, expect, it, vi } from "vitest";
import { evaluateCallPolicy } from "@/lib/policy";
import { MemoryIdempotencyStore, once } from "@/lib/idempotency";
import { resolveSkills } from "@/lib/skills";
import type { AgentConfig } from "@/lib/domain";
import { DograhAdapter, toDograhWorkflowDefinition } from "@/lib/adapters/voice-runtime";
import { DograhTelephonyAdapter } from "@/lib/adapters/dograh-telephony";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { triggerDograhOutboundCall } from "@/lib/adapters/dograh-outbound";

const agentConfig: AgentConfig = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  name: "Test Agent",
  goal: { objective: "Qualify the caller and understand their service need", direction: "inbound", industry: "HVAC" },
  status: "draft",
  version: 1,
  voiceProfile: "warm-professional",
  llmProfile: "balanced-reasoning",
  sttProfile: "fast-english",
  skills: [],
  workflow: {
    nodes: [
      { id: "start", type: "say", label: "Greeting", config: {} },
      { id: "discover", type: "ask", label: "Discover need", config: { objective: "Understand the HVAC problem" } },
      { id: "finish", type: "end", label: "Close", config: {} },
    ],
    edges: [
      { from: "start", to: "discover" },
      { from: "discover", to: "finish" },
    ],
  },
  tools: [],
  knowledgeBaseIds: [],
  complianceProfile: "inbound-standard",
  createdAt: new Date().toISOString(),
};

describe("call policy", () => {
  it("blocks outbound calls without consent", () => {
    expect(evaluateCallPolicy({ direction: "outbound", consent: false, doNotCall: false, localHour: 14, jurisdiction: "US-IL" }))
      .toEqual({ allowed: false, reasons: ["missing_consent"] });
  });

  it("blocks suppressed numbers and late calls", () => {
    const decision = evaluateCallPolicy({ direction: "outbound", consent: true, doNotCall: true, localHour: 22, jurisdiction: "US-IL" });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("do_not_call");
    expect(decision.reasons).toContain("outside_calling_window");
  });

  it("allows inbound calls with a known jurisdiction", () => {
    expect(evaluateCallPolicy({ direction: "inbound", consent: false, doNotCall: true, localHour: 2, jurisdiction: "US-IL" }).allowed).toBe(true);
  });
});

describe("idempotency", () => {
  it("executes a side effect once", async () => {
    const store = new MemoryIdempotencyStore();
    const effect = vi.fn(async () => "sent");
    expect((await once(store, "event-12345678", effect)).executed).toBe(true);
    expect((await once(store, "event-12345678", effect)).executed).toBe(false);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe("skill registry", () => {
  it("resolves known skills", () => {
    expect(resolveSkills(["conversation.active-listening", "sales.discovery"])).toHaveLength(2);
  });

  it("rejects unknown skills", () => {
    expect(() => resolveSkills(["does.not.exist"])).toThrow(/Unknown skills/);
  });
});

describe("Dograh runtime adapter", () => {
  it("maps the canonical graph to Dograh node types", () => {
    const definition = toDograhWorkflowDefinition(agentConfig);
    expect(definition.nodes.map((node) => node.type)).toEqual(["startCall", "agentNode", "endCall"]);
    expect(definition.edges).toHaveLength(2);
  });

  it("uses Dograh's real create and validate endpoints", async () => {
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, status: "active", workflow_uuid: "wf-42" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ is_valid: true, errors: [] }), { status: 200 }));

    const adapter = new DograhAdapter("https://dograh.example", "dg_test", mockFetch);
    const deployment = await adapter.deploy(agentConfig);

    expect(deployment.deploymentId).toBe("dograh-workflow:42");
    expect(deployment.workflowUuid).toBe("wf-42");
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://dograh.example/api/v1/workflow/create/definition",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://dograh.example/api/v1/workflow/42/validate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates a domain-restricted Dograh headless embed token", async () => {
    const embedScript = "<script>var js={}; js.src='https://dograh.example/embed/dograh-widget.js?token=emb_123&apiEndpoint=https://dograh.example';</script>";
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "emb_123",
        embed_script: embedScript,
        expires_at: "2026-08-16T00:00:00Z",
      }), { status: 200 }));

    const adapter = new DograhAdapter("https://dograh.example", "dg_test", mockFetch);
    const token = await adapter.createEmbedToken("dograh-workflow:42", {
      allowedDomains: ["https://youragent.example"],
      usageLimit: 3,
      expiresInDays: 1,
      settings: { widgetType: "voice", embedMode: "headless", autoStart: false },
    });

    expect(token.token).toBe("emb_123");
    expect(token.scriptSrc).toContain("dograh-widget.js?token=emb_123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/workflow/42/embed-token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"allowed_domains":["https://youragent.example"]'),
      }),
    );
  });

  it("refuses unrestricted embed tokens", async () => {
    const adapter = new DograhAdapter("https://dograh.example", "dg_test");
    await expect(adapter.createEmbedToken("dograh-workflow:42", { allowedDomains: [] }))
      .rejects.toThrow(/explicit domain allowlist/i);
  });

  it("requires an actionable configuration before provisioning a tool node", async () => {
    const config: AgentConfig = {
      ...agentConfig,
      workflow: {
        nodes: [
          ...agentConfig.workflow.nodes.slice(0, 2),
          { id: "tool", type: "tool", label: "Book calendar", config: {} },
          agentConfig.workflow.nodes[2],
        ],
        edges: [
          { from: "start", to: "discover" },
          { from: "discover", to: "tool" },
          { from: "tool", to: "finish" },
        ],
      },
    };
    const adapter = new DograhAdapter("https://dograh.example", "dg_test");
    const validation = await adapter.validate(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/requires an HTTP url or dograhToolUuid/i);
  });

  it("compiles provisioned Dograh tool UUIDs onto action nodes", () => {
    const config: AgentConfig = {
      ...agentConfig,
      transferNumber: "+13125550000",
      workflow: {
        nodes: [
          agentConfig.workflow.nodes[0],
          { id: "book", type: "tool", label: "Book appointment", config: { url: "https://example.com/book" } },
          { id: "transfer", type: "transfer", label: "Transfer to human", config: { destination: "+13125550000" } },
          agentConfig.workflow.nodes[2],
        ],
        edges: [
          { from: "start", to: "book" },
          { from: "book", to: "transfer" },
          { from: "transfer", to: "finish" },
        ],
      },
    };

    const definition = toDograhWorkflowDefinition(config, {
      toolBindings: {
        book: ["tool-book-uuid"],
        transfer: ["tool-transfer-uuid"],
      },
    });
    const book = definition.nodes.find((node) => node.id === "book");
    const transfer = definition.nodes.find((node) => node.id === "transfer");
    expect((book?.data as Record<string, unknown>).tool_uuids).toEqual(["tool-book-uuid"]);
    expect((transfer?.data as Record<string, unknown>).tool_uuids).toEqual(["tool-transfer-uuid"]);
  });
});

describe("Dograh tool adapter", () => {
  it("creates a reusable transfer-call tool", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 1,
      tool_uuid: "transfer-uuid",
      name: "Transfer to human",
      description: "Transfer the live call",
      category: "transfer_call",
      status: "active",
      definition: {},
      created_at: "2026-08-15T00:00:00Z",
    }), { status: 200 }));
    const adapter = new DograhToolAdapter("https://dograh.example", "dg_test", mockFetch);

    const tool = await adapter.createTransferTool({
      name: "Transfer to human",
      destination: "+13125550000",
      message: "I’ll connect you now.",
    });

    expect(tool.tool_uuid).toBe("transfer-uuid");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/tools/",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"type":"transfer_call"'),
      }),
    );
  });

  it("creates an HTTP API tool with a Dograh credential reference", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 2,
      tool_uuid: "http-uuid",
      name: "Book appointment",
      description: "Book an appointment",
      category: "http_api",
      status: "active",
      definition: {},
      created_at: "2026-08-15T00:00:00Z",
    }), { status: 200 }));
    const adapter = new DograhToolAdapter("https://dograh.example", "dg_test", mockFetch);

    const tool = await adapter.createHttpApiTool({
      name: "Book appointment",
      description: "Book an appointment",
      method: "POST",
      url: "https://calendar.example/book",
      credentialUuid: "credential-uuid",
      parameters: [{ name: "email", type: "string", description: "Customer email", required: true }],
      bodyTemplate: { email: "{{email}}" },
    });

    expect(tool.tool_uuid).toBe("http-uuid");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/tools/",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"credential_uuid":"credential-uuid"'),
      }),
    );
  });

  it("rejects inline secret headers and archives created tools through Dograh", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ status: "archived" }), { status: 200 }));
    const adapter = new DograhToolAdapter("https://dograh.example", "dg_test", mockFetch);

    await expect(adapter.createHttpApiTool({
      name: "Unsafe",
      description: "Unsafe",
      method: "POST",
      url: "https://example.com",
      headers: { Authorization: "Bearer secret" },
    })).rejects.toThrow(/credential UUID/i);

    await adapter.archiveTool("tool-uuid");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/tools/tool-uuid",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("Dograh telephony adapter", () => {
  it("creates a Twilio configuration through Dograh's multi-config endpoint", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 7,
      name: "Twilio Default",
      provider: "twilio",
      is_default_outbound: true,
      inactive: false,
      credentials: { account_sid: "****************1234", auth_token: "****************abcd", amd_enabled: false },
      created_at: "2026-08-15T00:00:00Z",
      updated_at: "2026-08-15T00:00:00Z",
    }), { status: 200 }));

    const adapter = new DograhTelephonyAdapter("https://dograh.example", "dg_test", mockFetch);
    const config = await adapter.createTwilioConfiguration({
      name: "Twilio Default",
      accountSid: "AC1234567890",
      authToken: "secret-token",
    });

    expect(config.id).toBe(7);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/organizations/telephony-configs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"provider":"twilio"'),
      }),
    );
  });

  it("routes a phone number to a real Dograh workflow", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      id: 91,
      telephony_configuration_id: 7,
      address: "+13125551234",
      address_normalized: "+13125551234",
      address_type: "pstn",
      country_code: "US",
      label: "Main line",
      inbound_workflow_id: 42,
      inbound_workflow_name: "Agent",
      is_active: true,
      is_default_caller_id: true,
      provider_sync: { ok: true, message: null },
    }), { status: 200 }));

    const adapter = new DograhTelephonyAdapter("https://dograh.example", "dg_test", mockFetch);
    const number = await adapter.addPhoneNumber({
      configurationId: 7,
      address: "+13125551234",
      countryCode: "US",
      label: "Main line",
      inboundWorkflowId: 42,
      isDefaultCallerId: true,
    });

    expect(number.inbound_workflow_id).toBe(42);
    expect(number.provider_sync?.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/organizations/telephony-configs/7/phone-numbers",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"inbound_workflow_id":42'),
      }),
    );
  });

  it("uses Dograh delete endpoints for rollback", async () => {
    const mockFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "deleted" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "deleted" }), { status: 200 }));
    const adapter = new DograhTelephonyAdapter("https://dograh.example", "dg_test", mockFetch);

    await adapter.deletePhoneNumber(7, 91);
    await adapter.deleteConfiguration(7);

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://dograh.example/api/v1/organizations/telephony-configs/7/phone-numbers/91",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://dograh.example/api/v1/organizations/telephony-configs/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("Dograh outbound adapter", () => {
  it("triggers a published workflow by stable workflow UUID", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      status: "initiated",
      workflow_run_id: 123,
      workflow_run_name: "WR-API-1234",
    }), { status: 200 }));

    const call = await triggerDograhOutboundCall({
      baseUrl: "https://dograh.example",
      apiKey: "dg_test",
      workflowUuid: "workflow-uuid-42",
      phoneNumber: "+13125551234",
      telephonyConfigurationId: 7,
      fromPhoneNumberId: 91,
      initialContext: { source: "youragent" },
      fetchImpl: mockFetch,
    });

    expect(call.workflow_run_id).toBe(123);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dograh.example/api/v1/public/agent/workflow/workflow-uuid-42",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": "dg_test" }),
        body: expect.stringContaining('"from_phone_number_id":91'),
      }),
    );
  });
});
