"use client";

import { useState } from "react";
import { ArrowRight, Camera, CheckCircle2, ChevronRight, LockKeyhole, MapPin, MonitorUp, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OperationsRoomConcept from "./operations-room-concept";

const benefits = [
  { key: "cctv", Icon: Camera, title: "See the situation", text: "Bring camera events and affected zones into one view for authorised staff." },
  { key: "guidance", Icon: MapPin, title: "Coordinate the response", text: "Review an incident against the school’s approved routes and response plans." },
  { key: "screens", Icon: MonitorUp, title: "Make the message clear", text: "Give each classroom a clear, consistent instruction on its connected screen." },
] as const;

function FireResponseDescription({ screenFirst = false }: { screenFirst?: boolean }) {
  return (
    <div className="advanced-example">
      <OperationsRoomConcept variant={screenFirst ? "projector" : "emergency"} />
      <section className="fire-response-description" aria-label="How the system would respond to a fire">
        <span className="advanced-eyebrow">Fire response</span>
        <h3>{screenFirst ? "Clear fire evacuation instructions in every classroom" : "How the system would respond to a fire"}</h3>
        <p>Once integrated and commissioned for the school, Magic Keys would bring fire alerts, camera views and classroom guidance together so staff can coordinate the response from one dashboard.</p>
        <h4>Identify the affected area and alert staff</h4>
        <p>A connected fire alarm, staff report or potential smoke or flame event flagged by camera analytics would highlight the affected zone and notify authorised staff. Relevant camera views would help the incident controller assess the situation alongside the school’s fire alarm procedures.</p>
        <h4>Guide students and staff away from danger</h4>
        <p>Connected classroom screens and projectors would display clear instructions for each area, including the school-approved evacuation route and assembly point. Guidance would reflect confirmed hazards and authorised updates, helping teachers lead students away from affected areas as conditions change.</p>
        <h4>Coordinate doors, gates and emergency access</h4>
        <p>Where approved integrations are installed, the system would coordinate designated exits and emergency access gates according to the school’s fire response plan. Fire doors and smoke control would remain governed by the approved fire safety systems, with emergency egress and manual overrides maintained.</p>
        <h4>Keep the response visible</h4>
        <p>Authorised staff would see incident updates, reported device status and issued instructions together. An event history would record alerts and response actions for review, while classroom messages would remain under the school’s emergency procedures until an authorised all-clear.</p>
      </section>
    </div>
  );
}

const cameraZones = [
  { id: "entry", name: "East entrance", coverage: "Entrance overview + PTZ detail", event: "Possible smoke event", detail: "Bring the entrance overview and a closer PTZ view together so authorised staff can review the event and its location.", x: 364, y: 160, width: 180, height: 116 },
  { id: "learning", name: "Learning zone", coverage: "Courtyard overview + corridor context", event: "Classroom response review", detail: "See which classroom zone is affected and connect the incident review with the appropriate school-approved response.", x: 202, y: 45, width: 160, height: 104 },
  { id: "west", name: "West grounds", coverage: "Exit overview + assembly area context", event: "Exit condition review", detail: "Review the example exit and assembly area before selecting a response. Camera context supports staff judgement and the approved plan.", x: 48, y: 160, width: 180, height: 116 },
] as const;

function CameraExample() {
  const [zoneId, setZoneId] = useState<string>("entry");
  const [reviewing, setReviewing] = useState(false);
  const zone = cameraZones.find((item) => item.id === zoneId) ?? cameraZones[0];
  return <div className="advanced-camera-example">
    <OperationsRoomConcept variant="cctv" />
    <div className="advanced-camera-story"><span className="advanced-eyebrow">CCTV + zone awareness</span><h3>See the whole picture. Focus on what matters.</h3><p>Explore how camera coverage and a zone alert could help staff understand an incident.</p>
      <div className="advanced-zone-selector" aria-label="Example camera zones">{cameraZones.map((item) => <Button key={item.id} variant="outline" aria-pressed={zone.id === item.id} onClick={() => { setZoneId(item.id); setReviewing(false); }}><MapPin />{item.name}</Button>)}</div>
      <svg className="advanced-zone-map" viewBox="0 0 600 310" role="img" aria-label={`Fictional campus camera coverage with ${zone.name} selected`}><rect x="18" y="18" width="564" height="278" rx="14" fill="#eef4fb" /><path d="M132 145 H470 M282 135 V250" stroke="#fff" strokeWidth="24" fill="none" />{cameraZones.map((item) => <g key={item.id}><rect x={item.x} y={item.y} width={item.width} height={item.height} rx="12" fill={item.id === zone.id ? "#d7e7ff" : "#fff"} stroke={item.id === zone.id ? "#1764d1" : "#c9d8e8"} strokeWidth={item.id === zone.id ? 3 : 1} /><circle cx={item.x + item.width / 2} cy={item.y + 34} r="10" fill={item.id === zone.id ? "#1764d1" : "#7893b0"} /><text x={item.x + item.width / 2} y={item.y + 70} textAnchor="middle">{item.name}</text></g>)}</svg>
      <div className="advanced-camera-event" aria-live="polite" aria-atomic="true"><Camera /><span className="advanced-eyebrow">{reviewing ? "Example zone alert" : "Example camera coverage"}</span><strong>{reviewing ? zone.event : zone.coverage}</strong><p>{reviewing ? zone.detail : `Select “Review zone alert” to explore an example for ${zone.name.toLowerCase()}.`}</p><span>{reviewing ? "Awaiting authorised review · demonstration" : "Fictional campus · coverage example"}</span></div>
      <Button variant="outline" onClick={() => setReviewing(!reviewing)}>{reviewing ? <RotateCcw /> : <Play />}{reviewing ? "Back to coverage" : "Review zone alert"}</Button>
    </div>
  </div>;
}

export default function PlanUpgradeGate({ feature, onUpgrade }: { feature: "cctv" | "guidance"; onUpgrade: () => void }) {
  return (
    <section className="advanced-showcase" aria-labelledby="plan-upgrade-title">
      <header className="advanced-showcase-header">
        <div><span className="advanced-eyebrow"><LockKeyhole /> Discover Magic Keys Advanced</span><h2 id="plan-upgrade-title">{feature === "cctv" ? "CCTV & zones. A clearer view of your school." : "Dynamic Emergency Guidance"}</h2><p>{feature === "cctv" ? "Explore how connected cameras, incident review and classroom guidance could work together for your school." : "Clear fire response information for staff, with school-approved evacuation guidance on connected classroom screens."}</p></div>
        <Button size="lg" onClick={onUpgrade}>Discuss an upgrade <ChevronRight /></Button>
      </header>
      <Tabs defaultValue={feature} className="advanced-preview-tabs">
        <TabsList aria-label="Advanced feature demonstrations" className="advanced-preview-tab-list"><TabsTrigger value="guidance"><MapPin /> Emergency guidance</TabsTrigger><TabsTrigger value="cctv"><Camera /> CCTV & zones</TabsTrigger><TabsTrigger value="screens"><MonitorUp /> Classroom screens</TabsTrigger></TabsList>
        <TabsContent value="guidance"><FireResponseDescription /></TabsContent>
        <TabsContent value="cctv"><CameraExample /></TabsContent>
        <TabsContent value="screens"><FireResponseDescription screenFirst /></TabsContent>
      </Tabs>
      <div className="advanced-benefits">{benefits.map(({ key, Icon, title, text }) => <article key={key}><Icon /><h3>{title}</h3><p>{text}</p></article>)}</div>
      <footer className="advanced-upgrade-invitation"><div><span className="advanced-eyebrow">Built around your school</span><h3>See what this could look like on your site.</h3><p>Ask RJL for a guided demonstration and a tailored proposal covering your cameras, classroom displays and response workflows.</p></div><Button size="lg" onClick={onUpgrade}>Arrange a demonstration <ArrowRight /></Button></footer>
      <p className="advanced-demo-note"><CheckCircle2 /> The fire response described is a proposed service. Live operation requires an agreed upgrade, compatible integrations and school-approved commissioning; the previews do not operate equipment.</p>
    </section>
  );
}
