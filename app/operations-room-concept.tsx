"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import GuidanceProjection, { EXAMPLE_ROUTE } from './guidance-projection';
import { CONCEPT_SCENES, type ScreenCorners } from '@/lib/concept-scenes';
function screenStyle(corners:ScreenCorners,width:number,height:number):CSSProperties {
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=corners;
 const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
 const d=dx1*dy2-dx2*dy1,g=(dx3*dy2-dx2*dy3)/d,h=(dx1*dy3-dx3*dy1)/d;
 return {width,height,transform:`matrix3d(${[(x1-x0+g*x1)/width,(y1-y0+g*y1)/width,0,g/width,(x3-x0+h*x3)/height,(y3-y0+h*y3)/height,0,h/height,0,0,1,0,x0,y0,0,1].join(',')})`};
}
function ConceptStage({variant}:{variant:keyof typeof CONCEPT_SCENES}) {
 const scene=CONCEPT_SCENES[variant],ref=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(0);
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(([e])=>setWidth(e.contentRect.width));observer.observe(ref.current);return()=>observer.disconnect();},[]);
 return <div className="operations-concept-stage" ref={ref} style={{aspectRatio:`${scene.width}/${scene.height}`}}>
  <img className="operations-concept-photo" src={scene.image} width={scene.width} height={scene.height} alt={scene.alt} loading="lazy" />
  <div className="operations-concept-overlays" aria-hidden="true" inert style={{width:scene.width,height:scene.height,transform:`scale(${width/scene.width})`,visibility:width?'visible':'hidden'}}>
   {scene.dashboard&&<iframe className="concept-screen-frame" style={screenStyle(scene.dashboard,1440,1200)} src="/dashboard-illustration.html" title="Illustrative Magic Keys dashboard" width="1440" height="1200" tabIndex={-1} sandbox="allow-same-origin" loading="lazy" />}
   {scene.campus&&<div className="concept-screen-frame concept-campus-screen" style={screenStyle(scene.campus,1100,900)}><div className="concept-campus-heading"><strong>Balwyn High School</strong><span>Illustrative site reference</span></div><div className="concept-campus-image"><svg viewBox="0 0 1000 650" role="img" aria-label="Illustrative connections, not the school layout"><rect width="1000" height="650" fill="#eaf2f5"/><path d="M180 200 H500 V450 H820" fill="none" stroke="#7697a7" strokeWidth="24"/><rect x="70" y="120" width="230" height="150" rx="20" fill="#163f5d"/><rect x="385" y="365" width="230" height="150" rx="20" fill="#163f5d"/><rect x="700" y="365" width="230" height="150" rx="20" fill="#087d76"/><g fill="white" fontSize="32" textAnchor="middle"><text x="185" y="205">Marked exit</text><text x="500" y="450">Shared path</text><text x="815" y="450">Meeting point</text></g><text x="500" y="595" fontSize="28" fill="#36566a" textAnchor="middle">Illustration only · no distances or site geometry</text></svg></div><div className="concept-campus-footer">Illustrative connections · not a school plan</div></div>}
   {scene.projection&&<div className="concept-screen-frame" style={screenStyle(scene.projection,1440,900)}><GuidanceProjection route={EXAMPLE_ROUTE} /></div>}
  </div>
 </div>;
}
export default function OperationsRoomConcept({variant}:{variant:keyof typeof CONCEPT_SCENES}) {
 const scene=CONCEPT_SCENES[variant];
 return <figure className="operations-concept"><ConceptStage variant={variant}/><figcaption><div><strong>{scene.title}</strong><span>{scene.caption}</span></div><Dialog><DialogTrigger asChild><Button variant="outline"><Maximize2/> Enlarge preview</Button></DialogTrigger><DialogContent className="concept-detail-dialog"><DialogHeader><DialogTitle>{scene.title}</DialogTitle><DialogDescription>Concept demonstration. Swipe across the image to see each screen in detail.</DialogDescription></DialogHeader><div className="concept-detail-scroll" tabIndex={0} role="region" aria-label="Detailed concept image"><ConceptStage variant={variant}/></div></DialogContent></Dialog></figcaption></figure>;
}
