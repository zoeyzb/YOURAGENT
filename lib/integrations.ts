export type IntegrationActionInput = {
  organizationId: string;
  connectionId: string;
  action: string;
  payload: Record<string, unknown>;
};

export interface IntegrationGateway {
  execute(input: IntegrationActionInput): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

export class NangoGateway implements IntegrationGateway {
  constructor(private readonly baseUrl: string, private readonly secretKey: string) {}

  async execute(input: IntegrationActionInput) {
    if (!this.baseUrl || !this.secretKey) {
      return { ok: false, error: "Nango is not configured" };
    }

    if (!input.organizationId || !input.connectionId || !input.action) {
      return { ok: false, error: "Invalid integration request" };
    }

    // External provider-specific calls belong here, never in agent prompts or UI code.
    return { ok: false, error: "Nango live execution mapping is not configured yet" };
  }
}
