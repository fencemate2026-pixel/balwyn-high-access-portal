export type SiteLayer = { schema:string; metadata:{name:string;source:string;disclaimer:string;accuracy_note:string}; nodes:{id:string;kind:string;x:number;y:number;level:number;name?:string}[]; edges:{a:string;b:string;distance_m:number;modes:string[]}[]; exits:string[]; policy:{authority_note:string;incident_block_rules:Record<string,string[]>} };
export function routeToMuster(layer: SiteLayer, start:string, blocked:string[] = []) {
 const exclusions = new Set(blocked.flatMap(id => [id,...(layer.policy.incident_block_rules[id]??[])]));
 if (exclusions.has(start) || !layer.nodes.some(n=>n.id===start)) return null;
 const distances = new Map<string,number>([[start,0]]); const paths = new Map<string,string[]>([[start,[start]]]);const visited=new Set<string>();
 while(true){const candidate=[...distances].filter(([id])=>!visited.has(id)&&!exclusions.has(id)).sort((a,b)=>a[1]-b[1])[0];if(!candidate)return null;const [id,d]=candidate;visited.add(id);
 if(layer.nodes.find(n=>n.id===id)?.kind==="muster")return {muster:id,distance:d,path:paths.get(id)!};
 for(const edge of layer.edges){if(!edge.modes.includes("walk"))continue;const next=edge.a===id?edge.b:edge.b===id?edge.a:null;if(!next||exclusions.has(next))continue;const total=d+edge.distance_m;if(total<(distances.get(next)??Infinity)){distances.set(next,total);paths.set(next,[...paths.get(id)!,next])}}
 }
}
