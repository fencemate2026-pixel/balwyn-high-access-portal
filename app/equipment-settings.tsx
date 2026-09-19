"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GATES } from "@/lib/portal-model";
import { exportPiConfiguration, type EquipmentConfig } from "@/lib/equipment-config";
export default function EquipmentSettings({onSaved}:{onSaved:(config:EquipmentConfig)=>void}) {
 const [config,setConfig]=useState<EquipmentConfig|null>(null);
 const [connection,setConnection]=useState<Record<string,boolean>>({});
 const [environmentMap,setEnvironmentMap]=useState<Record<string,number>>({});
 const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true; fetch("/api/equipment",{cache:"no-store"}).then(async r=>{const b=await r.json();if(!r.ok||!b.config)throw new Error(b.error||"Unlock administrator settings to continue");if(active){setConfig(b.config);setConnection(b.connection);setEnvironmentMap(b.environmentMap)}}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[]);
 async function save(){if(!config)return;setBusy(true);setMessage("");try{const r=await fetch("/api/equipment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});const b=await r.json();if(!r.ok)throw new Error(b.error||"Save failed");setConfig(b.config);onSaved(b.config);setMessage("Saved. Portal preferences and mapping apply immediately. Install exported relay settings on the Pi separately.")}catch(e){setMessage(e instanceof Error?e.message:"Save failed")}finally{setBusy(false)}}
 function download(){if(!config)return;const url=URL.createObjectURL(new Blob([exportPiConfiguration(config)],{type:"text/plain"}));const a=document.createElement("a");a.href=url;a.download="balwyn-pi-relay.env.example";a.click();URL.revokeObjectURL(url)}
 if(!config)return <section className="equipment-panel"><p role="status">{message||"Loading equipment settings…"}</p></section>;
 const setPi=(patch:Partial<EquipmentConfig["pi"]>)=>setConfig({...config,pi:{...config.pi,...patch}});
 return <section className="equipment-panel"><header><div><small>COMPASS · RASPBERRY PI · ROGER</small><h2>Equipment configuration</h2><p>Configure the portal and prepare the relay settings for your installed equipment.</p></div><Button disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save equipment settings"}</Button></header>
 <div className="equipment-status"><span>Pi address: <strong>{connection.urlConfigured?"Configured":"Not configured"}</strong></span><span>Pi credential: <strong>{connection.tokenConfigured?"Configured":"Not configured"}</strong></span><span>AI answers: <strong>{connection.aiConfigured?"Configured":"Provider key required"}</strong></span></div>
 <div className="equipment-columns"><fieldset><legend>Portal and door channels</legend>
 <label className="equipment-checkbox"><input type="checkbox" checked={config.remoteOpenEnabled} onChange={e=>setConfig({...config,remoteOpenEnabled:e.target.checked})}/>Enable manual remote-open requests</label>
 <p>Compass ACB-004 has four channels. Inactive gates remain blocked. Match each channel to the verified onsite connection.</p>
 {GATES.map(g=><label key={g.id}>{g.name}{!g.active?" · inactive":""}<select value={(config.gateMap??environmentMap)[g.id]??0} onChange={e=>{const map={...(config.gateMap??environmentMap)};if(Number(e.target.value))map[g.id]=Number(e.target.value);else delete map[g.id];setConfig({...config,gateMap:map})}}><option value={0}>Unassigned</option>{[1,2,3,4].map(n=><option key={n} value={n}>Compass door {n}</option>)}</select></label>)}
 <Button variant="outline" onClick={()=>setConfig({...config,gateMap:null})}>Use server channel mapping</Button>
 <p>Service address and credentials are managed in the hosting configuration. A channel assignment alone does not connect the Pi.</p>
 </fieldset><div><fieldset><legend>Pi relay configuration file</legend><p>Saved for export. These settings do not change the running Pi until the file is installed onsite.</p>
 <label>Relay mode<select value={config.pi.mode} onChange={e=>setPi({mode:e.target.value as EquipmentConfig["pi"]["mode"]})}><option value="mock">Mock · no relay output</option><option value="dry-run">Dry run · no relay output</option><option value="hardware">Hardware · verified relay installation</option></select></label>
 <label>Pulse duration (milliseconds)<input type="number" min={300} max={10000} step={100} value={config.pi.pulseMs} onChange={e=>setPi({pulseMs:Number(e.target.value)})}/></label>
 {[0,1,2,3].map(i=><label key={i}>Door {i+1} BCM GPIO pin<input type="number" min={2} max={27} value={config.pi.pins[i]} onChange={e=>{const pins=[...config.pi.pins];pins[i]=Number(e.target.value);setPi({pins})}}/></label>)}
 <label>Relay polarity<select value={String(config.pi.activeLow)} onChange={e=>setPi({activeLow:e.target.value==="true"})}><option value="true">Active low</option><option value="false">Active high</option></select></label>
 <label>GPIO chip<input type="number" min={0} max={8} value={config.pi.chip} onChange={e=>setPi({chip:Number(e.target.value)})}/></label>
 <Button variant="outline" onClick={download}>Download Pi configuration</Button></fieldset>
 <fieldset><legend>Dashboard and announcements</legend><label>Dashboard refresh (seconds)<input type="number" min={5} max={60} value={config.refreshSeconds} onChange={e=>setConfig({...config,refreshSeconds:Number(e.target.value)})}/></label><label>Voice speed · {config.voiceRate.toFixed(1)}×<input type="range" min={0.5} max={1.5} step={0.1} value={config.voiceRate} onChange={e=>setConfig({...config,voiceRate:Number(e.target.value)})}/></label><label>Announcement volume · {Math.round(config.voiceVolume*100)}%<input type="range" min={0} max={1} step={0.1} value={config.voiceVolume} onChange={e=>setConfig({...config,voiceVolume:Number(e.target.value)})}/></label></fieldset>
 <fieldset><legend>Roger F70/IPU36 and lock controls</legend><p>Motor travel, force, local safety inputs, automatic closing and maglock release sequencing remain configured at the installed controller. The portal sends an open-only relay request; it does not rewrite these controller parameters.</p><p>Request timeout: 15 seconds. Accepted acknowledgement: 300–10,000 ms. Position remains unknown unless independent sensors report it.</p></fieldset></div></div><p role="status" className="equipment-message">{message}</p></section>
}
