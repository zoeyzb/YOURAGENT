export type DeployableStatus = "draft" | "testing" | "published" | "paused";

export type AgentVersion = {
  id: string;
  agentId: string;
  version: number;
  status: DeployableStatus;
  configHash: string;
  createdAt: string;
};

export function nextVersion(existing: AgentVersion[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.version)) + 1;
}

export function canPublish(version: AgentVersion, checks: { schema: boolean; policy: boolean; evals: boolean; runtime: boolean }) {
  return version.status === "testing" && Object.values(checks).every(Boolean);
}
