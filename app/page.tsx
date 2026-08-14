import Link from "next/link";

const metrics = [
  ["Agent config", "Versioned"],
  ["Tenant data", "RLS"],
  ["Create flow", "Wired"],
  ["Runtime", "Pending"],
] as const;

export default function Home() {
  return (
    <main>
      <div className="shell">
        <nav className="nav">
          <Link href="/" className="brand"><span className="brand-dot" />YOURAGENT</Link>
          <div className="nav-actions">
            <a className="btn" href="#platform">Platform</a>
            <Link className="btn" href="/login">Sign in</Link>
            <Link className="btn btn-primary" href="/dashboard">Launch app</Link>
          </div>
        </nav>

        <section className="hero" id="top">
          <div>
            <span className="eyebrow">● Voice-agent control plane</span>
            <h1>Build the agent. Not the plumbing.</h1>
            <p className="lede">
              Describe what a business needs. YOURAGENT creates a persistent, organization-scoped agent configuration with a versioned workflow, curated skills, policy defaults, and provider boundaries ready for testing and deployment.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/dashboard">Create an agent</Link>
              <a className="btn" href="#platform">See architecture</a>
            </div>
          </div>

          <div className="visual" aria-label="Voice agent visualization">
            <div className="orb" />
            <div className="float-card float-a">
              <strong>Agent configuration</strong>
              <small>Goal · workflow · skills · policies</small>
              <div className="wave" aria-hidden>
                {[12,24,18,30,14,26,20,11,27,19,29,15].map((h, i) => <i key={i} style={{ height: h }} />)}
              </div>
            </div>
            <div className="float-card float-b">
              <strong>Fail closed</strong>
              <small>Runtime is never labeled live until it is actually configured.</small>
            </div>
          </div>
        </section>

        <section className="section" id="platform">
          <div className="section-head">
            <div>
              <span className="eyebrow">FROM REQUEST TO DEPLOYMENT</span>
              <h2>One control plane for every agent.</h2>
            </div>
            <p>External providers stay replaceable. YOURAGENT owns the customer model, policies, versions, and deployment contract.</p>
          </div>
          <div className="grid-3">
            <article className="card"><span className="num">01</span><h3>Describe</h3><p>Enter the business, objective, direction, and voice. The backend generates a validated first version.</p></article>
            <article className="card"><span className="num">02</span><h3>Inspect</h3><p>Open the agent to inspect its persisted goal, workflow graph, skills, provider profile, and config hash.</p></article>
            <article className="card"><span className="num">03</span><h3>Deploy safely</h3><p>Voice-runtime activation stays separate and blocked until provider credentials and deployment checks pass.</p></article>
          </div>
        </section>

        <section className="section">
          <div className="dashboard">
            <div className="dash-top"><strong>YOURAGENT / engineering status</strong><Link className="btn btn-primary" href="/dashboard">Open dashboard</Link></div>
            <div className="workspace">
              <p className="eyebrow">REAL IMPLEMENTATION STATUS</p>
              <h2 style={{ fontSize: 36, margin: '14px 0 20px', letterSpacing: '-.04em' }}>The landing-page buttons now enter the application.</h2>
              <div className="metric-grid">
                {metrics.map(([label,value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
