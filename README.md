# YOURAGENT

YOURAGENT is a multi-tenant SaaS for creating, testing, deploying, and operating AI voice agents for client businesses.

## Implemented architecture

- **Web app:** Next.js 16 + React + TypeScript
- **Voice runtime:** organization-scoped Dograh runtime adapter
- **Auth/data:** Supabase Auth + Postgres with organization-scoped RLS
- **Runtime secrets:** Supabase Vault references; runtime API keys are not stored in client-readable tables
- **Telephony:** Twilio configurations and phone numbers managed through Dograh
- **Inbound routing:** phone number → organization → agent → deployed Dograh workflow
- **Outbound calling:** Dograh published-workflow API with explicit consent, DNC-clear, jurisdiction and local-hour policy gates
- **Agent actions:** real Dograh HTTP API tools and transfer-call tools
- **Credentials for actions:** Dograh credential UUIDs; secret authorization headers are rejected from agent configuration
- **Testing:** domain-restricted Dograh browser test sessions with temporary workflow/tool cleanup
- **Call evidence:** Dograh run IDs, transcripts, recordings, gathered context, usage and cost persisted in call history
- **Completion sync:** authenticated per-deployment Dograh completion callbacks, followed by a canonical Dograh run fetch before database writes
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

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Required production services

A production installation needs:

1. A dedicated Supabase project with every migration in `supabase/migrations` applied.
2. Supabase Auth and the server/service credentials required by the app.
3. One Dograh runtime connection per customer organization. The global Dograh environment fallback is development-only and must be explicitly enabled.
4. Twilio credentials connected inside the customer's Dograh runtime when PSTN calling is required.
5. The app deployed from the current `main` branch with its production environment variables configured.

## Product invariants

1. Every customer-owned record is organization-scoped.
2. Secrets do not enter prompts, browser bundles, or ordinary client-readable database rows.
3. Agent changes create immutable versions before deployment.
4. A new runtime deployment does not replace the old live deployment until phone-route provider synchronization succeeds.
5. Failed cutovers attempt to restore the previous phone routing and runtime state.
6. Outbound calling is default-deny unless the explicit policy checks pass.
7. Provider responses are not treated as call evidence until canonical run data is fetched back from Dograh.
8. The UI must not report a runtime or phone route as live when provider synchronization is known to have failed.

## Not claimed as implemented

The codebase contains or may later add adapter boundaries for broader observability, CRM integrations, usage billing, load testing, and security scanning. Those systems are **not** described as production integrations until they are actually wired, configured, and verified end-to-end.
