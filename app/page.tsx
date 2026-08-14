const metrics = [
  ["Active agents", "12"],
  ["Calls this month", "3,842"],
  ["Appointments", "397"],
  ["Qualified rate", "47.1%"],
] as const;

const agents = [
  ["Jessica", "HVAC speed-to-lead", "423 calls · 37 booked"],
  ["Emma", "Dental receptionist", "891 calls · 174 booked"],
  ["Alex", "Real-estate qualifier", "311 calls · 61 qualified"],
] as const;

export default function Home() {
  return (
    <main>
      <div className="shell">
        <nav className="nav">
          <a href="#top" className="brand"><span className="brand-dot" />YOURAGENT</a>
          <div className="nav-actions">
            <a className="btn" href="#platform">Platform</a>
            <a className="btn btn-primary" href="#dashboard">Launch agent</a>
          </div>
        </nav>

        <section className="hero" id="top">
          <div>
            <span className="eyebrow">● AI voice infrastructure, turned into a product</span>
            <h1>Build the agent. Not the plumbing.</h1>
            <p className="lede">
              Describe what a business needs. YOURAGENT turns it into a tested voice workflow with skills,
              tools, knowledge, phone routing, analytics, usage controls, and a deployable runtime.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#dashboard">Create an agent</a>
              <a className="btn" href="#platform">See architecture</a>
            </div>
          </div>

          <div className="visual" aria-label="Voice agent visualization">
            <div className="orb" />
            <div className="float-card float-a">
              <strong>Live conversation</strong>
              <small>Interruptible · low latency · tool aware</small>
              <div className="wave" aria-hidden>
                {[12,24,18,30,14,26,20,11,27,19,29,15].map((h, i) => <i key={i} style={{ height: h }} />)}
              </div>
            </div>
            <div className="float-card float-b">
              <strong>Goal achieved</strong>
              <small>Appointment booked · CRM updated · SMS sent</small>
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
            <article className="card"><span className="num">01</span><h3>Describe</h3><p>Start with a business goal. Structured generation turns it into a validated agent configuration.</p></article>
            <article className="card"><span className="num">02</span><h3>Test</h3><p>Run policy checks, AI evaluations, browser verification, workflow tests, and a supervised test call.</p></article>
            <article className="card"><span className="num">03</span><h3>Deploy</h3><p>Publish an immutable version, route a phone number, meter usage, and observe every call.</p></article>
          </div>
        </section>

        <section className="section" id="dashboard">
          <div className="dashboard">
            <div className="dash-top"><strong>YOURAGENT / Acme Agency</strong><button className="btn btn-primary">+ Create agent</button></div>
            <div className="dash-body">
              <aside className="sidebar">
                {['Overview','Agents','Calls','Workflows','Skills','Integrations','Usage','Settings'].map((item, i) => <div key={item} className={`sidebar-item ${i === 0 ? 'active' : ''}`}>{item}</div>)}
              </aside>
              <div className="workspace">
                <p className="eyebrow">OPERATIONS</p>
                <h2 style={{ fontSize: 36, margin: '14px 0 20px', letterSpacing: '-.04em' }}>Good morning.</h2>
                <div className="metric-grid">
                  {metrics.map(([label,value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
                </div>
                <div style={{ marginTop: 28 }}>
                  <strong>Live agents</strong>
                  {agents.map(([name,type,detail]) => (
                    <div className="agent-row" key={name}>
                      <div><strong>{name}</strong><div style={{ color: '#9ca3af', marginTop: 4 }}>{type} · {detail}</div></div>
                      <span className="status">LIVE</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
