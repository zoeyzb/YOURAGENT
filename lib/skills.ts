import { SkillSchema } from "@/lib/domain";

export const builtInSkills = [
  {
    id: "conversation.active-listening",
    version: 1,
    name: "Active listening",
    category: "conversation",
    promptFragment: "Listen for the caller's actual need, reflect it briefly, and ask one focused follow-up at a time.",
    incompatibleWith: [],
    requiredTools: [],
  },
  {
    id: "conversation.concise-human",
    version: 1,
    name: "Concise human conversation",
    category: "conversation",
    promptFragment: "Use short natural turns, avoid monologues, acknowledge interruptions, and never pretend to be human when disclosure is required.",
    incompatibleWith: [],
    requiredTools: [],
  },
  {
    id: "sales.discovery",
    version: 1,
    name: "Sales discovery",
    category: "sales",
    promptFragment: "Discover need, urgency, fit, and decision context before recommending the next step.",
    incompatibleWith: [],
    requiredTools: [],
  },
  {
    id: "action.appointment-booking",
    version: 1,
    name: "Appointment booking",
    category: "action",
    promptFragment: "Confirm timezone, date, time, contact details, and the final appointment before ending the call.",
    incompatibleWith: [],
    requiredTools: ["calendar.book"],
  },
  {
    id: "compliance.opt-out",
    version: 1,
    name: "Immediate opt-out",
    category: "compliance",
    promptFragment: "If the person asks not to be called, stop persuasion immediately, confirm the opt-out briefly, invoke the suppression tool, and end the sales flow.",
    incompatibleWith: [],
    requiredTools: ["compliance.suppress-number"],
  },
].map((skill) => SkillSchema.parse(skill));

export function resolveSkills(ids: string[]) {
  const selected = builtInSkills.filter((skill) => ids.includes(skill.id));
  const missing = ids.filter((id) => !selected.some((skill) => skill.id === id));
  if (missing.length) throw new Error(`Unknown skills: ${missing.join(", ")}`);

  const selectedIds = new Set(selected.map((skill) => skill.id));
  for (const skill of selected) {
    const conflict = skill.incompatibleWith.find((id) => selectedIds.has(id));
    if (conflict) throw new Error(`Skill conflict: ${skill.id} is incompatible with ${conflict}`);
  }
  return selected;
}
