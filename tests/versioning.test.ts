import { describe, expect, it } from "vitest";
import { canPublish, nextVersion, type AgentVersion } from "@/lib/versioning";
import { restoreAgentConfigVersion } from "@/lib/agent-versioning";
import type { AgentConfig } from "@/lib/domain";

const base: AgentVersion = {
  id: "v1",
  agentId: "a1",
  version: 1,
  status: "testing",
  configHash: "abc",
  createdAt: new Date().toISOString(),
};

const sourceConfig: AgentConfig = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  name: "Sales Agent",
  goal: {
    objective: "Qualify callers and book an appointment",
    direction: "both",
    industry: "HVAC",
  },
  status: "published",
  version: 2,
  voiceProfile: "warm-professional",
  llmProfile: "balanced-reasoning",
  sttProfile: "fast-english",
  skills: [],
  workflow: {
    nodes: [
      { id: "start", type: "say", label: "Greeting", config: {} },
      { id: "end", type: "end", label: "Finish", config: {} },
    ],
    edges: [{ from: "start", to: "end" }],
  },
  tools: [],
  knowledgeBaseIds: [],
  complianceProfile: "inbound-standard",
  createdAt: "2026-08-15T00:00:00.000Z",
};

describe("versioning", () => {
  it("increments versions monotonically", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([base, { ...base, id: "v3", version: 3 }])).toBe(4);
  });

  it("requires every publish check to pass", () => {
    expect(canPublish(base, { schema: true, policy: true, evals: true, runtime: true })).toBe(true);
    expect(canPublish(base, { schema: true, policy: true, evals: false, runtime: true })).toBe(false);
  });

  it("restores historical config as a new draft without mutating history", () => {
    const restored = restoreAgentConfigVersion(sourceConfig, 5, "2026-08-16T10:00:00.000Z");

    expect(restored.version).toBe(5);
    expect(restored.status).toBe("draft");
    expect(restored.createdAt).toBe("2026-08-16T10:00:00.000Z");
    expect(restored.workflow).toEqual(sourceConfig.workflow);
    expect(sourceConfig.version).toBe(2);
    expect(sourceConfig.status).toBe("published");
  });

  it("rejects restore targets that do not advance version history", () => {
    expect(() => restoreAgentConfigVersion(sourceConfig, 2)).toThrow("INVALID_RESTORE_VERSION");
    expect(() => restoreAgentConfigVersion(sourceConfig, 1)).toThrow("INVALID_RESTORE_VERSION");
  });
});
