import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSkills } from "@/lib/skills";

const HttpActionSchema = z.object({
  label: z.string().trim().min(2).max(80),
  url: z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "Action URL must use HTTP(S)"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  credentialUuid: z.string().trim().min(1).max(255).optional(),
}).optional();

const TransferSchema = z.object({
  label: z.string().trim().min(2).max(80),
  destination: z.string().trim().regex(/^\+\d{8,15}$/, "Transfer number must use E.164 format"),
  message: z.string().trim().max(300).optional(),
}).optional();

const CreateAgentRequest = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().min(2).max(80),
  objective: z.string().trim().min(10).max(1000),
  direction: z.enum(["inbound", "outbound", "both"]),
  voiceProfile: z.string().trim().min(2).default("warm-professional"),
  httpAction: HttpActionSchema,
  transfer: TransferSchema,
});

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
    const payload = CreateAgentRequest.parse(await request.json());
    const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const organizationId = await ensureOrganization(supabase, user.id);
    const agentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const skills = resolveSkills([
      "conversation.active-listening",
      "conversation.concise-human",
      ...(payload.direction === "outbound" || payload.direction === "both"
        ? ["sales.discovery", "compliance.opt-out"]
        : []),
    ]);

    const workflowNodes: Array<{ id: string; type: "say" | "ask" | "tool" | "transfer" | "end"; label: string; config: Record<string, unknown> }> = [
      { id: "start", type: "say", label: "Greeting", config: { purpose: "introduce-and-disclose" } },
      { id: "discover", type: "ask", label: "Discover need", config: { objective: payload.objective } },
    ];
    if (payload.httpAction) {
      workflowNodes.push({
        id: "action-1",
        type: "tool",
        label: payload.httpAction.label,
        config: {
          url: payload.httpAction.url,
          method: payload.httpAction.method,
          description: `Use ${payload.httpAction.label} when the caller has provided the information required to complete the requested action.`,
          ...(payload.httpAction.credentialUuid ? { credentialUuid: payload.httpAction.credentialUuid } : {}),
        },
      });
    }
    if (payload.transfer) {
      workflowNodes.push({
        id: "transfer-1",
        type: "transfer",
        label: payload.transfer.label,
        config: {
          destination: payload.transfer.destination,
          ...(payload.transfer.message ? { message: payload.transfer.message } : {}),
        },
      });
    }
    workflowNodes.push({ id: "finish", type: "end", label: "Close", config: {} });

    const workflowEdges = workflowNodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: workflowNodes[index + 1].id,
    }));

    const config = {
      id: agentId,
      organizationId,
      name: payload.name,
      goal: {
        objective: payload.objective,
        direction: payload.direction,
        industry: payload.industry,
      },
      status: "draft" as const,
      version: 1,
      voiceProfile: payload.voiceProfile,
      llmProfile: "balanced-reasoning",
      sttProfile: "fast-english",
      skills,
      workflow: {
        nodes: workflowNodes,
        edges: workflowEdges,
      },
      tools: skills.flatMap((skill) => skill.requiredTools),
      knowledgeBaseIds: [],
      ...(payload.transfer ? { transferNumber: payload.transfer.destination } : {}),
      complianceProfile: payload.direction === "inbound" ? "inbound-standard" : "us-outbound-default-deny",
      createdAt: new Date().toISOString(),
    };
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
