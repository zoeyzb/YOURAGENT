import { z } from "zod";

export const AgentGoalSchema = z.object({
  objective: z.string().min(3),
  direction: z.enum(["inbound", "outbound", "both"]),
  industry: z.string().min(2),
});

export const SkillSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(2),
  category: z.enum(["conversation", "sales", "industry", "action", "compliance"]),
  promptFragment: z.string().min(1),
  incompatibleWith: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
});

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["say", "ask", "decision", "tool", "transfer", "end"]),
  label: z.string().min(1),
  config: z.record(z.unknown()).default({}),
});

export const WorkflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
});

export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(2),
  goal: AgentGoalSchema,
  status: z.enum(["draft", "testing", "published", "paused"]),
  version: z.number().int().positive(),
  voiceProfile: z.string().min(1),
  llmProfile: z.string().min(1),
  sttProfile: z.string().min(1),
  skills: z.array(SkillSchema),
  workflow: z.object({
    nodes: z.array(WorkflowNodeSchema).min(1),
    edges: z.array(WorkflowEdgeSchema),
  }),
  tools: z.array(z.string()).default([]),
  knowledgeBaseIds: z.array(z.string().uuid()).default([]),
  transferNumber: z.string().optional(),
  complianceProfile: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const UsageEventSchema = z.object({
  eventId: z.string().min(8),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  callId: z.string().min(1),
  type: z.enum(["voice_seconds", "llm_tokens", "tts_characters", "sms", "tool_invocation"]),
  quantity: z.number().nonnegative(),
  occurredAt: z.string().datetime(),
  provider: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export const BusinessEventSchema = z.object({
  eventId: z.string().min(8),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  callId: z.string().optional(),
  type: z.enum([
    "agent.created",
    "agent.published",
    "call.started",
    "call.completed",
    "lead.qualified",
    "appointment.booked",
    "transfer.completed",
    "consent.revoked",
  ]),
  occurredAt: z.string().datetime(),
  properties: z.record(z.unknown()).default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type BusinessEvent = z.infer<typeof BusinessEventSchema>;
