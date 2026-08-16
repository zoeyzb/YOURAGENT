import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query, withTransaction } from "@/lib/db";
import { AgentConfigSchema } from "@/lib/domain";
import { WorkflowDraftSchema } from "@/lib/workflow-editor";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
      return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
    }

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

    const workflow = WorkflowDraftSchema.parse(await request.json());
    const lookup = await query<{
      id: string;
      organization_id: string;
      current_version: number;
      role: string;
    }>(
      `select a.id, a.organization_id, a.current_version, m.role
         from agents a
         join organization_members m on m.organization_id = a.organization_id
        where a.id = $1 and m.user_id = $2
        limit 1`,
      [id, session.user.id],
    );
    const agent = lookup.rows[0];
    if (!agent) return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });
    if (!["owner", "admin"].includes(agent.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const currentResult = await query<{ config: unknown }>(
      `select config from agent_versions where agent_id = $1 and version = $2 limit 1`,
      [id, agent.current_version],
    );
    if (!currentResult.rows[0]) {
      return NextResponse.json({ error: "AGENT_VERSION_NOT_FOUND" }, { status: 409 });
    }

    const current = AgentConfigSchema.parse(currentResult.rows[0].config);
    const nextVersion = agent.current_version + 1;
    const nextConfig = AgentConfigSchema.parse({
      ...current,
      version: nextVersion,
      status: "draft",
      workflow,
      createdAt: new Date().toISOString(),
    });
    const configJson = JSON.stringify(nextConfig);
    const configHash = createHash("sha256").update(configJson).digest("hex");

    const updated = await withTransaction(async (client) => {
      await client.query(
        `insert into agent_versions
          (id, organization_id, agent_id, version, status, config, config_hash)
         values ($1, $2, $3, $4, 'draft', $5::jsonb, $6)`,
        [randomUUID(), agent.organization_id, id, nextVersion, configJson, configHash],
      );

      const agentUpdate = await client.query<{ id: string; current_version: number; status: string }>(
        `update agents
            set current_version = $1, status = 'draft'
          where id = $2 and organization_id = $3 and current_version = $4
        returning id, current_version, status`,
        [nextVersion, id, agent.organization_id, agent.current_version],
      );
      if (!agentUpdate.rows[0]) throw new Error("VERSION_CONFLICT");
      return agentUpdate.rows[0];
    });

    return NextResponse.json({ agent: updated, version: nextConfig }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_WORKFLOW", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "VERSION_CONFLICT") return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: message === "DATABASE_NOT_CONFIGURED" ? 503 : 500 });
  }
}
