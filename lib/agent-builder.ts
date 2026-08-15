import { z } from "zod";
import type { AgentConfig } from "@/lib/domain";
import { resolveSkills } from "@/lib/skills";

export const HttpActionInputSchema = z.object({
  label: z.string().trim().min(2).max(80),
  url: z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "Action URL must use HTTP(S)"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  credentialUuid: z.string().trim().min(1).max(255).optional(),
}).optional();

export const TransferInputSchema = z.object({
  label: z.string().trim().min(2).max(80),
  destination: z.string().trim().regex(/^\+\d{8,15}$/, "Transfer number must use E.164 format"),
  message: z.string().trim().max(300).optional(),
}).optional();

export const AgentBuilderInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().min(2).max(80),
  objective: z.string().trim().min(10).max(1000),
  direction: z.enum(["inbound", "outbound", "both"]),
  voiceProfile: z.string().trim().min(2).default("warm-professional"),
  httpAction: HttpActionInputSchema,
  transfer: TransferInputSchema,
});

export type AgentBuilderInput = z.infer<typeof AgentBuilderInputSchema>;

export function buildAgentConfig(options: {
  agentId: string;
  organizationId: string;
  version: number;
  payload: AgentBuilderInput;
  previous?: AgentConfig | null;
}): AgentConfig {
  const { agentId, organizationId, version, payload, previous } = options;
  const skills = resolveSkills([
    "conversation.active-listening",
    "conversation.concise-human",
    ...(payload.direction === "outbound" || payload.direction === "both"
      ? ["sales.discovery", "compliance.opt-out"]
      : []),
  ]);

  const workflowNodes: AgentConfig["workflow"]["nodes"] = [
    { id: "start", type: "say", label: "Greeting", config: { purpose: "introduce-and-disclose" } },
    { id: "discover", type: "ask", label: "Discover need", config: { objective: payload.objective } },
  ];

  if (payload.httpAction) {
    workflowNodes.push({
      id: "action-1",
      type: "tool",
      label: payload.httpAction.label,
      config: {
        url: payload.httpAction.url,
        method: payload.httpAction.method,
        description: `Use ${payload.httpAction.label} when the caller has provided the information required to complete the requested action.`,
        ...(payload.httpAction.credentialUuid ? { credentialUuid: payload.httpAction.credentialUuid } : {}),
      },
    });
  }

  if (payload.transfer) {
    workflowNodes.push({
      id: "transfer-1",
      type: "transfer",
      label: payload.transfer.label,
      config: {
        destination: payload.transfer.destination,
        ...(payload.transfer.message ? { message: payload.transfer.message } : {}),
      },
    });
  }

  workflowNodes.push({ id: "finish", type: "end", label: "Close", config: {} });
  const workflowEdges = workflowNodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: workflowNodes[index + 1].id,
  }));

  return {
    id: agentId,
    organizationId,
    name: payload.name,
    goal: {
      objective: payload.objective,
      direction: payload.direction,
      industry: payload.industry,
    },
    status: "draft",
    version,
    voiceProfile: payload.voiceProfile,
    llmProfile: previous?.llmProfile ?? "balanced-reasoning",
    sttProfile: previous?.sttProfile ?? "fast-english",
    skills,
    workflow: { nodes: workflowNodes, edges: workflowEdges },
    tools: [...new Set([...(previous?.tools ?? []), ...skills.flatMap((skill) => skill.requiredTools)])],
    knowledgeBaseIds: previous?.knowledgeBaseIds ?? [],
    ...(payload.transfer ? { transferNumber: payload.transfer.destination } : {}),
    complianceProfile: payload.direction === "inbound" ? "inbound-standard" : "us-outbound-default-deny",
    createdAt: new Date().toISOString(),
  };
}
