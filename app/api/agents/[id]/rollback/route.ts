import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentConfigSchema } from "@/lib/domain";
import { hasDatabaseUrl, query, withTransaction } from "@/lib/db";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { restoreAgentConfigVersion } from "@/lib/agent-versioning";

const RestoreRequestSchema = z.object({
  targetVersion: z.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    if (!hasAuthConfiguration() || !hasDatabaseUrl()) {
      return NextResponse.json({ error: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
    }

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const { targetVersion } = RestoreRequestSchema.parse(await request.json());
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
    if (targetVersion >= agent.current_version) {
      return NextResponse.json({ error: "RESTORE_REQUIRES_OLDER_VERSION" }, { status: 409 });
    }

    const source = (await query<{ version: number; config: unknown }>(
      `select version, config
         from agent_versions
        where organization_id = $1 and agent_id = $2 and version = $3
        limit 1`,
      [agent.organization_id, id, targetVersion],
    )).rows[0];
    if (!source) return NextResponse.json({ error: "RESTORE_VERSION_NOT_FOUND" }, { status: 404 });

    const sourceConfig = AgentConfigSchema.parse(source.config);
    const nextVersion = agent.current_version + 1;
    const restoredConfig = restoreAgentConfigVersion(sourceConfig, nextVersion);
    const configJson = JSON.stringify(restoredConfig);
    const configHash = createHash("sha256").update(configJson).digest("hex");

    const restored = await withTransaction(async (client) => {
      await client.query(
        `insert into agent_versions
          (id, organization_id, agent_id, version, status, config, config_hash, restored_from_version)
         values ($1, $2, $3, $4, 'draft', $5::jsonb, $6, $7)`,
        [randomUUID(), agent.organization_id, id, nextVersion, configJson, configHash, targetVersion],
      );

      const updated = await client.query<{
        id: string;
        status: string;
        current_version: number;
      }>(
        `update agents
            set name = $1, status = 'draft', current_version = $2
          where id = $3
            and organization_id = $4
            and current_version = $5
        returning id, status, current_version`,
        [restoredConfig.name, nextVersion, id, agent.organization_id, agent.current_version],
      );
      if (!updated.rows[0]) throw new Error("VERSION_CONFLICT");
      return updated.rows[0];
    });

    return NextResponse.json(
      {
        agent: restored,
        restoredFromVersion: targetVersion,
        version: restoredConfig,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_RESTORE_REQUEST", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "VERSION_CONFLICT") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json(
      { error: message },
      { status: message === "DATABASE_NOT_CONFIGURED" ? 503 : 500 },
    );
  }
}
