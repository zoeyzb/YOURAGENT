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
              <p className="lede">Sign in or create your agency account. Authentication is handled by Neon Managed Auth and stored alongside the YOURAGENT Postgres backend.</p>
              <LoginForm />
            </>
          ) : (
            <>
              <p className="lede">Authentication is disabled until the Neon Postgres database is connected.</p>
              <p>Required production variable: <code>DATABASE_URL</code>. Managed Auth is already provisioned for this project.</p>
              <Link className="btn" href="/api/health">Open health check</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
