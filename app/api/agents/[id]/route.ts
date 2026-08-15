import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";
import { AgentConfigSchema } from "@/lib/domain";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let insertedVersion: number | null = null;
  let organizationId: string | null = null;

  try {
    const payload = AgentBuilderInputSchema.parse(await request.json());
    const lookupClient = await createSupabaseServerClient();
    const { data: auth, error: authError } = await lookupClient.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: agent, error: agentError } = await lookupClient
      .from("agents")
      .select("id,organization_id,name,status,current_version")
      .eq("id", id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });
    organizationId = agent.organization_id;

    const { supabase } = await requireOrganizationAdmin(agent.organization_id);
    const { data: currentVersion, error: currentVersionError } = await supabase
      .from("agent_versions")
      .select("version,config,config_hash")
      .eq("agent_id", id)
      .eq("version", agent.current_version)
      .maybeSingle();
    if (currentVersionError) throw currentVersionError;
    if (!currentVersion) throw new Error("AGENT_VERSION_NOT_FOUND");

    const previousConfig = AgentConfigSchema.parse(currentVersion.config);
    const nextVersion = agent.current_version + 1;
    const config = buildAgentConfig({
      agentId: id,
      organizationId: agent.organization_id,
      version: nextVersion,
      payload,
      previous: previousConfig,
    });
    const configHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");

    const { error: versionInsertError } = await supabase.from("agent_versions").insert({
      id: crypto.randomUUID(),
      organization_id: agent.organization_id,
      agent_id: id,
      version: nextVersion,
      status: "draft",
      config,
      config_hash: configHash,
    });
    if (versionInsertError) throw versionInsertError;
    insertedVersion = nextVersion;

    const { data: updatedAgent, error: agentUpdateError } = await supabase
      .from("agents")
      .update({
        name: payload.name,
        status: "draft",
        current_version: nextVersion,
      })
      .eq("id", id)
      .eq("organization_id", agent.organization_id)
      .eq("current_version", agent.current_version)
      .select("id,name,status,current_version")
      .maybeSingle();
    if (agentUpdateError) throw agentUpdateError;
    if (!updatedAgent) throw new Error("VERSION_CONFLICT");

    insertedVersion = null;
    return NextResponse.json({ agent: updatedAgent, version: config }, { status: 201 });
  } catch (error) {
    if (insertedVersion && organizationId) {
      try {
        const { supabase } = await requireOrganizationAdmin(organizationId);
        await supabase
          .from("agent_versions")
          .delete()
          .eq("agent_id", id)
          .eq("version", insertedVersion)
          .eq("status", "draft");
      } catch {
        // Preserve the original failure; the orphan draft is harmless and visible for reconciliation.
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_AGENT_VERSION", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "VERSION_CONFLICT") return NextResponse.json({ error: message }, { status: 409 });
    if (message === "AGENT_VERSION_NOT_FOUND") return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
