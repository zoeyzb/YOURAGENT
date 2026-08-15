import { z } from "zod";

const ToolResponseSchema = z.object({
  tool_uuid: z.string().min(1),
  name: z.string(),
  category: z.string(),
  status: z.string(),
}).passthrough();

const ToolParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().min(1),
  required: z.boolean().optional().default(true),
});

export type DograhToolParameter = z.infer<typeof ToolParameterSchema>;
export type DograhCreatedTool = z.infer<typeof ToolResponseSchema>;

export class DograhToolAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private apiUrl(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}/api/v1/tools${path}`;
  }

  private headers() {
    return { "Content-Type": "application/json", "X-API-Key": this.apiKey };
  }

  private async create(body: Record<string, unknown>) {
    const response = await this.fetchImpl(this.apiUrl("/"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh create tool failed (${response.status}): ${detail.slice(0, 700)}`);
    }
    return ToolResponseSchema.parse(await response.json());
  }

  async createTransferTool(input: {
    name: string;
    description?: string;
    destination: string;
    timeout?: number;
    message?: string;
  }): Promise<DograhCreatedTool> {
    return this.create({
      name: input.name,
      description: input.description ?? `Transfer the live call to ${input.destination}`,
      category: "transfer_call",
      icon: "phone-forwarded",
      definition: {
        schema_version: 1,
        type: "transfer_call",
        config: {
          destination_source: "static",
          destination: input.destination,
          messageType: input.message ? "custom" : "none",
          customMessage: input.message ?? null,
          timeout: input.timeout ?? 30,
        },
      },
    });
  }

  async createHttpApiTool(input: {
    name: string;
    description: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    credentialUuid?: string;
    headers?: Record<string, string>;
    parameters?: DograhToolParameter[];
    bodyTemplate?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<DograhCreatedTool> {
    const url = new URL(input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("HTTP tool URL must use http or https");

    const headers = input.headers ?? {};
    const forbiddenHeaders = Object.keys(headers).filter((key) => ["authorization", "x-api-key", "proxy-authorization"].includes(key.toLowerCase()));
    if (forbiddenHeaders.length) {
      throw new Error(`Do not put secrets in HTTP tool headers (${forbiddenHeaders.join(", ")}); use a Dograh credential UUID`);
    }

    return this.create({
      name: input.name,
      description: input.description,
      category: "http_api",
      icon: "globe",
      definition: {
        schema_version: 1,
        type: "http_api",
        config: {
          method: input.method,
          url: input.url,
          headers: Object.keys(headers).length ? headers : null,
          credential_uuid: input.credentialUuid ?? null,
          parameters: input.parameters?.map((parameter) => ToolParameterSchema.parse(parameter)) ?? null,
          timeout_ms: input.timeoutMs ?? 5000,
          body_template: input.bodyTemplate ?? null,
        },
      },
    });
  }

  async archiveTool(toolUuid: string) {
    const response = await this.fetchImpl(this.apiUrl(`/${encodeURIComponent(toolUuid)}`), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Dograh archive tool failed (${response.status}): ${detail.slice(0, 500)}`);
    }
  }
}
