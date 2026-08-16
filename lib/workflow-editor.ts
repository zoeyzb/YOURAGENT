import { z } from "zod";
import { WorkflowEdgeSchema, WorkflowNodeSchema } from "@/lib/domain";

export const WorkflowDraftSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).min(1).max(50),
  edges: z.array(WorkflowEdgeSchema).max(120),
}).superRefine((workflow, ctx) => {
  const ids = new Set<string>();
  workflow.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index, "id"],
        message: `Duplicate workflow node id: ${node.id}`,
      });
    }
    ids.add(node.id);
  });

  const incoming = new Map<string, number>();
  workflow.nodes.forEach((node) => incoming.set(node.id, 0));
  const edgeKeys = new Set<string>();

  workflow.edges.forEach((edge, index) => {
    if (!ids.has(edge.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index, "from"],
        message: `Unknown source node: ${edge.from}`,
      });
    }
    if (!ids.has(edge.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index, "to"],
        message: `Unknown target node: ${edge.to}`,
      });
    }
    if (edge.from === edge.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index],
        message: "Self-referencing workflow edges are not allowed",
      });
    }

    const key = `${edge.from}->${edge.to}:${edge.condition ?? ""}`;
    if (edgeKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index],
        message: "Duplicate workflow edge",
      });
    }
    edgeKeys.add(key);

    if (ids.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  });

  const entryNodes = workflow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  if (entryNodes.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["edges"],
      message: `Workflow requires exactly one entry node; found ${entryNodes.length}`,
    });
  }

  if (!workflow.nodes.some((node) => node.type === "end")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodes"],
      message: "Workflow requires at least one end node",
    });
  }
});

export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>;
