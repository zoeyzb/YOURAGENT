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
type Workflow = AgentConfig["workflow"];
type WorkflowNode = Workflow["nodes"][number];

function cloneWorkflow(workflow: Workflow): Workflow {
  return {
    nodes: workflow.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
  };
}

function removeSimpleManagedNode(workflow: Workflow, nodeId: string) {
  const incoming = workflow.edges.filter((edge) => edge.to === nodeId);
  const outgoing = workflow.edges.filter((edge) => edge.from === nodeId);
  if (incoming.length !== 1 || outgoing.length !== 1) return;

  const [before] = incoming;
  const [after] = outgoing;
  workflow.nodes = workflow.nodes.filter((node) => node.id !== nodeId);
  workflow.edges = workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  workflow.edges.push({
    from: before.from,
    to: after.to,
    ...(before.condition ? { condition: before.condition } : after.condition ? { condition: after.condition } : {}),
  });
}

function insertManagedNodeBeforeEnd(workflow: Workflow, node: WorkflowNode) {
  const end = workflow.nodes.find((item) => item.type === "end");
  if (!end) return;

  const incoming = workflow.edges.filter((edge) => edge.to === end.id);
  const preferred = [...incoming].reverse().find((edge) => !edge.condition) ?? incoming[incoming.length - 1];
  workflow.nodes.push(node);

  if (!preferred) return;
  workflow.edges = workflow.edges.filter((edge) => edge !== preferred);
  workflow.edges.push(
    { from: preferred.from, to: node.id, ...(preferred.condition ? { condition: preferred.condition } : {}) },
    { from: node.id, to: end.id },
  );
}

function updatePreservedWorkflow(previous: AgentConfig, payload: AgentBuilderInput): Workflow {
  const workflow = cloneWorkflow(previous.workflow);

  const discovery = workflow.nodes.find((node) => node.id === "discover") ?? workflow.nodes.find((node) => node.type === "ask");
  if (discovery) {
    discovery.config = { ...discovery.config, objective: payload.objective };
  }

  const existingAction = workflow.nodes.find((node) => node.id === "action-1") ?? workflow.nodes.find((node) => node.type === "tool");
  if (payload.httpAction) {
    const actionConfig = {
      url: payload.httpAction.url,
      method: payload.httpAction.method,
      description: `Use ${payload.httpAction.label} when the caller has provided the information required to complete the requested action.`,
      ...(payload.httpAction.credentialUuid ? { credentialUuid: payload.httpAction.credentialUuid } : {}),
    };
    if (existingAction) {
      existingAction.label = payload.httpAction.label;
      existingAction.config = { ...existingAction.config, ...actionConfig };
    } else {
      insertManagedNodeBeforeEnd(workflow, { id: "action-1", type: "tool", label: payload.httpAction.label, config: actionConfig });
    }
  } else if (workflow.nodes.some((node) => node.id === "action-1")) {
    removeSimpleManagedNode(workflow, "action-1");
  }

  const existingTransfer = workflow.nodes.find((node) => node.id === "transfer-1") ?? workflow.nodes.find((node) => node.type === "transfer");
  if (payload.transfer) {
    const transferConfig = {
      destination: payload.transfer.destination,
      ...(payload.transfer.message ? { message: payload.transfer.message } : {}),
    };
    if (existingTransfer) {
      existingTransfer.label = payload.transfer.label;
      existingTransfer.config = { ...existingTransfer.config, ...transferConfig };
    } else {
      insertManagedNodeBeforeEnd(workflow, { id: "transfer-1", type: "transfer", label: payload.transfer.label, config: transferConfig });
    }
  } else if (workflow.nodes.some((node) => node.id === "transfer-1")) {
    removeSimpleManagedNode(workflow, "transfer-1");
  }

  return workflow;
}

function buildDefaultWorkflow(payload: AgentBuilderInput): Workflow {
  const workflowNodes: Workflow["nodes"] = [
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
  const workflowEdges = workflowNodes.slice(0, -1).map((node, index) => ({ from: node.id, to: workflowNodes[index + 1].id }));
  return { nodes: workflowNodes, edges: workflowEdges };
}

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

  const workflow = previous ? updatePreservedWorkflow(previous, payload) : buildDefaultWorkflow(payload);

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
    workflow,
    tools: [...new Set([...(previous?.tools ?? []), ...skills.flatMap((skill) => skill.requiredTools)])],
    knowledgeBaseIds: previous?.knowledgeBaseIds ?? [],
    ...(payload.transfer ? { transferNumber: payload.transfer.destination } : {}),
    complianceProfile: payload.direction === "inbound" ? "inbound-standard" : "us-outbound-default-deny",
    createdAt: new Date().toISOString(),
  };
}
