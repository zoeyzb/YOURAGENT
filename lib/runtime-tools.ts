import { z } from "zod";
import type { AgentConfig } from "@/lib/domain";
import { DograhToolAdapter, type DograhToolParameter } from "@/lib/adapters/dograh-tools";

const ParametersSchema = z.array(z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().min(1),
  required: z.boolean().optional().default(true),
}));

const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function stringConfig(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export type ProvisionedRuntimeTools = {
  bindings: Record<string, string[]>;
  createdToolUuids: string[];
};

export async function provisionDograhWorkflowTools(
  config: AgentConfig,
  adapter: DograhToolAdapter,
): Promise<ProvisionedRuntimeTools> {
  const bindings: Record<string, string[]> = {};
  const createdToolUuids: string[] = [];

  for (const node of config.workflow.nodes) {
    if (node.type !== "tool" && node.type !== "transfer") continue;

    const nodeConfig = node.config as Record<string, unknown>;
    const existingUuid = stringConfig(nodeConfig, "dograhToolUuid");
    if (existingUuid) {
      bindings[node.id] = [existingUuid];
      continue;
    }

    if (node.type === "transfer") {
      const destination = stringConfig(nodeConfig, "destination") ?? config.transferNumber;
      if (!destination) throw new Error(`Transfer node ${node.id} requires a destination or agent transferNumber`);
      const timeoutRaw = nodeConfig.timeout;
      const timeout = typeof timeoutRaw === "number" && Number.isInteger(timeoutRaw) ? timeoutRaw : undefined;
      const created = await adapter.createTransferTool({
        name: `${config.name} · ${node.label}`,
        description: stringConfig(nodeConfig, "description") ?? `Transfer the caller when the ${node.label} step is reached.`,
        destination,
        timeout,
        message: stringConfig(nodeConfig, "message"),
      });
      bindings[node.id] = [created.tool_uuid];
      createdToolUuids.push(created.tool_uuid);
      continue;
    }

    const url = stringConfig(nodeConfig, "url");
    if (!url) throw new Error(`Tool node ${node.id} requires dograhToolUuid or an HTTP url`);
    const method = HttpMethodSchema.parse((stringConfig(nodeConfig, "method") ?? "POST").toUpperCase());
    const description = stringConfig(nodeConfig, "description") ?? `Perform the ${node.label} action when the conversation reaches this step.`;
    const headersRaw = nodeConfig.headers;
    const headers = headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)
      ? Object.fromEntries(Object.entries(headersRaw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined;
    const parameters = nodeConfig.parameters ? ParametersSchema.parse(nodeConfig.parameters) as DograhToolParameter[] : undefined;
    const bodyTemplate = nodeConfig.bodyTemplate !== undefined ? nodeConfig.bodyTemplate : undefined;
    const timeoutMs = typeof nodeConfig.timeoutMs === "number" ? nodeConfig.timeoutMs : undefined;

    const created = await adapter.createHttpApiTool({
      name: `${config.name} · ${node.label}`,
      description,
      method,
      url,
      credentialUuid: stringConfig(nodeConfig, "credentialUuid"),
      headers,
      parameters,
      bodyTemplate,
      timeoutMs,
    });
    bindings[node.id] = [created.tool_uuid];
    createdToolUuids.push(created.tool_uuid);
  }

  return { bindings, createdToolUuids };
}

export async function rollbackProvisionedDograhTools(
  adapter: DograhToolAdapter,
  toolUuids: string[],
) {
  await Promise.allSettled(toolUuids.map((toolUuid) => adapter.archiveTool(toolUuid)));
}
