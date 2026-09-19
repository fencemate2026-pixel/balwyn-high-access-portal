"use client";
import { useState, useEffect } from "react";
import { routeToMuster, type SiteLayer } from "@/lib/site-layout";
import { Button } from "@/components/ui/button";
export default function SiteLayoutReference(){
 const [layer,setLayer]=useState<SiteLayer|null>(null);const [error,setError]=useState("");
 useEffect(()=>{let active=true;fetch("/api/site-layout",{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("Site reference could not be loaded. Please sign in again or retry.");return r.json()}).then(b=>{if(active)setLayer(b)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 return layer?<LoadedSiteLayout layer={layer}/>:<section className="site-layer-panel"><p role="status">{error||"Loading school site reference…"}</p></section>;
}
function LoadedSiteLayout({layer}:{layer:SiteLayer}){
 const [exit,setExit]=useState(layer.exits[0]);const [blocked,setBlocked]=useState(false);
 const route=routeToMuster(layer,exit,blocked?["PINCH"]:[]);
 const selected=new Set(route?.path??[]);
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(layer,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="balwyn_site.json";a.click();URL.revokeObjectURL(url)}
 return <section className="site-layer-panel"><header><div><small>SCHOOL SITE REFERENCE</small><h2>Outdoor exits and meeting points</h2><p>22 marked exits · 2 meeting points · advisory reference</p></div><Button variant="outline" onClick={download}>Download site layer</Button></header><div className="site-layer-layout"><svg viewBox="-8 0 210 230" role="img" aria-label="Schematic connections between school exits and meeting points. Lines are connections, not the actual walking paths.">
 {layer.edges.map(e=>{const a=layer.nodes.find(n=>n.id===e.a)!;const b=layer.nodes.find(n=>n.id===e.b)!;const active=selected.has(a.id)&&selected.has(b.id);return <line key={e.a+e.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={blocked&&(a.id==="PINCH"||b.id==="PINCH")?"#d79898":active?"#087d76":"#bccbd5"} strokeWidth={active?1.8:0.6} strokeDasharray={blocked&&(a.id==="PINCH"||b.id==="PINCH")?"2 2":undefined}/>})}
 {layer.nodes.map(n=><g key={n.id}><circle cx={n.x} cy={n.y} r={n.kind==="muster"?3.4:2.2} fill={n.id===exit?"#e25124":n.kind==="muster"?"#087d76":n.id==="PINCH"&&blocked?"#b51e30":"#153c5a"}/><text x={n.x+3} y={n.y-3} fontSize={3.6} fill="#153c5a">{n.id.replace("EXIT_","E").replace("MUSTER_OVAL","Oval").replace("MUSTER_EAST","East")}</text></g>)}
 </svg><div><label>Inspect a marked exit<select value={exit} onChange={e=>setExit(e.target.value)}>{layer.exits.map(id=><option key={id} value={id}>{id.replace("EXIT_","Exit ")}</option>)}</select></label><label className="equipment-checkbox"><input type="checkbox" checked={blocked} onChange={e=>setBlocked(e.target.checked)}/>Preview central shared path unavailable</label>
 {route?<div className="site-route-result"><small>RECORDED CONNECTION</small><h3>{layer.nodes.find(n=>n.id===route.muster)?.name}</h3><strong>Approximately {route.distance.toFixed(1)} m</strong><p>{route.path.map(id=>layer.nodes.find(n=>n.id===id)?.name||id.replace("EXIT_","Exit ")).join(" → ")}</p></div>:<div className="site-route-result"><h3>No recorded route available</h3><p>The selected exit has no connection to a meeting point with this path excluded. This file does not define an alternative route.</p></div>}
 <p>Lines show connections only, not the actual walking paths. Distances come from the supplied file and are approximate (±10%).</p><p>{layer.metadata.disclaimer}</p><p>{layer.policy.authority_note}</p><details><summary>Source and accuracy</summary><p>{layer.metadata.source}</p><p>{layer.metadata.accuracy_note}</p></details></div></div></section>
}
