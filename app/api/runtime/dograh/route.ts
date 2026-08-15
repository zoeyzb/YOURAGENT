import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

async function requireRuntimeAdmin(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("UNAUTHENTICATED");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership || !["owner", "admin"].includes(membership.role)) throw new Error("FORBIDDEN");

  return { supabase, userId: auth.user.id };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });
  }

  try {
    const { supabase } = await requireRuntimeAdmin(organizationId);
    const { data, error } = await supabase
      .from("runtime_connections")
      .select("provider,base_url,external_organization_id,status,metadata,updated_at")
      .eq("organization_id", organizationId)
      .eq("provider", "dograh")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ connection: data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "UNAUTHENTICATED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: message }, { status: message === "SUPABASE_NOT_CONFIGURED" ? 503 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = ConnectRequest.parse(await request.json());
    await requireRuntimeAdmin(payload.organizationId);

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

    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("upsert_runtime_connection_secret", {
      p_organization_id: payload.organizationId,
      p_provider: "dograh",
      p_base_url: baseUrl,
      p_api_key: payload.apiKey,
      p_external_organization_id: null,
      p_metadata: {
        dograh_user_id: identity.id,
        verified_at: new Date().toISOString(),
      },
    });
    if (error) throw error;

    return NextResponse.json({
      connection: {
        provider: "dograh",
        baseUrl,
        status: "active",
        verified: true,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_RUNTIME_CONNECTION", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "UNAUTHENTICATED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    const unavailable = ["SUPABASE_NOT_CONFIGURED", "SUPABASE_ADMIN_NOT_CONFIGURED"].includes(message);
    return NextResponse.json({ error: message }, { status: unavailable ? 503 : 500 });
  }
}
