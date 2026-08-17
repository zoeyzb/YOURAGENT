import { z } from "zod";
import type { AgentConfig } from "@/lib/domain";
import { resolveSkills } from "@/lib/skills";

const HttpActionParameterSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Parameter names must be API-safe identifiers"),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().trim().min(3).max(240),
  required: z.boolean().default(true),
});

const HttpActionSchema = z.object({
  label: z.string().trim().min(2).max(80),
  url: z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "Action URL must use HTTP(S)"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  credentialUuid: z.string().trim().min(1).max(255).optional(),
  parameters: z.array(HttpActionParameterSchema).max(24).optional(),
  bodyTemplate: z.unknown().optional(),
});

export const HttpActionInputSchema = HttpActionSchema.optional();
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
  httpActions: z.array(HttpActionSchema).max(12).optional(),
  httpAction: HttpActionInputSchema,
  transfer: TransferInputSchema,
});

export type AgentBuilderInput = z.infer<typeof AgentBuilderInputSchema>;
type Workflow = AgentConfig["workflow"];
type WorkflowNode = Workflow["nodes"][number];

function requestedHttpActions(payload: AgentBuilderInput) {
  if (payload.httpActions !== undefined) return payload.httpActions;
  return payload.httpAction ? [payload.httpAction] : [];
}
function cloneWorkflow(workflow: Workflow): Workflow {
  return { nodes: workflow.nodes.map((node) => ({ ...node, config: { ...node.config } })), edges: workflow.edges.map((edge) => ({ ...edge })) };
}
function removeSimpleManagedNode(workflow: Workflow, nodeId: string) {
  const incoming = workflow.edges.filter((edge) => edge.to === nodeId);
  const outgoing = workflow.edges.filter((edge) => edge.from === nodeId);
  if (incoming.length !== 1 || outgoing.length !== 1) return false;
  const [before] = incoming, [after] = outgoing;
  workflow.nodes = workflow.nodes.filter((node) => node.id !== nodeId);
  workflow.edges = workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  workflow.edges.push({ from: before.from, to: after.to, ...(before.condition ? { condition: before.condition } : after.condition ? { condition: after.condition } : {}) });
  return true;
}
function insertManagedNodeBefore(workflow: Workflow, node: WorkflowNode, targetId: string) {
  const target = workflow.nodes.find((item) => item.id === targetId); if (!target) return false;
  const incoming = workflow.edges.filter((edge) => edge.to === target.id);
  const preferred = [...incoming].reverse().find((edge) => !edge.condition) ?? incoming[incoming.length - 1];
  workflow.nodes.push(node); if (!preferred) return true;
  workflow.edges = workflow.edges.filter((edge) => edge !== preferred);
  workflow.edges.push({ from: preferred.from, to: node.id, ...(preferred.condition ? { condition: preferred.condition } : {}) }, { from: node.id, to: target.id });
  return true;
}
function managedActionId(index: number) { return `action-${index + 1}`; }
function isManagedActionNode(node: WorkflowNode) { return node.type === "tool" && /^action-\d+$/.test(node.id); }
function actionConfig(action: ReturnType<typeof requestedHttpActions>[number]) {
  return {
    url: action.url,
    method: action.method,
    description: `Use ${action.label} only when the caller has supplied every required input. Ask naturally for missing required inputs before calling this tool.`,
    parameters: action.parameters ?? [],
    ...(action.credentialUuid ? { credentialUuid: action.credentialUuid } : {}),
    ...(action.bodyTemplate !== undefined ? { bodyTemplate: action.bodyTemplate } : {}),
  };
}

function updatePreservedWorkflow(previous: AgentConfig, payload: AgentBuilderInput): Workflow {
  const workflow = cloneWorkflow(previous.workflow), actions = requestedHttpActions(payload);
  const discovery = workflow.nodes.find((node) => node.id === "discover") ?? workflow.nodes.find((node) => node.type === "ask");
  if (discovery) discovery.config = { ...discovery.config, objective: payload.objective };
  for (const node of [...workflow.nodes.filter(isManagedActionNode)].sort((a, b) => b.id.localeCompare(a.id))) {
    const match = /^action-(\d+)$/.exec(node.id); if (match && Number(match[1]) > actions.length) removeSimpleManagedNode(workflow, node.id);
  }
  for (const [index, action] of actions.entries()) {
    const id = managedActionId(index), existing = workflow.nodes.find((node) => node.id === id && node.type === "tool");
    if (existing) {
      existing.label = action.label; existing.config = { ...existing.config, ...actionConfig(action) };
      if (!action.credentialUuid) delete existing.config.credentialUuid;
      continue;
    }
    const transfer = workflow.nodes.find((node) => node.id === "transfer-1"), end = workflow.nodes.find((node) => node.type === "end"), targetId = transfer?.id ?? end?.id;
    if (targetId) insertManagedNodeBefore(workflow, { id, type: "tool", label: action.label, config: actionConfig(action) }, targetId);
  }
  const existingTransfer = workflow.nodes.find((node) => node.id === "transfer-1");
  if (payload.transfer) {
    const transferConfig = { destination: payload.transfer.destination, ...(payload.transfer.message ? { message: payload.transfer.message } : {}) };
    if (existingTransfer) {
      existingTransfer.label = payload.transfer.label; existingTransfer.config = { ...existingTransfer.config, ...transferConfig };
      if (!payload.transfer.message) delete existingTransfer.config.message;
    } else {
      const end = workflow.nodes.find((node) => node.type === "end");
      if (end) insertManagedNodeBefore(workflow, { id: "transfer-1", type: "transfer", label: payload.transfer.label, config: transferConfig }, end.id);
    }
  } else if (existingTransfer) removeSimpleManagedNode(workflow, "transfer-1");
  return workflow;
}

function buildDefaultWorkflow(payload: AgentBuilderInput): Workflow {
  const workflowNodes: Workflow["nodes"] = [
    { id: "start", type: "say", label: "Greeting", config: { purpose: "introduce-and-disclose" } },
    { id: "discover", type: "ask", label: "Discover need", config: { objective: payload.objective } },
  ];
  requestedHttpActions(payload).forEach((action, index) => workflowNodes.push({ id: managedActionId(index), type: "tool", label: action.label, config: actionConfig(action) }));
  if (payload.transfer) workflowNodes.push({ id: "transfer-1", type: "transfer", label: payload.transfer.label, config: { destination: payload.transfer.destination, ...(payload.transfer.message ? { message: payload.transfer.message } : {}) } });
  workflowNodes.push({ id: "finish", type: "end", label: "Close", config: {} });
  return { nodes: workflowNodes, edges: workflowNodes.slice(0, -1).map((node, index) => ({ from: node.id, to: workflowNodes[index + 1].id })) };
}

export function buildAgentConfig(options: { agentId: string; organizationId: string; version: number; payload: AgentBuilderInput; previous?: AgentConfig | null }): AgentConfig {
  const { agentId, organizationId, version, payload, previous } = options;
  const skills = resolveSkills(["conversation.active-listening", "conversation.concise-human", ...(payload.direction === "outbound" || payload.direction === "both" ? ["sales.discovery", "compliance.opt-out"] : [])]);
  const workflow = previous ? updatePreservedWorkflow(previous, payload) : buildDefaultWorkflow(payload);
  return {
    id: agentId, organizationId, name: payload.name,
    goal: { objective: payload.objective, direction: payload.direction, industry: payload.industry },
    status: "draft", version, voiceProfile: payload.voiceProfile,
    llmProfile: previous?.llmProfile ?? "balanced-reasoning", sttProfile: previous?.sttProfile ?? "fast-english",
    skills, workflow,
    tools: [...new Set([...(previous?.tools ?? []), ...skills.flatMap((skill) => skill.requiredTools)])],
    knowledgeBaseIds: previous?.knowledgeBaseIds ?? [],
    ...(payload.transfer ? { transferNumber: payload.transfer.destination } : {}),
    complianceProfile: payload.direction === "inbound" ? "inbound-standard" : "us-outbound-default-deny",
    createdAt: new Date().toISOString(),
  };
}
