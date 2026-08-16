import { AgentConfigSchema, type AgentConfig } from "@/lib/domain";

export function restoreAgentConfigVersion(
  source: AgentConfig,
  nextVersion: number,
  createdAt = new Date().toISOString(),
): AgentConfig {
  if (!Number.isInteger(nextVersion) || nextVersion <= source.version) {
    throw new Error("INVALID_RESTORE_VERSION");
  }

  return AgentConfigSchema.parse({
    ...source,
    version: nextVersion,
    status: "draft",
    createdAt,
  });
}
