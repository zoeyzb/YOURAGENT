import { z } from "zod";
import { resolveSkills } from "@/lib/skills";

const GeneratedTemplateSchema = z.object({
  name: z.string().min(2),
  industry: z.string().min(2),
  objective: z.string().min(3),
  direction: z.enum(["inbound", "outbound", "both"]),
  skillIds: z.array(z.string()).min(1),
  tools: z.array(z.string()),
  complianceProfile: z.string().min(1),
});

export type GeneratedTemplate = z.infer<typeof GeneratedTemplateSchema>;

export function validateGeneratedTemplate(input: unknown): GeneratedTemplate {
  const template = GeneratedTemplateSchema.parse(input);
  resolveSkills(template.skillIds);
  return template;
}
