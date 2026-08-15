import { z } from "zod";
import type { AgentConfig } from "@/lib/domain";

export type RuntimeDeployment = {
  deploymentId: string;
  workflowUuid: string | null;
  agentId: string;
  version: number;
  status: "ready" | "failed";
};

export type EmbedToken = {
  token: string;
  scriptSrc: string;
  expiresAt: string | null;
};

export type WorkflowCompileOptions = {
  completionWebhookUrl?: string;
  toolBindings?: Record<string, string[]>;
};

export interface VoiceRuntimeAdapter {
  validate(config: AgentConfig): Promise<{ valid: boolean; errors: string[] }>;
  deploy(config: AgentConfig, options?: WorkflowCompileOptions): Promise<RuntimeDeployment>;
  pause(deploymentId: string): Promise<void>;
  resume(deploymentId: string): Promise<void>;
}

const DograhWorkflowResponse = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  workflow_uuid: z.string().nullable().optional(),
});

const DograhEmbedTokenResponse = z.object({
  token: z.string().min(1),
  embed_script: z.string().min(1),
  expires_at: z.string().nullable().optional(),
});

function promptForNode(node: AgentConfig["workflow"]["nodes"][number], config: AgentConfig) {
  const explicit = node.config.prompt;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  if (node.type === "ask") {
    const objective = node.config.objective;
    return typeof objective === "string" && objective.trim()
      ? `Ask focused questions that help accomplish this objective: ${objective.trim()}`
      : `Ask the caller about ${node.label}.`;
  }

  if (node.type === "tool") return `Use the configured ${node.label} tool when the required information is available. Confirm only details that matter, then continue naturally.`;
  if (node.type === "transfer") return `When the caller is ready for ${node.label}, briefly explain the handoff and use the configured transfer tool.`;
  if (node.type === "end") return "Briefly confirm the next step, thank the caller, and end the call politely.";
  if (node.type === "decision") return `Evaluate ${node.label} from the conversation and move to the correct next step.`;
  if (node.type === "say") {
    return `You are ${config.name}. ${node.label}. Be concise, natural, and follow the agent's objective: ${config.goal.objective}`;
  }

  return node.label;
}

export function toDograhWorkflowDefinition(
  config: AgentConfig,
  options: WorkflowCompileOptions = {},
) {
  const incoming = new Map<string, number>();
  for (const node of config.workflow.nodes) incoming.set(node.id, 0);
  for (const edge of config.workflow.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);

  const entryNodes = config.workflow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  if (entryNodes.length !== 1) throw new Error("Workflow requires exactly one entry node");
  const entryId = entryNodes[0].id;

  const nodes: Array<Record<string, unknown>> = config.workflow.nodes.map((node, index) => {
    const type = node.id === entryId
      ? "startCall"
      : node.type === "end"
        ? "endCall"
        : "agentNode";
    const actionToolUuids = node.type === "tool" || node.type === "transfer"
      ? options.toolBindings?.[node.id]
      : undefined;
    if ((node.type === "tool" || node.type === "transfer") && !actionToolUuids?.length) {
      throw new Error(`Workflow action node ${node.id} has no provisioned Dograh tool binding`);
    }

    return {
      id: node.id,
      type,
      position: { x: index * 320, y: 0 },
      data: {
        name: node.label,
        prompt: promptForNode(node, config),
        allow_interrupt: true,
        wait_for_user_response: type === "agentNode",
        ...(actionToolUuids?.length ? { tool_uuids: actionToolUuids } : {}),
      },
    };
  });

  if (options.completionWebhookUrl) {
    nodes.push({
      id: "youragent-completion-webhook",
      type: "webhook",
      position: { x: 0, y: 500 },
      data: {
        name: "YOURAGENT Completion Sync",
        enabled: true,
        http_method: "POST",
        endpoint_url: options.completionWebhookUrl,
        payload_template: {
          workflow_run_id: "{{workflow_run_id}}",
          workflow_id: "{{workflow_id}}",
          youragent_call_id: "{{initial_context.youragent_call_id}}",
        },
      },
    });
  }

  const edges = config.workflow.edges.map((edge, index) => ({
    id: `edge-${index + 1}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    data: {
      label: edge.condition ?? "continue",
      condition: edge.condition ?? "The current step is complete and the conversation should continue.",
    },
  }));

  return { nodes, edges };
}

export class DograhAdapter implements VoiceRuntimeAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private apiUrl(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}/api/v1${path}`;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
    };
  }

  workflowId(deploymentId: string) {
    const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
    if (!match) throw new Error("Unknown Dograh deployment id");
    return match[1];
  }

  private async setWorkflowStatus(deploymentId: string, status: "active" | "archived") {
    if (!this.baseUrl || !this.apiKey) throw new Error("Dograh runtime credentials are not configured");
    const workflowId = this.workflowId(deploymentId);
    const response = await this.fetchImpl(this.apiUrl(`/workflow/${workflowId}/status`), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh ${status} workflow failed (${response.status}): ${detail.slice(0, 500)}`);
    }
  }

  async validate(config: AgentConfig) {
    const errors: string[] = [];
    if (!config.workflow.nodes.some((node) => node.type === "end")) errors.push("Workflow requires an end node");
    if (config.goal.direction !== "inbound" && !config.complianceProfile) errors.push("Outbound agents require a compliance profile");

    const placeholderBindings: Record<string, string[]> = {};
    for (const node of config.workflow.nodes) {
      if (node.type !== "tool" && node.type !== "transfer") continue;
      const nodeConfig = node.config as Record<string, unknown>;
      const existingUuid = typeof nodeConfig.dograhToolUuid === "string" && nodeConfig.dograhToolUuid.trim();
      if (node.type === "transfer") {
        const destination = typeof nodeConfig.destination === "string" && nodeConfig.destination.trim()
          ? nodeConfig.destination.trim()
          : config.transferNumber;
        if (!existingUuid && !destination) errors.push(`Transfer node ${node.id} requires a destination or dograhToolUuid`);
      }
      if (node.type === "tool") {
        const url = typeof nodeConfig.url === "string" && nodeConfig.url.trim();
        if (!existingUuid && !url) errors.push(`Tool node ${node.id} requires an HTTP url or dograhToolUuid`);
      }
      placeholderBindings[node.id] = [existingUuid || "validation-placeholder"];
    }

    try {
      toDograhWorkflowDefinition(config, { toolBindings: placeholderBindings });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid Dograh workflow mapping");
    }

    return { valid: errors.length === 0, errors };
  }

  private async createWorkflow(
    config: AgentConfig,
    name: string,
    options: WorkflowCompileOptions = {},
  ): Promise<RuntimeDeployment> {
    const validation = await this.validate(config);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    if (!this.baseUrl || !this.apiKey) throw new Error("Dograh runtime credentials are not configured");

    const response = await this.fetchImpl(this.apiUrl("/workflow/create/definition"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        name,
        workflow_definition: toDograhWorkflowDefinition(config, options),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh create workflow failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const workflow = DograhWorkflowResponse.parse(await response.json());

    const validationResponse = await this.fetchImpl(this.apiUrl(`/workflow/${workflow.id}/validate`), {
      method: "POST",
      headers: this.headers(),
    });
    if (!validationResponse.ok) {
      const detail = await validationResponse.text();
      throw new Error(`Dograh workflow validation failed (${validationResponse.status}): ${detail.slice(0, 500)}`);
    }

    const validationBody = z.object({
      is_valid: z.boolean(),
      errors: z.array(z.object({ message: z.string() })).default([]),
    }).parse(await validationResponse.json());

    if (!validationBody.is_valid) {
      throw new Error(`Dograh rejected workflow: ${validationBody.errors.map((error) => error.message).join("; ")}`);
    }

    return {
      deploymentId: `dograh-workflow:${workflow.id}`,
      workflowUuid: workflow.workflow_uuid ?? null,
      agentId: config.id,
      version: config.version,
      status: "ready",
    };
  }

  async deploy(config: AgentConfig, options: WorkflowCompileOptions = {}): Promise<RuntimeDeployment> {
    return this.createWorkflow(config, `${config.name} v${config.version}`, options);
  }

  async deployPreview(config: AgentConfig, options: WorkflowCompileOptions = {}): Promise<RuntimeDeployment> {
    return this.createWorkflow(config, `[YOURAGENT TEST] ${config.name} v${config.version} ${Date.now()}`, options);
  }

  async createEmbedToken(
    deploymentId: string,
    options: {
      allowedDomains: string[];
      usageLimit?: number;
      expiresInDays?: number;
      settings?: Record<string, unknown>;
    },
  ): Promise<EmbedToken> {
    if (!this.baseUrl || !this.apiKey) throw new Error("Dograh runtime credentials are not configured");
    if (!options.allowedDomains.length) throw new Error("Embed token requires an explicit domain allowlist");

    const workflowId = this.workflowId(deploymentId);
    const response = await this.fetchImpl(this.apiUrl(`/workflow/${workflowId}/embed-token`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        allowed_domains: options.allowedDomains,
        settings: options.settings ?? { widgetType: "voice", embedMode: "headless", autoStart: false },
        usage_limit: options.usageLimit ?? 5,
        expires_in_days: options.expiresInDays ?? 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh create embed token failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const token = DograhEmbedTokenResponse.parse(await response.json());
    const scriptMatch = /js\.src\s*=\s*['"]([^'"]+)['"]/.exec(token.embed_script);
    if (!scriptMatch) throw new Error("Dograh embed response did not include a widget script URL");

    return {
      token: token.token,
      scriptSrc: scriptMatch[1],
      expiresAt: token.expires_at ?? null,
    };
  }

  async pause(deploymentId: string) {
    await this.setWorkflowStatus(deploymentId, "archived");
  }

  async resume(deploymentId: string) {
    await this.setWorkflowStatus(deploymentId, "active");
  }
}
