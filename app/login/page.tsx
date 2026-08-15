import Link from "next/link";
import LoginForm from "./LoginForm";
import { hasSupabaseEnv } from "@/lib/env";

export default function LoginPage() {
  const configured = hasSupabaseEnv();

  return (
    <main>
      <div className="shell section">
        <Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link>
        <div className="auth-card card">
          <span className="eyebrow">ACCOUNT</span>
          <h1 style={{ fontSize: 52 }}>{configured ? "Operate real agents." : "Backend setup required."}</h1>
          {configured ? (
            <>
              <p className="lede">Sign in or create your agency account. Authentication is handled by Supabase; agent data is scoped to your organization.</p>
              <LoginForm />
            </>
          ) : (
            <>
              <p className="lede">Authentication is intentionally disabled because this deployment has no YOURAGENT Supabase project connected. The app will not show a fake login form that cannot succeed.</p>
              <p>Required production variables: <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, and a server-only <code>SUPABASE_SECRET_KEY</code> or <code>SUPABASE_SERVICE_ROLE_KEY</code>.</p>
              <Link className="btn" href="/api/health">Open health check</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
