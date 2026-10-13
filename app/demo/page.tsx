"use client";
import { useEffect, useState } from "react";
type Agent={id:number;name:string;goal:string;tone:string;enabled:boolean};
const seed:Agent[]=[{id:1,name:"Appointment Concierge",goal:"Book a five-minute consultation",tone:"Friendly",enabled:true}];
export default function DemoAgentStudio(){
 const [agents,setAgents]=useState<Agent[]>(seed);
 const [loaded,setLoaded]=useState(false);
 const [name,setName]=useState("");const [goal,setGoal]=useState("");
 const [selected,setSelected]=useState<number>(1);const [caller,setCaller]=useState("I want to book an appointment.");
 const [scenario,setScenario]=useState("Appointment booking");
 const [history,setHistory]=useState<{agent:string;caller:string;reply:string;scenario:string}[]>([]);
 const [demoStatus,setDemoStatus]=useState("All example conversations are simulated, not calls.");
 const [notice,setNotice]=useState("");
 const [transcript,setTranscript]=useState<string[]>([]);
 const [outcome,setOutcome]=useState("Follow-up requested");
 const completeSample=()=>{
  if(!agent || !transcript.length)return;
  const notes="Outcome: "+outcome+"; Agent: "+agent.name+"; Transcript: "+transcript.join(" / ");
  setHistory(old=>[{agent:agent.name,caller:transcript[0],reply:notes,scenario:outcome},...old].slice(0,25));
  setNotice("Simulation completed: outcome and notes recorded in history.");
  setTranscript([]);
 };
 function exportDemo(){
  const url=URL.createObjectURL(new Blob([JSON.stringify({sampleOnly:true,agents,history},null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="youragent-simulated-workspace.json";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  setNotice("Example configuration exported. No live calls occurred.");
 }
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem("youragent_demo_v1")||"null");if(Array.isArray(v))setAgents(v)}catch{}setLoaded(true)},[]);
 useEffect(()=>{if(loaded)localStorage.setItem("youragent_demo_v1",JSON.stringify(agents))},[agents,loaded]);
 const agent=agents.find(a=>a.id===selected);
 function change(patch:Partial<Agent>){setAgents(all=>all.map(a=>a.id===selected?{...a,...patch}:a))}
 const answer=scenario==="Pricing question"||caller.toLowerCase().includes("price")?"I can explain the service and arrange a short consultation to discuss pricing.":caller.toLowerCase().includes("appointment")||caller.toLowerCase().includes("book")?"I'd be happy to help. What day and time would you prefer for a short consultation?":"Thanks for reaching out. Could you tell me a little more about what you need?";
 return <main style={{maxWidth:1080,margin:"35px auto",padding:24}}>
  <header><span style={{color:"#69e0cc"}}>YOURAGENT / INTERACTIVE PORTFOLIO DEMO</span><h1>Agent Studio</h1><p>Configure and test a simulated voice agent. No telephone calls, audio generation, or real customers.</p><a href="/" style={{color:"#69e0cc"}}>← Back to platform</a></header>
  <section aria-label="Demo metrics" style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:24}}>
   <div style={{padding:18,border:"1px solid #64748b",borderRadius:12}}><small>Configured demo agents</small><h2>{agents.length}</h2></div>
   <div style={{padding:18,border:"1px solid #64748b",borderRadius:12}}><small>Simulated conversations</small><h2>{history.length}</h2></div>
   <button type="button" onClick={exportDemo} style={{padding:14}}>Export demo report</button>
  </section>{notice&&<p role="status">{notice}</p>}<p role="status">{demoStatus}</p>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))",gap:22,marginTop:25}}>
   <section style={{border:"1px solid #64748b",padding:22,borderRadius:18}}>
    <h2>Agents</h2>{agents.map(a=><button key={a.id} type="button" onClick={()=>setSelected(a.id)} style={{display:"block",width:"100%",padding:12,marginBottom:8,textAlign:"left",border:"1px solid #69e0cc",background:a.id===selected?"#164e44":"transparent",color:"white",cursor:"pointer"}}>{a.name} · {a.enabled?"Enabled":"Paused"}</button>)}
    <form onSubmit={e=>{e.preventDefault();if(!name.trim()||!goal.trim())return;const id=Date.now();setAgents(old=>[...old,{id,name:name.trim(),goal:goal.trim(),tone:"Friendly",enabled:true}]);setSelected(id);setName("");setGoal("")}}>
    <h3>Create a sample agent</h3><label style={{display:"block",marginBottom:12}}>Name<input required maxLength={65} value={name} onChange={e=>setName(e.target.value)} style={{display:"block",width:"100%",padding:10}}/></label><label style={{display:"block",marginBottom:12}}>Goal<input required maxLength={180} value={goal} onChange={e=>setGoal(e.target.value)} style={{display:"block",width:"100%",padding:10}}/></label><button type="submit" style={{padding:12}}>Add agent</button></form>
   </section>
   <section style={{border:"1px solid #64748b",padding:22,borderRadius:18}}>
   {agent?<><h2>Configure: {agent.name}</h2><label style={{display:"block",marginBottom:12}}>Agent goal<input value={agent.goal} onChange={e=>change({goal:e.target.value})} style={{display:"block",width:"100%",padding:10}}/></label><label style={{display:"block",marginBottom:12}}>Conversation tone<select value={agent.tone} onChange={e=>change({tone:e.target.value})} style={{display:"block",width:"100%",padding:10}}>{["Friendly","Professional","Concise"].map(t=><option key={t}>{t}</option>)}</select></label><label><input type="checkbox" checked={agent.enabled} onChange={e=>change({enabled:e.target.checked})}/> Demo agent enabled</label><hr/><h3>Conversation simulator</h3><p>Choose a sample situation, enter a message, and record the mock outcome.</p><label>Scenario<select value={scenario} onChange={e=>{setScenario(e.target.value);setCaller(e.target.value==="Pricing question"?"How much does this cost?":e.target.value==="Appointment booking"?"I want to book an appointment.":"Can I speak to a person?")}} style={{display:"block",width:"100%",padding:10}}>{["Appointment booking","Pricing question","Human handoff"].map(s=><option key={s}>{s}</option>)}</select></label><p>Caller (example)</p><textarea value={caller} maxLength={500} onChange={e=>setCaller(e.target.value)} style={{width:"100%",minHeight:90,padding:10}}/><p><strong>{agent.name} · simulated reply</strong></p><blockquote style={{borderLeft:"3px solid #69e0cc",paddingLeft:14}}>{agent.enabled?answer:"Agent paused. Enable the agent to preview a reply."}</blockquote><small>Template-based sample, not a language-model response.</small><p><button type="button" disabled={!agent.enabled||!caller.trim()} onClick={()=>{setTranscript(old=>[...old,"Caller: "+caller,"Agent: "+answer]);setCaller("");}}>Continue simulated conversation</button></p><div role="log" aria-label="Sample call transcript">{transcript.map((t,i)=><p key={i}>{t}</p>)}</div><label>Outcome<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option>Follow-up requested</option><option>Demo booked (example)</option><option>Human handoff</option><option>Not interested</option></select></label><button type="button" disabled={!transcript.length} onClick={completeSample}>Finish call and save notes</button><p><button type="button" disabled={!agent.enabled||!caller.trim()} onClick={()=>{setHistory(old=>[{agent:agent.name,caller,reply:answer,scenario},...old].slice(0,25));setNotice("Example conversation recorded locally. No call was made.");setDemoStatus("Scenario completed in simulation only.")}}>Record simulated outcome</button></p><p><button type="button" onClick={()=>{setAgents(old=>old.filter(a=>a.id!==selected));setSelected(agents.find(a=>a.id!==selected)?.id??-1)}}>Delete this demo agent</button></p></>:<p>Select or create a sample agent.</p>}</section>
  </div><section style={{marginTop:25}}><h2>Simulation history</h2>{history.length===0?<p>No simulations recorded yet.</p>:history.map((h,i)=><article key={i} style={{borderBottom:"1px solid #64748b",padding:12}}><strong>{h.agent} · {h.scenario}</strong><p>Caller: {h.caller}</p><p>Example reply: {h.reply}</p></article>)}</section><button type="button" onClick={()=>{if(confirm("Reset all sample agents?")){setAgents(seed);setSelected(1)}}} style={{marginTop:24,padding:12}}>Reset example data</button>
 </main>;
}
