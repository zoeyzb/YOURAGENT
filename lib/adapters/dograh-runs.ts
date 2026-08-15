import { z } from "zod";

export const DograhRunSchema = z.object({
  id: z.number().int().positive(),
  workflow_id: z.number().int().positive(),
  name: z.string(),
  mode: z.string(),
  created_at: z.string(),
  is_completed: z.boolean(),
  transcript_url: z.string().nullable(),
  recording_url: z.string().nullable(),
  user_recording_url: z.string().nullable().optional(),
  bot_recording_url: z.string().nullable().optional(),
  transcript_public_url: z.string().nullable().optional(),
  recording_public_url: z.string().nullable().optional(),
  cost_info: z.record(z.unknown()).nullable(),
  usage_info: z.record(z.unknown()).nullable().optional(),
  initial_context: z.record(z.unknown()).nullable().optional(),
  gathered_context: z.record(z.unknown()).nullable().optional(),
  call_type: z.enum(["inbound", "outbound"]),
  logs: z.record(z.unknown()).nullable().optional(),
  annotations: z.record(z.unknown()).nullable().optional(),
});

export type DograhRun = z.infer<typeof DograhRunSchema>;

export function dograhWorkflowId(deploymentId: string) {
  const match = /^dograh-workflow:(\d+)$/.exec(deploymentId);
  if (!match) throw new Error("Unknown Dograh deployment id");
  return match[1];
}

export async function fetchDograhRun(options: {
  deploymentId: string;
  runId: string | number;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<DograhRun> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workflowId = dograhWorkflowId(options.deploymentId);
  const response = await fetchImpl(
    `${options.baseUrl.replace(/\/$/, "")}/api/v1/workflow/${workflowId}/runs/${options.runId}`,
    { headers: { "X-API-Key": options.apiKey } },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dograh fetch run failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  return DograhRunSchema.parse(await response.json());
}
