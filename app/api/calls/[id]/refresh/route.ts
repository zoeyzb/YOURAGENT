import { NextResponse } from "next/server";
import { fetchDograhRun } from "@/lib/adapters/dograh-runs";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { resolveDograhConnection } from "@/lib/runtime-connection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: call, error: callError } = await supabase
      .from("calls")
      .select("id,organization_id,agent_id,agent_version,runtime_provider,external_run_id,metadata")
      .eq("id", id)
      .maybeSingle();
    if (callError) throw callError;
    if (!call) return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
    if (call.runtime_provider !== "dograh") return NextResponse.json({ error: "UNSUPPORTED_RUNTIME_PROVIDER" }, { status: 409 });

    await requireOrganizationAdmin(call.organization_id);
    if (!call.external_run_id) return NextResponse.json({ error: "CALL_RUN_NOT_REGISTERED" }, { status: 409 });

    const { data: deployment, error: deploymentError } = await supabase
      .from("runtime_deployments")
      .select("external_deployment_id,agent_version,created_at")
      .eq("organization_id", call.organization_id)
      .eq("agent_id", call.agent_id)
      .eq("agent_version", call.agent_version)
      .eq("provider", "dograh")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment) return NextResponse.json({ error: "DEPLOYMENT_NOT_FOUND" }, { status: 409 });

    const runtime = await resolveDograhConnection(call.organization_id);
    const run = await fetchDograhRun({
      deploymentId: deployment.external_deployment_id,
      runId: call.external_run_id,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });

    const previousMetadata = call.metadata && typeof call.metadata === "object"
      ? call.metadata as Record<string, unknown>
      : {};
    const nextStatus = run.is_completed ? "completed" : "in_progress";
    const { data: updated, error: updateError } = await supabase
      .from("calls")
      .update({
        provider_call_id: String(run.id),
        external_run_id: String(run.id),
        direction: run.call_type,
        status: nextStatus,
        transcript_url: run.transcript_public_url ?? run.transcript_url,
        recording_url: run.recording_public_url ?? run.recording_url,
        cost_info: run.cost_info,
        usage_info: run.usage_info ?? null,
        gathered_context: run.gathered_context ?? null,
        ended_at: run.is_completed ? new Date().toISOString() : null,
        metadata: {
          ...previousMetadata,
          mode: run.mode,
          initial_context: run.initial_context ?? null,
          annotations: run.annotations ?? null,
          reconciled_at: new Date().toISOString(),
          runtime_source: runtime.source,
        },
      })
      .eq("id", call.id)
      .select("id,status,external_run_id,transcript_url,recording_url,cost_info,usage_info,gathered_context,ended_at")
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ call: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")) return NextResponse.json({ error: message }, { status: 503 });
    return NextResponse.json({ error: message }, { status: organizationAuthErrorStatus(message) });
  }
}
