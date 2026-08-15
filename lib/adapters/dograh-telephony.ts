import { z } from "zod";

const TelephonyConfigurationDetail = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  provider: z.string(),
  is_default_outbound: z.boolean(),
  inactive: z.boolean().optional().default(false),
  credentials: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

const PhoneNumberResponse = z.object({
  id: z.number().int().positive(),
  telephony_configuration_id: z.number().int().positive(),
  address: z.string(),
  address_normalized: z.string(),
  address_type: z.string(),
  country_code: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  inbound_workflow_id: z.number().int().positive().nullable().optional(),
  inbound_workflow_name: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_default_caller_id: z.boolean(),
  provider_sync: z.object({ ok: z.boolean(), message: z.string().nullable().optional() }).nullable().optional(),
});

export type DograhTelephonyConfiguration = z.infer<typeof TelephonyConfigurationDetail>;
export type DograhPhoneNumber = z.infer<typeof PhoneNumberResponse>;

export class DograhTelephonyAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private apiUrl(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}/api/v1/organizations${path}`;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
    };
  }

  private async request(path: string, init: RequestInit) {
    const response = await this.fetchImpl(this.apiUrl(path), {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh telephony request failed (${response.status}): ${detail.slice(0, 700)}`);
    }
    return response;
  }

  async createTwilioConfiguration(input: {
    name: string;
    accountSid: string;
    authToken: string;
    amdEnabled?: boolean;
    isDefaultOutbound?: boolean;
  }): Promise<DograhTelephonyConfiguration> {
    const response = await this.request("/telephony-configs", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        is_default_outbound: input.isDefaultOutbound ?? true,
        config: {
          provider: "twilio",
          account_sid: input.accountSid,
          auth_token: input.authToken,
          amd_enabled: input.amdEnabled ?? false,
          from_numbers: [],
        },
      }),
    });
    return TelephonyConfigurationDetail.parse(await response.json());
  }

  async addPhoneNumber(input: {
    configurationId: number | string;
    address: string;
    countryCode?: string;
    label?: string;
    inboundWorkflowId?: number;
    isDefaultCallerId?: boolean;
  }): Promise<DograhPhoneNumber> {
    const response = await this.request(`/telephony-configs/${input.configurationId}/phone-numbers`, {
      method: "POST",
      body: JSON.stringify({
        address: input.address,
        country_code: input.countryCode ?? null,
        label: input.label ?? null,
        inbound_workflow_id: input.inboundWorkflowId ?? null,
        is_active: true,
        is_default_caller_id: input.isDefaultCallerId ?? false,
        extra_metadata: {},
      }),
    });
    return PhoneNumberResponse.parse(await response.json());
  }

  async listPhoneNumbers(configurationId: number | string): Promise<DograhPhoneNumber[]> {
    const response = await this.request(`/telephony-configs/${configurationId}/phone-numbers`, { method: "GET" });
    const body = z.object({ phone_numbers: z.array(PhoneNumberResponse) }).parse(await response.json());
    return body.phone_numbers;
  }
}
