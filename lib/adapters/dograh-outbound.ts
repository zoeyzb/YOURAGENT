import { z } from "zod";

const TriggerCallResponse = z.object({
  status: z.string(),
  workflow_run_id: z.number().int().positive(),
  workflow_run_name: z.string(),
});

export type TriggeredDograhCall = z.infer<typeof TriggerCallResponse>;

export async function triggerDograhOutboundCall(input: {
  baseUrl: string;
  apiKey: string;
  workflowUuid: string;
  phoneNumber: string;
  telephonyConfigurationId?: number;
  fromPhoneNumberId?: number;
  initialContext?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<TriggeredDograhCall> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${input.baseUrl.replace(/\/$/, "")}/api/v1/public/agent/workflow/${encodeURIComponent(input.workflowUuid)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.apiKey,
      },
      body: JSON.stringify({
        phone_number: input.phoneNumber,
        initial_context: input.initialContext ?? {},
        telephony_configuration_id: input.telephonyConfigurationId,
        from_phone_number_id: input.fromPhoneNumberId,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dograh outbound call failed (${response.status}): ${detail.slice(0, 700)}`);
  }

  return TriggerCallResponse.parse(await response.json());
}
