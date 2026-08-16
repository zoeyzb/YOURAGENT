import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query, withTransaction } from "@/lib/db";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";
import { AgentConfigSchema } from "@/lib/domain";

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

    const payload = AgentBuilderInputSchema.parse(await request.json());
    const lookup = await query<{
      id: string;
      organization_id: string;
      name: string;
      status: string;
      current_version: number;
      role: string;
    }>(
      `select a.id, a.organization_id, a.name, a.status, a.current_version, m.role
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

    const current = await query<{ version: number; config: unknown; config_hash: string }>(
      `select version, config, config_hash
         from agent_versions
        where agent_id = $1 and version = $2
        limit 1`,
      [id, agent.current_version],
    );
    const currentVersion = current.rows[0];
    if (!currentVersion) return NextResponse.json({ error: "AGENT_VERSION_NOT_FOUND" }, { status: 409 });

    const previousConfig = AgentConfigSchema.parse(currentVersion.config);
    const nextVersion = agent.current_version + 1;
    const config = buildAgentConfig({
      agentId: id,
      organizationId: agent.organization_id,
      version: nextVersion,
      payload,
      previous: previousConfig,
    });
    const configJson = JSON.stringify(config);
    const configHash = createHash("sha256").update(configJson).digest("hex");

    const updatedAgent = await withTransaction(async (client) => {
      await client.query(
        `insert into agent_versions
          (id, organization_id, agent_id, version, status, config, config_hash)
         values ($1, $2, $3, $4, 'draft', $5::jsonb, $6)`,
        [crypto.randomUUID(), agent.organization_id, id, nextVersion, configJson, configHash],
      );

      const updated = await client.query<{
        id: string;
        name: string;
        status: string;
        current_version: number;
      }>(
        `update agents
            set name = $1, status = 'draft', current_version = $2
          where id = $3
            and organization_id = $4
            and current_version = $5
        returning id, name, status, current_version`,
        [payload.name, nextVersion, id, agent.organization_id, agent.current_version],
      );
      if (!updated.rows[0]) throw new Error("VERSION_CONFLICT");
      return updated.rows[0];
    });

    return NextResponse.json({ agent: updatedAgent, version: config }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_AGENT_VERSION", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "VERSION_CONFLICT" || message === "AGENT_VERSION_NOT_FOUND") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: message === "DATABASE_NOT_CONFIGURED" ? 503 : 500 });
  }
}
