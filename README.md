# YOURAGENT

Open-source-first SaaS for creating, testing, deploying, and operating AI voice agents for client businesses.

## Product architecture

- **Web app:** Next.js + TypeScript
- **Voice runtime:** Dograh/Pipecat adapter boundary
- **Auth/data:** Supabase/Postgres
- **Policies:** Open Policy Agent-compatible policy layer
- **Agent generation:** structured schema-first generation
- **Integrations:** Nango-compatible integration boundary
- **Observability:** Langfuse-compatible event model
- **Analytics:** PostHog-compatible product events
- **Usage/billing:** OpenMeter-compatible usage events + Stripe
- **Durable workflows:** Temporal-compatible workflow boundary
- **Security/testing:** Promptfoo, Playwright, k6, OWASP ZAP in CI

The repository starts with a runnable product shell and strict internal contracts so external systems can be integrated without coupling the UI to vendor-specific APIs.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Core principles

1. One canonical internal agent schema.
2. External providers sit behind adapters.
3. Every customer-owned record is organization-scoped.
4. Agent changes are versioned before publish.
5. Usage and business events are idempotent.
6. Secrets never enter prompts or browser bundles.
7. Compliance checks happen before outbound actions.
8. Production deploys require automated verification.
