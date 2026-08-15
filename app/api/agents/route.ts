import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };
  return { supabase, user: data.user };
}

async function ensureOrganization(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
) {
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (membership) return membership.organization_id as string;

  const organizationId = crypto.randomUUID();
  const { error: orgError } = await supabase.from("organizations").insert({
    id: organizationId,
    name: "My Agency",
    owner_user_id: userId,
  });
  if (orgError) throw orgError;

  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    user_id: userId,
    role: "owner",
  });
  if (memberError) {
    await supabase.from("organizations").delete().eq("id", organizationId);
    throw memberError;
  }

  return organizationId;
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data, error } = await supabase
      .from("agents")
      .select("id,name,status,current_version,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ agents: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "SUPABASE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const payload = AgentBuilderInputSchema.parse(await request.json());
    const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const organizationId = await ensureOrganization(supabase, user.id);
    const agentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const config = buildAgentConfig({
      agentId,
      organizationId,
      version: 1,
      payload,
    });
    const configHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");

    const { error: agentError } = await supabase.from("agents").insert({
      id: agentId,
      organization_id: organizationId,
      name: payload.name,
      status: "draft",
      current_version: 1,
    });
    if (agentError) throw agentError;

    const { error: versionError } = await supabase.from("agent_versions").insert({
      id: versionId,
      organization_id: organizationId,
      agent_id: agentId,
      version: 1,
      status: "draft",
      config,
      config_hash: configHash,
    });
    if (versionError) {
      await supabase.from("agents").delete().eq("id", agentId);
      throw versionError;
    }

    return NextResponse.json({ agent: config }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_AGENT", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "SUPABASE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
