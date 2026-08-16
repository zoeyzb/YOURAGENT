import { NextResponse } from "next/server";
import { z } from "zod";
import { DograhAdapter } from "@/lib/adapters/voice-runtime";
import { DograhToolAdapter } from "@/lib/adapters/dograh-tools";
import { query } from "@/lib/db";
import { organizationAuthErrorStatus, requireOrganizationAdmin } from "@/lib/org-auth";
import { resolveDograhConnection } from "@/lib/runtime-connection";

const CleanupRequest = z.object({
  organizationId: z.string().uuid(),
});

type SessionRow = {
  id: string;
  external_deployment_id: string;
  metadata: Record<string, unknown> | null;
};

function createdTools(metadata: Record<string, unknown> | null) {
  const value = metadata?.created_tool_uuids;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export async function POST(request: Request) {
  try {
    const { organizationId } = CleanupRequest.parse(await request.json());
    await requireOrganizationAdmin(organizationId, request.headers);

    const sessions = (await query<SessionRow>(
      `select id, external_deployment_id, metadata
         from runtime_test_sessions
        where organization_id = $1
          and expires_at <= now()
          and status in ('created','active','failed')
        order by expires_at asc
        limit 50`,
      [organizationId],
    )).rows;

    if (!sessions.length) {
      return NextResponse.json({ cleaned: 0, failed: 0, remainingEligible: 0 });
    }

    const runtime = await resolveDograhConnection(organizationId);
    const voiceAdapter = new DograhAdapter(runtime.baseUrl, runtime.apiKey);
    const toolAdapter = new DograhToolAdapter(runtime.baseUrl, runtime.apiKey);
    let cleaned = 0;
    let failed = 0;

    for (const session of sessions) {
      const errors: string[] = [];

      try {
        await voiceAdapter.pause(session.external_deployment_id);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "PREVIEW_PAUSE_FAILED");
      }

      for (const toolUuid of createdTools(session.metadata)) {
        try {
          await toolAdapter.archiveTool(toolUuid);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `TOOL_ARCHIVE_FAILED:${toolUuid}`);
        }
      }

      if (errors.length) {
        failed += 1;
        await query(
          `update runtime_test_sessions
              set status = 'failed', last_error = $1, updated_at = now()
            where id = $2 and organization_id = $3`,
          [`EXPIRED_PREVIEW_CLEANUP_FAILED: ${errors.join("; ").slice(0, 1500)}`, session.id, organizationId],
        );
      } else {
        cleaned += 1;
        await query(
          `update runtime_test_sessions
              set status = 'expired', last_error = null, updated_at = now()
            where id = $1 and organization_id = $2`,
          [session.id, organizationId],
        );
      }
    }

    const remainingEligible = Number((await query<{ count: string }>(
      `select count(*)::text as count
         from runtime_test_sessions
        where organization_id = $1
          and expires_at <= now()
          and status in ('created','active','failed')`,
      [organizationId],
    )).rows[0]?.count ?? 0);

    return NextResponse.json({ cleaned, failed, remainingEligible });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_CLEANUP_REQUEST", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.startsWith("TENANT_RUNTIME_NOT_CONFIGURED")
      ? 503
      : organizationAuthErrorStatus(message);
    return NextResponse.json({ error: message }, { status });
  }
}
