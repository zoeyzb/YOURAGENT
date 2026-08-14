import { describe, expect, it, vi } from "vitest";
import { evaluateCallPolicy } from "@/lib/policy";
import { MemoryIdempotencyStore, once } from "@/lib/idempotency";
import { resolveSkills } from "@/lib/skills";
import type { AgentConfig } from "@/lib/domain";
import { DograhAdapter, toDograhWorkflowDefinition } from "@/lib/adapters/voice-runtime";

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

  it("rejects tool nodes until real Dograh tool UUID mapping exists", async () => {
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
    expect(validation.errors.join(" ")).toMatch(/tool mapping is not configured/i);
  });
});
