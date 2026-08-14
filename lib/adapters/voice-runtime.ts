import type { AgentConfig } from "@/lib/domain";

export type RuntimeDeployment = {
  deploymentId: string;
  agentId: string;
  version: number;
  status: "ready" | "failed";
};

export interface VoiceRuntimeAdapter {
  validate(config: AgentConfig): Promise<{ valid: boolean; errors: string[] }>;
  deploy(config: AgentConfig): Promise<RuntimeDeployment>;
  pause(deploymentId: string): Promise<void>;
}

export class DograhAdapter implements VoiceRuntimeAdapter {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async validate(config: AgentConfig) {
    const errors: string[] = [];
    if (!config.workflow.nodes.some((node) => node.type === "end")) errors.push("Workflow requires an end node");
    if (config.goal.direction !== "inbound" && !config.complianceProfile) errors.push("Outbound agents require a compliance profile");
    return { valid: errors.length === 0, errors };
  }

  async deploy(config: AgentConfig): Promise<RuntimeDeployment> {
    const validation = await this.validate(config);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    if (!this.baseUrl || !this.apiKey) throw new Error("Dograh runtime credentials are not configured");

    // Deliberately isolated: map the canonical AgentConfig to Dograh's live API here.
    // No UI or domain code may depend on Dograh-specific response shapes.
    return {
      deploymentId: `dograh:${config.id}:v${config.version}`,
      agentId: config.id,
      version: config.version,
      status: "ready",
    };
  }

  async pause(deploymentId: string) {
    if (!deploymentId.startsWith("dograh:")) throw new Error("Unknown Dograh deployment id");
  }
}
