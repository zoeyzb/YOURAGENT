import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { requireDograhEnv } from "@/lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "resume" ? "resume" : body.action === "pause" ? "pause" : null;
  if (!action) return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const { data: deployment, error: deploymentError } = await supabase
      .from("runtime_deployments")
      .select("id,external_deployment_id,status")
      .eq("agent_id", id)
      .eq("provider", "dograh")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deploymentError) throw deploymentError;
    if (!deployment) return NextResponse.json({ error: "DEPLOYMENT_NOT_FOUND" }, { status: 404 });

    const { baseUrl, apiKey } = requireDograhEnv();
    const adapter = new DograhAdapter(baseUrl, apiKey);
    const previousStatus = deployment.status;

    if (action === "pause") await adapter.pause(deployment.external_deployment_id);
    else await adapter.resume(deployment.external_deployment_id);

    const nextStatus = action === "pause" ? "paused" : "ready";
    const nextAgentStatus = action === "pause" ? "paused" : "published";

    const { error: deploymentUpdateError } = await supabase
      .from("runtime_deployments")
      .update({ status: nextStatus, updated_at: new Date().toISOString(), last_error: null })
      .eq("id", deployment.id);

    if (deploymentUpdateError) {
      try {
        if (action === "pause" && previousStatus === "ready") await adapter.resume(deployment.external_deployment_id);
        if (action === "resume" && previousStatus === "paused") await adapter.pause(deployment.external_deployment_id);
      } catch {
        // Reconciliation will be required; preserve the database error below.
      }
      throw deploymentUpdateError;
    }

    const { error: agentUpdateError } = await supabase
      .from("agents")
      .update({ status: nextAgentStatus })
      .eq("id", id);
    if (agentUpdateError) throw agentUpdateError;

    return NextResponse.json({ status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "SUPABASE_NOT_CONFIGURED" || message === "DOGRAH_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
