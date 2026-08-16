# YOURAGENT

YOURAGENT is a multi-tenant SaaS for creating, testing, deploying, and operating AI voice agents for client businesses.

## Implemented architecture

- **Web app:** Next.js 16 + React + TypeScript
- **Primary database:** Neon PostgreSQL through `pg`
- **Authentication:** Neon Managed Auth (Better Auth compatible) with email/password sessions in Neon's `neon_auth` schema
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

## Validation gate

Every push to `main` and every pull request runs:

```text
npm ci
npm audit --omit=dev --audit-level=high
npm run typecheck
npm test
npm run build
```

CI must pass the production dependency audit, TypeScript compilation, Vitest suite, and Next.js production build.

## Readiness model

`GET /api/health` intentionally separates core application readiness from voice-runtime readiness:

- **Core ready:** web + Neon database + Neon Managed Auth are healthy. Signup, login, organization bootstrap, agent creation/versioning, and dashboard reads can operate.
- **Runtime encryption ready:** `RUNTIME_SECRET_ENCRYPTION_KEY` is present. Organization-scoped Dograh credentials can be connected/decrypted safely.
- **Tenant runtime ready:** the organization has an active Dograh connection. Test Agent and deploy become available.
- **Telephony ready:** a tenant runtime exists and Twilio/phone routing is configured through Dograh.

A missing runtime encryption key does not mark the core application dead; it disables voice-runtime credential setup until the key is configured.

## Local development

Copy `.env.example`, provide a Neon/PostgreSQL connection string, then:

```bash
npm ci
npm run dev
```

The application schema is idempotent and can be initialized through the protected bootstrap endpoint when `BOOTSTRAP_TOKEN` is configured:

```text
POST /api/admin/bootstrap
Authorization: Bearer <BOOTSTRAP_TOKEN>
```

Neon manages the authentication schema separately; YOURAGENT does not create or migrate Neon Auth tables.

## Required production environment

- `DATABASE_URL` — Neon/PostgreSQL connection string
- `RUNTIME_SECRET_ENCRYPTION_KEY` — required before storing Dograh/provider credentials; exactly 32 random bytes encoded as base64 or 64 hex characters
- `YOURAGENT_PUBLIC_URL` — canonical public URL used for runtime callbacks/embed origin restrictions

Optional:

- `NEON_AUTH_BASE_URL` — overrides the provisioned Managed Auth endpoint
- `NEON_AUTH_COOKIE_SECRET` — independent 32+ character session-cookie secret; when absent, YOURAGENT derives a session-only key from `DATABASE_URL`
- `BOOTSTRAP_TOKEN` — protects the optional schema bootstrap endpoint
- `DOGRAH_BASE_URL`, `DOGRAH_API_KEY`, `ALLOW_GLOBAL_DOGRAH_FALLBACK=true` — development-only Dograh fallback

Production customers should connect their own organization-scoped Dograh runtime from Runtime settings instead of using the global fallback.

## Production activation order

1. Connect Neon PostgreSQL through `DATABASE_URL`.
2. Enable Neon Managed Auth and trust the application domains.
3. Apply/verify the YOURAGENT application schema.
4. Verify `/api/health` returns HTTP 200 with database/auth ready.
5. Create/sign in to an account.
6. Create an agent and verify immutable version persistence.
7. Add `RUNTIME_SECRET_ENCRYPTION_KEY`, then connect that organization to Dograh.
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
