import { query } from "@/lib/db";
import { requireDograhDevFallbackEnv } from "@/lib/env";
import { decryptSecret } from "@/lib/secrets";

export type RuntimeConnection = {
  provider: "dograh";
  baseUrl: string;
  apiKey: string;
  externalOrganizationId?: string | null;
  source: "tenant_encrypted_postgres" | "development_fallback";
};

export async function resolveDograhConnection(organizationId: string): Promise<RuntimeConnection> {
  try {
    const result = await query<{
      base_url: string;
      encrypted_api_key: string;
      external_organization_id: string | null;
    }>(
      `select base_url, encrypted_api_key, external_organization_id
         from runtime_connections
        where organization_id = $1
          and provider = 'dograh'
          and status = 'active'
        limit 1`,
      [organizationId],
    );

    const row = result.rows[0];
    if (row?.base_url && row?.encrypted_api_key) {
      return {
        provider: "dograh",
        baseUrl: row.base_url,
        apiKey: decryptSecret(row.encrypted_api_key),
        externalOrganizationId: row.external_organization_id,
        source: "tenant_encrypted_postgres",
      };
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_RUNTIME_RESOLUTION_ERROR";
    if (process.env.ALLOW_GLOBAL_DOGRAH_FALLBACK !== "true") {
      throw new Error(`TENANT_RUNTIME_NOT_CONFIGURED:${code}`);
    }
  }

  if (process.env.ALLOW_GLOBAL_DOGRAH_FALLBACK !== "true") {
    throw new Error("TENANT_RUNTIME_NOT_CONFIGURED");
  }

  const fallback = requireDograhDevFallbackEnv();
  return {
    provider: "dograh",
    baseUrl: fallback.baseUrl,
    apiKey: fallback.apiKey,
    externalOrganizationId: null,
    source: "development_fallback",
  };
}
