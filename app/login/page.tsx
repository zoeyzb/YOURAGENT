import Link from "next/link";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return <main><div className="shell section"><Link className="brand" href="/"><span className="brand-dot" />YOURAGENT</Link><div className="auth-card card"><span className="eyebrow">ACCOUNT</span><h1 style={{fontSize:52}}>Operate real agents.</h1><p className="lede">Sign in or create your agency account. Authentication is handled by Supabase; agent data is scoped to your organization.</p><LoginForm /></div></div></main>;
}
