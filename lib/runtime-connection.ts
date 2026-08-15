import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDograhDevFallbackEnv } from "@/lib/env";

export type RuntimeConnection = {
  provider: "dograh";
  baseUrl: string;
  apiKey: string;
  externalOrganizationId?: string | null;
  source: "tenant_vault" | "development_fallback";
};

export async function resolveDograhConnection(organizationId: string): Promise<RuntimeConnection> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("resolve_runtime_connection_secret", {
      p_organization_id: organizationId,
      p_provider: "dograh",
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.base_url && row?.api_key) {
      return {
        provider: "dograh",
        baseUrl: row.base_url,
        apiKey: row.api_key,
        externalOrganizationId: row.external_organization_id ?? null,
        source: "tenant_vault",
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
