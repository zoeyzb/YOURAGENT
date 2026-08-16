import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query, withTransaction } from "@/lib/db";
import { AgentBuilderInputSchema, buildAgentConfig } from "@/lib/agent-builder";

async function requireUser(request: Request) {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

async function ensureOrganization(userId: string) {
  const existing = await query<{ organization_id: string }>(
    `select organization_id
       from organization_members
      where user_id = $1
      order by created_at asc
      limit 1`,
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].organization_id;

  const organizationId = crypto.randomUUID();
  await withTransaction(async (client) => {
    await client.query(
      `insert into organizations (id, name, owner_user_id)
       values ($1, $2, $3)`,
      [organizationId, "My Agency", userId],
    );
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, 'owner')`,
      [organizationId, userId],
    );
  });
  return organizationId;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (!user) {
      const status = hasAuthConfiguration() && hasDatabaseUrl() ? 401 : 503;
      return NextResponse.json({ error: status === 401 ? "UNAUTHENTICATED" : "BACKEND_NOT_CONFIGURED" }, { status });
    }

    const result = await query<{
      id: string;
      name: string;
      status: string;
      current_version: number;
      created_at: string;
    }>(
      `select distinct a.id, a.name, a.status, a.current_version, a.created_at
         from agents a
         join organization_members m on m.organization_id = a.organization_id
        where m.user_id = $1
        order by a.created_at desc`,
      [user.id],
    );

    return NextResponse.json({ agents: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "DATABASE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const payload = AgentBuilderInputSchema.parse(await request.json());
    const user = await requireUser(request);
    if (!user) {
      const status = hasAuthConfiguration() && hasDatabaseUrl() ? 401 : 503;
      return NextResponse.json({ error: status === 401 ? "UNAUTHENTICATED" : "BACKEND_NOT_CONFIGURED" }, { status });
    }

    const organizationId = await ensureOrganization(user.id);
    const agentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const config = buildAgentConfig({ agentId, organizationId, version: 1, payload });
    const configJson = JSON.stringify(config);
    const configHash = createHash("sha256").update(configJson).digest("hex");

    await withTransaction(async (client) => {
      await client.query(
        `insert into agents (id, organization_id, name, status, current_version)
         values ($1, $2, $3, 'draft', 1)`,
        [agentId, organizationId, payload.name],
      );
      await client.query(
        `insert into agent_versions
          (id, organization_id, agent_id, version, status, config, config_hash)
         values ($1, $2, $3, 1, 'draft', $4::jsonb, $5)`,
        [versionId, organizationId, agentId, configJson, configHash],
      );
    });

    return NextResponse.json({ agent: config }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_AGENT", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "DATABASE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
