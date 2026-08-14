import { describe, expect, it } from "vitest";
import { canPublish, nextVersion, type AgentVersion } from "@/lib/versioning";

const base: AgentVersion = {
  id: "v1",
  agentId: "a1",
  version: 1,
  status: "testing",
  configHash: "abc",
  createdAt: new Date().toISOString(),
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
});
