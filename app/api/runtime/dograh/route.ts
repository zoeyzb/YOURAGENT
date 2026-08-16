import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireOrganizationAdmin, organizationAuthErrorStatus } from "@/lib/org-auth";
import { encryptSecret, hasRuntimeSecretEncryptionKey } from "@/lib/secrets";

const ConnectRequest = z.object({
  organizationId: z.string().uuid(),
  baseUrl: z.string().url(),
  apiKey: z.string().min(8),
});

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_DOGRAH_BASE_URL");
  return url.origin + url.pathname.replace(/\/$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });
  }

  try {
    await requireOrganizationAdmin(organizationId, request.headers);
    const result = await query<{
      provider: string;
      base_url: string;
      external_organization_id: string | null;
      status: string;
      metadata: unknown;
      updated_at: string;
    }>(
      `select provider, base_url, external_organization_id, status, metadata, updated_at
         from runtime_connections
        where organization_id = $1 and provider = 'dograh'
        limit 1`,
      [organizationId],
    );
    return NextResponse.json({ connection: result.rows[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const payload = ConnectRequest.parse(await request.json());
    await requireOrganizationAdmin(payload.organizationId, request.headers);
    if (!hasRuntimeSecretEncryptionKey()) {
      return NextResponse.json({ error: "RUNTIME_SECRET_ENCRYPTION_KEY_NOT_CONFIGURED" }, { status: 503 });
    }

    const baseUrl = normalizeBaseUrl(payload.baseUrl);
    const authResponse = await fetch(`${baseUrl}/api/v1/user/auth/user`, {
      method: "GET",
      headers: { "X-API-Key": payload.apiKey, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!authResponse.ok) {
      return NextResponse.json(
        { error: "DOGRAH_CREDENTIALS_REJECTED", statusCode: authResponse.status },
        { status: 422 },
      );
    }

    const identity = z.object({ id: z.number().int().positive(), is_superuser: z.boolean().optional() })
      .passthrough()
      .parse(await authResponse.json());
    const encryptedApiKey = encryptSecret(payload.apiKey);
    const metadata = JSON.stringify({
      dograh_user_id: identity.id,
      verified_at: new Date().toISOString(),
    });

    await query(
      `insert into runtime_connections
         (organization_id, provider, base_url, encrypted_api_key, external_organization_id, status, metadata, updated_at)
       values ($1, 'dograh', $2, $3, null, 'active', $4::jsonb, now())
       on conflict (organization_id, provider) do update set
         base_url = excluded.base_url,
         encrypted_api_key = excluded.encrypted_api_key,
         external_organization_id = excluded.external_organization_id,
         status = 'active',
         metadata = excluded.metadata,
         updated_at = now()`,
      [payload.organizationId, baseUrl, encryptedApiKey, metadata],
    );

    return NextResponse.json({
      connection: { provider: "dograh", baseUrl, status: "active", verified: true },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_RUNTIME_CONNECTION", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
