# YOURAGENT

YOURAGENT is a multi-tenant SaaS for creating, testing, deploying, and operating AI voice agents for client businesses.

## Implemented architecture

- **Web app:** Next.js 16 + React + TypeScript
- **Primary database:** provider-neutral PostgreSQL through `pg` (Neon is the preferred free hosted option)
- **Authentication:** Better Auth with email/password sessions stored in the same PostgreSQL database
- **Tenancy:** explicit organization membership checks in server routes and tenant-scoped SQL queries
- **Voice runtime:** organization-scoped Dograh runtime adapter
- **Runtime secrets:** AES-256-GCM encrypted per-organization runtime credentials stored server-side in PostgreSQL
- **Telephony:** Twilio configurations and phone numbers managed through Dograh
- **Inbound routing:** phone number → organization → agent → deployed Dograh workflow
- **Outbound calling:** Dograh published-workflow API with explicit consent, DNC-clear, jurisdiction and local-hour policy gates
- **Agent actions:** real Dograh HTTP API tools and transfer-call tools
- **Credentials for actions:** Dograh credential UUIDs; secret authorization headers are rejected from agent configuration
- **Testing:** domain-restricted Dograh browser test sessions with temporary workflow/tool cleanup
- **Call evidence:** Dograh run IDs, transcripts, recordings, gathered context, usage and cost persisted in call history
- **Completion sync:** per-deployment Dograh completion callbacks with a random token hash, followed by a canonical Dograh run fetch before database writes
- **Versioning:** agent edits create immutable vN+1 configurations; previous versions remain attributable to historical calls
- **Safe redeploy:** new workflow is created first, existing phone routes are moved and provider-sync verified, then the previous workflow is paused; failed cutovers roll phone routes and runtime state back
- **Pause/resume:** runtime and routed phone-number active state are synchronized with rollback on provider failure

## Current validation gate

Every push to `main` and every pull request runs:

```text
npm ci
npm audit --omit=dev --audit-level=high
npm run typecheck
npm test
npm run build
```

CI must pass the production dependency audit, TypeScript compilation, Vitest suite, and Next.js production build.

## Local development

Copy `.env.example`, provide a PostgreSQL connection string and secrets, then:

```bash
npm ci
npm run dev
```

After the database exists, initialize Better Auth and YOURAGENT tables once through the protected bootstrap endpoint:

```text
POST /api/admin/bootstrap
Authorization: Bearer <BOOTSTRAP_TOKEN>
```

Then open `http://localhost:3000`.

## Required production environment

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — strong application auth secret
- `BETTER_AUTH_URL` — canonical public app URL
- `BOOTSTRAP_TOKEN` — one-time/protected database bootstrap authorization
- `RUNTIME_SECRET_ENCRYPTION_KEY` — exactly 32 random bytes encoded as base64 or 64 hex characters
- `YOURAGENT_PUBLIC_URL` — canonical public URL used for runtime callbacks/embed origin restrictions

Optional development-only Dograh fallback:

- `DOGRAH_BASE_URL`
- `DOGRAH_API_KEY`
- `ALLOW_GLOBAL_DOGRAH_FALLBACK=true`

Production customers should connect their own organization-scoped Dograh runtime from the Runtime settings screen instead of using the global fallback.

## Production activation order

1. Provision a PostgreSQL database (Neon works without changing application code).
2. Add the required environment variables to the deployment.
3. Call the protected `/api/admin/bootstrap` endpoint once and verify it returns `ok: true`.
4. Verify `/api/health` returns HTTP 200 with database/auth ready.
5. Create/sign in to an account.
6. Create an agent and verify immutable version persistence.
7. Connect that organization to Dograh.
8. Run the browser Test Agent flow.
9. Connect Twilio and route a number when PSTN calling is needed.
10. Deploy and verify call completion artifacts in Call History.

## Product invariants

1. Every customer-owned record is organization-scoped.
2. Secrets do not enter prompts or browser bundles; runtime API keys are encrypted at rest.
3. Agent changes create immutable versions before deployment.
4. A new runtime deployment does not replace the old live deployment until phone-route provider synchronization succeeds.
5. Failed cutovers attempt to restore the previous phone routing and runtime state.
6. Outbound calling is default-deny unless the explicit policy checks pass.
7. Provider responses are not treated as call evidence until canonical run data is fetched back from Dograh.
8. The UI must not report a runtime or phone route as live when provider synchronization is known to have failed.

## Not claimed as implemented

The codebase may later add broader observability, CRM integrations, usage billing, load testing, and security scanning. Those systems are **not** described as production integrations until they are actually wired, configured, and verified end-to-end.
