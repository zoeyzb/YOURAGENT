import Link from "next/link";
import LoginForm from "./LoginForm";
import { hasAuthConfiguration } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = hasAuthConfiguration();

  return (
    <main>
      <div className="shell section">
        <Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link>
        <div className="auth-card card">
          <span className="eyebrow">ACCOUNT</span>
          <h1 style={{ fontSize: 52 }}>{configured ? "Operate real agents." : "Backend setup required."}</h1>
          {configured ? (
            <>
              <p className="lede">Sign in or create your agency account. Authentication is handled by Better Auth and stored in the same Postgres backend as YOURAGENT.</p>
              <LoginForm />
            </>
          ) : (
            <>
              <p className="lede">Authentication is disabled until a Postgres database is connected. YOURAGENT no longer requires a dedicated Supabase project.</p>
              <p>Required production variables: <code>DATABASE_URL</code>, <code>BETTER_AUTH_SECRET</code>, and <code>BETTER_AUTH_URL</code>.</p>
              <Link className="btn" href="/api/health">Open health check</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
