import Link from "next/link";

const metrics = [
  ["Agent config", "Versioned"],
  ["Tenant data", "RLS isolated"],
  ["Telephony", "Twilio via Dograh"],
  ["Redeploys", "Transactional"],
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
              Create tenant-isolated voice agents, test them in the browser, connect Twilio, route real phone numbers, place policy-gated outbound calls, and deploy immutable versions without silently breaking the live line.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/dashboard">Create an agent</Link>
              <a className="btn" href="#platform">See how it works</a>
            </div>
          </div>

          <div className="visual" aria-label="Voice agent visualization">
            <div className="orb" />
            <div className="float-card float-a">
              <strong>Agent configuration</strong>
              <small>Goal · workflow · actions · transfer · policies</small>
              <div className="wave" aria-hidden>
                {[12,24,18,30,14,26,20,11,27,19,29,15].map((h, i) => <i key={i} style={{ height: h }} />)}
              </div>
            </div>
            <div className="float-card float-b">
              <strong>Fail closed</strong>
              <small>A version is not live until the runtime and routed phone numbers confirm the cutover.</small>
            </div>
          </div>
        </section>

        <section className="section" id="platform">
          <div className="section-head">
            <div>
              <span className="eyebrow">FROM REQUEST TO LIVE CALLS</span>
              <h2>One control plane for every agent.</h2>
            </div>
            <p>YOURAGENT keeps client configuration, versions, phone routing and call evidence in one tenant-scoped control plane while Dograh handles the realtime voice runtime.</p>
          </div>
          <div className="grid-3">
            <article className="card"><span className="num">01</span><h3>Create</h3><p>Define the business objective, call direction, voice, optional API action, and human-transfer path.</p></article>
            <article className="card"><span className="num">02</span><h3>Test & connect</h3><p>Run a browser voice test, connect the organization’s Dograh runtime and Twilio account, then attach a real phone number.</p></article>
            <article className="card"><span className="num">03</span><h3>Deploy safely</h3><p>Every edit creates a new immutable version. Phone routes move only after provider sync succeeds; failed cutovers roll back.</p></article>
          </div>
        </section>

        <section className="section">
          <div className="dashboard">
            <div className="dash-top"><strong>YOURAGENT / control plane</strong><Link className="btn btn-primary" href="/dashboard">Open dashboard</Link></div>
            <div className="workspace">
              <p className="eyebrow">OPERATING MODEL</p>
              <h2 style={{ fontSize: 36, margin: '14px 0 20px', letterSpacing: '-.04em' }}>Versioned agents. Tenant-scoped runtime. Evidence for every call.</h2>
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
