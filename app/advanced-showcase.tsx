"use client";
/* eslint-disable @next/next/no-img-element -- example pictures are small pre-sized JPEGs in /public/showcase */

/**
 * AdvancedShowcase — what staff see on the locked "CCTV & zones" and
 * "Emergency guidance" pages while those modules are not part of the site's plan.
 *
 * The modules stay locked. This only explains the service and invites the
 * person to enquire with RJL. It is generic Magic Keys material: no school
 * names, crests or site details, and the pictures are labelled as examples.
 *
 * Each page plays a short animated story (step highlight + matching picture).
 * The left-hand monitor shows the real Magic Keys portal, captured with all
 * school names, gate names and locations removed.
 * Visitors whose device asks for reduced motion get a still picture and can
 * click through the steps themselves.
 *
 * Accuracy: a person confirms every alert; nothing here claims to replace the
 * fire detection and warning system, procedures or emergency services.
 *
 * Camera privacy (RJL's stated design, 10 Oct 2026): Sentinel looks only for
 * fire, smoke and weapons. It does not look for people unless they are linked
 * to a threat, keeps no footage of students or staff in normal operation, and
 * records standard CCTV only where the school has parent/carer and staff
 * permission. The pictures and wording must not show it watching people.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BellRing, CheckCircle2, ClipboardList, DoorOpen, Eye, Hand, LockKeyhole, Mail,
  MonitorUp, Phone, Route, ScanEye, ShieldCheck, Users, Wrench,
} from "lucide-react";

export type ShowcaseFeature = "cctv" | "guidance";

const RJL_EMAIL = "info@rjlcommercialgroup.com";
const RJL_PHONE_LINK = "tel:0400101132";
const RJL_PHONE_TEXT = "0400 101 132";

/** How Sentinel treats students and staff. Shown on both locked pages. */
const CAMERA_PRIVACY: Step[] = [
  { title: "Threats only", text: "Sentinel is trained to look only for fire, smoke and weapons such as knives, guns and bats. It does not look for people unless they are linked to a threat." },
  { title: "Nothing kept of students or staff", text: "In normal operation Sentinel does not record or keep any footage or files of students or staff." },
  { title: "Recording starts with a threat", text: "Recording starts only when Sentinel detects a fire or a threat. If a person is linked to that threat, they are included in the recording so staff and emergency services can respond." },
  { title: "Standard CCTV only with permission", text: "Where the school has permission from parents, carers and staff, Sentinel can also record like the CCTV systems already in schools. Its job stays the same: finding fires and threats." },
];

type Step = { title: string; text: string };

const CCTV_STEPS: Step[] = [
  { title: "It watches", text: "AI keeps an eye on the zones you pick, day and night, without getting tired or distracted." },
  { title: "It flags", text: "Smoke and flame on camera 12: the wall switches to that camera and the right person gets a prompt with the live picture." },
  { title: "You decide", text: "One tap to confirm or dismiss. Every alert, decision and action is recorded for later review." },
];

const GUIDANCE_STEPS: Step[] = [
  { title: "Detect", text: "An AI camera picks up smoke and flame at the plant room, and the camera wall switches to it." },
  { title: "Prompt", text: "The duty staff member gets a prompt with the live picture and the location." },
  { title: "Confirm", text: "They check it and confirm with one tap. Nothing goes out without a person's say-so." },
  { title: "Guide", text: "Every classroom projector flashes a fire warning, then shows the way out, away from the danger. Gates follow the plan, and everything is logged." },
];

/** How long each step plays (ms). The last guidance step plays the warning, then the route. */
const CCTV_DURATIONS = [3800, 5600, 4400];
const GUIDANCE_DURATIONS = [4800, 4200, 4200, 10000];

/* Screen positions on the example pictures, as a share of the 1400 x 933 picture. */
type Box = { left: string; top: string; width: string; height: string };
const WALL: Record<"left" | "centre" | "right" | "cam12", Box> = {
  left: { left: "2.3%", top: "22.4%", width: "30.4%", height: "39.3%" },
  centre: { left: "34.2%", top: "22.5%", width: "31.8%", height: "38.8%" },
  right: { left: "67.1%", top: "22.4%", width: "31%", height: "39.3%" },
  cam12: { left: "55.2%", top: "46.1%", width: "10.7%", height: "7.4%" },
};
const DESK: Record<"left" | "right", Box> = {
  left: { left: "2.4%", top: "26.4%", width: "30.7%", height: "36.9%" },
  right: { left: "66.3%", top: "26.4%", width: "31.2%", height: "36.7%" },
};
const PROJECTOR: Box = { left: "25.7%", top: "11.8%", width: "49.6%", height: "39.2%" };
const FIRE_FEED = "/showcase/cam12-fire.jpg";

function enquiryLink(subject: string, interest: string, name?: string, email?: string) {
  const signature = [name, email].filter(Boolean).join("\n");
  const body = `Hi Jarrod,\n\nI saw ${interest} in the Magic Keys portal and would like to find out more. Could you get in touch to arrange a walkthrough?\n\n${signature}`.trim();
  return `mailto:${RJL_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Plays the steps one after another (each for its own time) unless the device asks for reduced motion. */
function useStory(durations: number[], stillStep: number) {
  const [step, setStep] = useState(0);
  const [animated, setAnimated] = useState(true);
  const [cycle, setCycle] = useState(0); // restarts the timer when someone picks a step

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setAnimated(!query.matches);
      if (query.matches) setStep(stillStep);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [stillStep]);

  useEffect(() => {
    if (!animated) return;
    const timer = window.setTimeout(() => setStep((current) => (current + 1) % durations.length), durations[step]);
    return () => window.clearTimeout(timer);
  }, [animated, durations, step, cycle]);

  const choose = (index: number) => { setStep(index); setCycle((value) => value + 1); };
  return { step, animated, choose, duration: durations[step] };
}

function StepRail({ steps, step, animated, duration, onChoose, label }: { steps: Step[]; step: number; animated: boolean; duration: number; onChoose: (index: number) => void; label: string }) {
  return (
    <ol className="mk-sc-steps" style={{ ["--mk-sc-n" as string]: steps.length }} aria-label={label}>
      {steps.map((item, index) => (
        <li key={item.title}>
          <button type="button" className={index === step ? "is-on" : undefined} aria-pressed={index === step} onClick={() => onChoose(index)}>
            <span className="mk-sc-num">{index + 1}</span>
            <strong>{item.title}</strong>
            <span className="mk-sc-step-text">{item.text}</span>
            {index === step && animated && <i key={`${step}`} className="mk-sc-progress" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ol>
  );
}

function LockStrip() {
  return (
    <div className="mk-sc-lock" role="note">
      <LockKeyhole aria-hidden="true" />
      <p><strong>Contact the team for more information on how to unlock this package.</strong></p>
    </div>
  );
}

function Contact({ subject, interest, primary, name, email }: { subject: string; interest: string; primary: string; name?: string; email?: string }) {
  return (
    <div className="mk-sc-cta">
      <a className="mk-sc-btn is-primary" href={enquiryLink(subject, interest, name, email)}><Mail aria-hidden="true" />{primary}</a>
      <a className="mk-sc-btn is-ghost" href={RJL_PHONE_LINK}><Phone aria-hidden="true" />Call Jarrod on {RJL_PHONE_TEXT}</a>
    </div>
  );
}

/** Shown under the picture on narrow screens, where the step list is further down the page. */
function StageCaption({ steps, step }: { steps: Step[]; step: number }) {
  const current = steps[step];
  return (
    <div className="mk-sc-caption" aria-hidden="true">
      <span className="mk-sc-num">{step + 1}</span>
      <div><strong>{current.title}</strong><span>{current.text}</span></div>
    </div>
  );
}

/* ------------------------------------------------- example screen pieces */

type Toast = { tone: "red" | "green"; title: string; text: string };

/** The Magic Keys portal (an unbranded capture of the real dashboard) on a monitor in the picture. */
function PortalScreen({ box, src, toast }: { box: Box; src: string; toast?: Toast }) {
  return (
    <div className="mk-sc-screen mk-sc-portal" style={box}>
      <img src={src} alt="" decoding="async" />
      {toast && <div key={toast.title} className={`mk-sc-toast is-${toast.tone}`}><b>{toast.title}</b>{toast.text}</div>}
      <i className="mk-sc-glare" />
    </div>
  );
}

/** Camera 12's tile in the camera grid, now showing the fire, outlined in red. */
function FireTile() {
  return (
    <div className="mk-sc-screen mk-sc-tile" style={WALL.cam12}>
      <img src={FIRE_FEED} alt="" decoding="async" />
      <span className="mk-sc-tile-name">CAM12</span>
      <span className="mk-sc-tile-flag">SMOKE / FLAME</span>
    </div>
  );
}

/** The camera wall switches its centre screen to camera 12 full size. */
function AlarmView({ instant, confirmed }: { instant?: boolean; confirmed?: boolean }) {
  return (
    <div className={`mk-sc-screen mk-sc-alarm${instant ? " is-instant" : ""}`} style={WALL.centre}>
      <img src={FIRE_FEED} alt="" decoding="async" />
      <div className="mk-sc-alarm-bar"><i className="mk-sc-rec" />ALARM<span>CAM12</span><span>PLANT ROOM</span><span>ZONE 3</span></div>
      <span className="mk-sc-alarm-box"><span>SMOKE + FLAME</span></span>
      {confirmed && <span className="mk-sc-alarm-ok"><CheckCircle2 aria-hidden="true" />CONFIRMED BY DUTY STAFF</span>}
    </div>
  );
}

function PromptCard({ done, doneTitle, doneText, text }: { done?: boolean; doneTitle: string; doneText: string; text: string }) {
  return done ? (
    <div className="mk-sc-alert is-done">
      <b>{doneTitle}</b>
      {doneText}
      <div className="mk-sc-send"><i /></div>
    </div>
  ) : (
    <div className="mk-sc-alert has-thumb">
      <img className="mk-sc-thumb" src={FIRE_FEED} alt="" decoding="async" />
      <b>Possible smoke and flame</b>
      {text}
      <div className="mk-sc-acts"><i>Confirm</i><i className="is-grey">Dismiss</i></div>
    </div>
  );
}

/** Floor plan shown on the projector once the warning has played. */
function EvacuationMap() {
  return (
    <svg className="mk-sc-map" viewBox="0 0 640 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <pattern id="mk-sc-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="9" height="9" fill="#ffe4e4" /><line x1="0" y1="0" x2="0" y2="9" stroke="#f3a0a0" strokeWidth="4" />
        </pattern>
        <radialGradient id="mk-sc-heat"><stop offset="0" stopColor="#ff3b30" stopOpacity="0.6" /><stop offset="1" stopColor="#ff3b30" stopOpacity="0" /></radialGradient>
      </defs>

      {/* Grounds, building, corridor */}
      <rect width="640" height="260" fill="#e7f4ea" />
      <rect x="120" y="22" width="500" height="216" fill="#f7f9fc" />
      <rect x="120" y="110" width="500" height="40" fill="#ffffff" />

      {/* Plant room: the fire */}
      <rect x="490" y="22" width="130" height="88" fill="url(#mk-sc-hatch)" />
      <circle className="mk-sc-heat" cx="555" cy="62" r="78" fill="url(#mk-sc-heat)" />

      {/* Walls (gaps are doorways) */}
      <g stroke="#2f3d57" strokeWidth="3" fill="none" strokeLinecap="square">
        <path d="M120 22 H620 V110 M620 150 V238 H120 V150 M120 110 V22" strokeWidth="5" />
        <path d="M120 110 H165 M190 110 H285 M315 110 H405 M430 110 H535 M560 110 H620" />
        <path d="M120 150 H165 M190 150 H300 M325 150 H425 M450 150 H535 M560 150 H620" />
        <path d="M240 22 V110 M360 22 V110 M490 22 V110 M240 150 V238 M390 150 V238 M490 150 V238" />
      </g>

      {/* Room names */}
      <g fontSize="11" fill="#5b6b85" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">
        <text x="180" y="70">Library</text>
        <text x="266" y="100">Room 12</text>
        <text x="425" y="70">Room 13</text>
        <text x="180" y="200">Staff room</text>
        <text x="315" y="200">Room 14</text>
        <text x="440" y="200">Toilets</text>
        <text x="555" y="200">Store</text>
      </g>

      {/* Fire marker */}
      <g className="mk-sc-fire-icon" transform="translate(555 52)">
        <path d="M0 -20 C10 -8 14 0 10 10 C7 17 -7 17 -10 10 C-14 0 -6 -6 -3 -12 C-2 -6 1 -4 3 -3 C4 -9 2 -14 0 -20 Z" fill="#e5373a" />
        <path d="M0 -4 C5 1 6 6 3 10 C1 12 -3 12 -4 9 C-6 5 -2 2 0 -4 Z" fill="#ffd166" />
      </g>
      <text x="555" y="92" fontSize="13" fontWeight="700" fill="#b3261e" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">FIRE</text>

      {/* East side closed off: no entry towards the fire */}
      <g stroke="#e5373a" strokeWidth="4" strokeLinecap="round">
        <line x1="470" y1="114" x2="470" y2="146" strokeDasharray="5 5" />
        <line x1="604" y1="120" x2="624" y2="140" /><line x1="624" y1="120" x2="604" y2="140" />
      </g>
      <text x="545" y="134" fontSize="11" fontWeight="700" fill="#b3261e" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">NO ENTRY</text>

      {/* Exit and assembly area */}
      <rect x="126" y="90" width="40" height="15" rx="2" fill="#138a4c" />
      <text x="146" y="101" fontSize="10" fontWeight="700" fill="#ffffff" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">EXIT</text>
      <circle cx="58" cy="130" r="40" fill="#19b36b" fillOpacity="0.16" stroke="#19b36b" strokeWidth="3" />
      <circle cx="58" cy="130" r="17" fill="#138a4c" />
      <text x="58" y="136" fontSize="17" fontWeight="700" fill="#ffffff" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">A</text>
      <text x="58" y="186" fontSize="10" fontWeight="700" fill="#0b6b3c" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">ASSEMBLY</text>
      <text x="58" y="198" fontSize="10" fontWeight="700" fill="#0b6b3c" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">AREA A</text>

      {/* The route: draws itself, then shows which way to walk */}
      <path className="mk-sc-route" d="M300 64 V130 H100" />
      <path className="mk-sc-route-flow" d="M300 64 V130 H100" />
      <path className="mk-sc-route-end" d="M106 118 L84 130 L106 142 Z" fill="#19b36b" />

      {/* You are here */}
      <circle className="mk-sc-you-ring" cx="300" cy="62" r="8" fill="none" stroke="#1463ff" strokeWidth="3" />
      <circle cx="300" cy="62" r="7" fill="#1463ff" stroke="#ffffff" strokeWidth="2" />
      <text x="300" y="42" fontSize="10" fontWeight="700" fill="#1463ff" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif">YOU ARE HERE</text>

      {/* Legend */}
      <g fontSize="9" fill="#33415c" fontFamily="Arial, Helvetica, sans-serif">
        <line x1="10" y1="222" x2="30" y2="222" stroke="#19b36b" strokeWidth="6" strokeLinecap="round" />
        <text x="36" y="225">Your route</text>
        <rect x="12" y="234" width="16" height="10" fill="url(#mk-sc-hatch)" stroke="#e5373a" />
        <text x="36" y="243">Keep away</text>
      </g>
    </svg>
  );
}

/** Classroom projector: lesson, then a flashing fire warning, then the route out. */
function ProjectorEvac() {
  return (
    <div className="mk-sc-screen mk-sc-proj" style={PROJECTOR}>
      <div className="mk-sc-proj-route">
        <div className="mk-sc-evac-hd"><span>EVACUATE NOW</span><small>Fire: plant room (Zone 3)</small></div>
        <div className="mk-sc-evac-sub"><ArrowLeft aria-hidden="true" />Follow the green route to Assembly Area A</div>
        <EvacuationMap />
      </div>
      <div className="mk-sc-proj-warning">
        <svg viewBox="0 0 64 56" aria-hidden="true"><path d="M32 3 L61 53 H3 Z" fill="#ffffff" /><path d="M32 7 L57 50 H7 Z" fill="#ffd400" /><rect x="29" y="20" width="6" height="18" rx="2" fill="#111" /><circle cx="32" cy="44" r="3.4" fill="#111" /></svg>
        <strong>FIRE ALARM</strong>
        <em>EVACUATE NOW</em>
        <span>Stop work. Leave your belongings. Follow your teacher.</span>
      </div>
      <div className="mk-sc-proj-idle"><span>Year 9 Science</span>Lesson in progress</div>
    </div>
  );
}

/* ------------------------------------------------- Camera privacy (both pages) */

function CameraPrivacy() {
  return (
    <section className="mk-sc-privacy" aria-labelledby="mk-sc-privacy-title">
      <div className="mk-sc-privacy-head">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h3 id="mk-sc-privacy-title">Students and staff: what the cameras look for</h3>
          <p>Sentinel has one job: finding fires and threats.</p>
        </div>
      </div>
      <ul>
        {CAMERA_PRIVACY.map((item) => <li key={item.title}><strong>{item.title}</strong><span>{item.text}</span></li>)}
      </ul>
    </section>
  );
}

/* --------------------------------------------------------------- CCTV page */

function CctvStage({ step }: { step: number }) {
  const toast: Toast | undefined = step === 1
    ? { tone: "red", title: "Possible smoke and flame", text: "CAM12, plant room (Zone 3)" }
    : step === 2 ? { tone: "green", title: "Confirmed by duty staff", text: "Response under way and logged" } : undefined;
  return (
    <figure className="mk-sc-stage" data-step={step}>
      <div className="mk-sc-frame">
        <img src="/showcase/sentinel-cctv-wall.jpg" alt="" width={1400} height={933} decoding="async" />
        <span className="mk-sc-det" style={{ left: "36.2%", top: "55.6%", width: "6.8%", height: "4.8%", animationDelay: "1.1s" }}><span>GATE OPEN 4 MIN</span></span>
        {step >= 1 && <FireTile />}
        {step >= 1 && <AlarmView instant={step === 2} confirmed={step === 2} />}
        <PortalScreen box={WALL.left} src="/showcase/portal-overview.jpg" toast={toast} />
        <div className="mk-sc-screen mk-sc-mon" style={WALL.right}>
          <h4>Staff prompts</h4>
          {step === 0 && <div className="mk-sc-idle"><i className="mk-sc-pulse" />Watching every zone<small>No prompts waiting</small></div>}
          {step >= 1 && <PromptCard done={step === 2} doneTitle="Confirmed by duty staff" doneText="Response under way. Every step is logged." text="CAM12, plant room (Zone 3). Live view attached." />}
        </div>
        <span className="mk-sc-tag">EXAMPLE SCREENS</span>
      </div>
      <StageCaption steps={CCTV_STEPS} step={step} />
      <figcaption className="mk-sc-sr">Example: the Magic Keys portal on the left screen, the camera wall in the middle and staff prompts on the right. The portal marks a gate left open, then the AI spots smoke and flame on camera 12; the wall switches to that camera and duty staff confirm the alert.</figcaption>
    </figure>
  );
}

function CctvShowcase({ name, email, onExplore }: { name?: string; email?: string; onExplore?: () => void }) {
  const story = useStory(CCTV_DURATIONS, 1);
  return (
    <>
      <LockStrip />
      <div className="mk-sc-hero">
        <div className="mk-sc-copy">
          <span className="mk-sc-eyebrow"><ScanEye aria-hidden="true" />Magic Keys Sentinel<i className="mk-sc-sep" aria-hidden="true" />AI CCTV</span>
          <h2 className="mk-sc-title">Eyes on every zone. <em>Even when no one&rsquo;s watching.</em></h2>
          <p className="mk-sc-lead">Sentinel adds AI to your cameras so they look for danger, not people. It watches the zones you choose for fire and weapons, and puts the decision straight into the hands of your staff.</p>
          <ul className="mk-sc-ticks">
            <li>Watches gates, car parks, entries, perimeters and roof lines around the clock</li>
            <li>Looks only for signs of smoke or flame and weapons such as knives, guns and bats</li>
            <li>Keeps no footage of students or staff unless a threat is found</li>
            <li>Sends your duty staff a prompt with a live picture and the exact location</li>
            <li>A person confirms every alert before anything happens</li>
            <li>Works hand in hand with your Magic Keys gates and doors</li>
          </ul>
          <Contact subject="Magic Keys Sentinel – walkthrough request" interest="Magic Keys Sentinel (AI CCTV)" primary="Book a walkthrough" name={name} email={email} />
          <p className="mk-sc-small">Designed, installed and supported by RJL Commercial. Every system is set up and tested on site before it goes live.</p>
        </div>
        <CctvStage step={story.step} />
      </div>
      <StepRail steps={CCTV_STEPS} step={story.step} animated={story.animated} duration={story.duration} onChoose={story.choose} label="How Sentinel works" />
      <div className="mk-sc-features">
        <article><Eye aria-hidden="true" /><h3>Fewer blind spots</h3><p>AI PTZ cameras with a 180-degree overview and 42x zoom can watch a wide area and close in on detail.</p></article>
        <article><Hand aria-hidden="true" /><h3>People stay in charge</h3><p>Sentinel suggests, your staff decide. Nothing happens on its own.</p></article>
        <article><ClipboardList aria-hidden="true" /><h3>One system</h3><p>Alerts, gates, schedules and history all live in the Magic Keys portal you already use.</p></article>
        <article><Wrench aria-hidden="true" /><h3>Your cameras assessed</h3><p>We review the cameras you already have and recommend only what&rsquo;s needed.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Privacy built in</h3><p>Looks for fires and threats, not people. Set up to suit your privacy and CCTV policies, with access limited to approved staff.</p></article>
        <article><Users aria-hidden="true" /><h3>Supported locally</h3><p>Installed, tuned and maintained by RJL Commercial, the team behind your gates.</p></article>
      </div>
      <CameraPrivacy />
      <div className="mk-sc-closing">
        <div>
          <h3>See Sentinel on your own site.</h3>
          <p>We&rsquo;ll walk your campus with you and show exactly what it would watch and who it would alert.</p>
        </div>
        <div className="mk-sc-closing-actions">
          {onExplore && <button type="button" className="mk-sc-btn is-ghost-dark" onClick={onExplore}>See it trigger an evacuation <ArrowRight aria-hidden="true" /></button>}
          <a className="mk-sc-btn is-primary" href={enquiryLink("Magic Keys Sentinel – walkthrough request", "Magic Keys Sentinel (AI CCTV)", name, email)}>Talk to Jarrod <ArrowRight aria-hidden="true" /></a>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- Guidance page */

function GuidanceStage({ step }: { step: number }) {
  return (
    <figure className="mk-sc-stage mk-sc-story" data-step={step}>
      <div className="mk-sc-frame">
        {/* Scene 1: the AI camera wall spots smoke and flame on camera 12 */}
        <div className={`mk-sc-scene${step === 0 ? " is-active" : ""}`}>
          <img src="/showcase/sentinel-cctv-wall.jpg" alt="" width={1400} height={933} decoding="async" />
          {step === 0 && <FireTile />}
          {step === 0 && <AlarmView />}
          <PortalScreen box={WALL.left} src="/showcase/portal-overview.jpg" toast={{ tone: "red", title: "Possible smoke and flame", text: "CAM12, plant room (Zone 3)" }} />
          <div className="mk-sc-screen mk-sc-mon" style={WALL.right}>
            <h4>Sentinel CAM12</h4>
            <div className="mk-sc-idle is-alert"><i className="mk-sc-pulse is-red" />Smoke and flame detected<small>Notifying duty staff...</small></div>
          </div>
        </div>

        {/* Scenes 2 and 3: the duty staff prompt, then the confirmation */}
        <div className={`mk-sc-scene${step === 1 || step === 2 ? " is-active" : ""}`}>
          <img src="/showcase/emergency-operations-desk.jpg" alt="" width={1400} height={933} decoding="async" />
          {step === 2
            ? <PortalScreen box={DESK.left} src="/showcase/portal-fire.jpg" />
            : (
              <div className="mk-sc-screen mk-sc-mon" style={DESK.left}>
                <h4>Incident: Zone 3</h4>
                <img className="mk-sc-feed" src={FIRE_FEED} alt="" decoding="async" />
                <div className="mk-sc-zone"><span>CAM12, plant room</span><span>Live</span></div>
              </div>
            )}
          <div className="mk-sc-screen mk-sc-mon" style={DESK.right}>
            <h4>Staff prompt</h4>
            {(step === 1 || step === 2) && <PromptCard done={step === 2} doneTitle="Confirmed by duty staff" doneText="Sending the evacuation route to every classroom screen..." text="Zone 3, plant room." />}
          </div>
        </div>

        {/* Scene 4: every classroom projector warns, then shows the way out */}
        <div className={`mk-sc-scene${step === 3 ? " is-active" : ""}`}>
          <img src="/showcase/classroom-projector.jpg" alt="" width={1400} height={933} decoding="async" />
          <ProjectorEvac />
        </div>

        <ol className="mk-sc-scene-dots" aria-hidden="true">{GUIDANCE_STEPS.map((item, index) => <li key={item.title} className={index === step ? "is-on" : undefined}>{item.title}</li>)}</ol>
        <span className="mk-sc-tag">EXAMPLE SCREENS</span>
      </div>
      <StageCaption steps={GUIDANCE_STEPS} step={step} />
      <figcaption className="mk-sc-sr">Example: camera 12 spots smoke and flame at the plant room, the duty staff member gets a prompt and confirms it, the portal switches to fire evacuation, and every classroom projector flashes a fire warning and then shows the evacuation route away from the danger to Assembly Area A.</figcaption>
    </figure>
  );
}

function GuidanceShowcase({ name, email, onExplore }: { name?: string; email?: string; onExplore?: () => void }) {
  const story = useStory(GUIDANCE_DURATIONS, 3);
  return (
    <>
      <LockStrip />
      <div className="mk-sc-hero">
        <div className="mk-sc-copy">
          <span className="mk-sc-eyebrow"><BellRing aria-hidden="true" />Magic Keys Emergency Guidance</span>
          <h2 className="mk-sc-title">From the first sign of smoke to <em>every classroom knowing the way out.</em></h2>
          <p className="mk-sc-lead">Emergency Guidance links AI cameras, your staff and the projectors already in your classrooms. The moment a person gives the word, every room gets clear directions to the safest way out.</p>
          <ul className="mk-sc-ticks">
            <li>AI cameras pick up early signs of smoke or flame</li>
            <li>Duty staff get a prompt with the live picture and confirm in one tap</li>
            <li>Classroom projectors switch straight to an evacuation screen with the route to take</li>
            <li>The route steers people away from the danger and towards the assembly area</li>
            <li>Magic Keys gates and doors follow your agreed emergency plan</li>
          </ul>
          <Contact subject="Magic Keys Emergency Guidance – demo request" interest="Magic Keys Emergency Guidance" primary="Book a demo" name={name} email={email} />
          <p className="mk-sc-small">Designed, installed and supported by RJL Commercial. Every system is set up and tested on site before it goes live.</p>
        </div>
        <GuidanceStage step={story.step} />
      </div>
      <StepRail steps={GUIDANCE_STEPS} step={story.step} animated={story.animated} duration={story.duration} onChoose={story.choose} label="How Emergency Guidance works" />
      <div className="mk-sc-features">
        <article><MonitorUp aria-hidden="true" /><h3>The screens you already have</h3><p>Classroom projectors and displays become the clearest emergency sign in the room.</p></article>
        <article><Route aria-hidden="true" /><h3>Away from the danger</h3><p>Each room is shown a route that avoids the affected area and leads to the assembly point.</p></article>
        <article><Hand aria-hidden="true" /><h3>A person gives the word</h3><p>Nothing goes to the classrooms until duty staff confirm what the camera saw.</p></article>
        <article><DoorOpen aria-hidden="true" /><h3>Gates follow the plan</h3><p>Magic Keys gates and doors respond the way your agreed emergency plan says they should.</p></article>
        <article><ClipboardList aria-hidden="true" /><h3>Every step logged</h3><p>Alerts, confirmations and messages are recorded for your debrief and drills.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Built around your plan</h3><p>Routes, assembly areas and wording are set up with you and tested on site.</p></article>
      </div>
      <CameraPrivacy />
      <div className="mk-sc-closing">
        <div>
          <h3>Seconds count. Clear directions save them.</h3>
          <p>Let us show you how Emergency Guidance would work across your buildings.</p>
        </div>
        <div className="mk-sc-closing-actions">
          {onExplore && <button type="button" className="mk-sc-btn is-ghost-dark" onClick={onExplore}>How the AI cameras work <ArrowRight aria-hidden="true" /></button>}
          <a className="mk-sc-btn is-primary" href={enquiryLink("Magic Keys Emergency Guidance – demo request", "Magic Keys Emergency Guidance", name, email)}>Talk to Jarrod <ArrowRight aria-hidden="true" /></a>
        </div>
      </div>
      <p className="mk-sc-disclaimer">Emergency Guidance supports, and never replaces, your fire detection and warning system, your emergency procedures and directions from emergency services. Screens shown are examples.</p>
    </>
  );
}

export default function AdvancedShowcase({ feature, viewerName, viewerEmail, onSwitch }: {
  feature: ShowcaseFeature;
  viewerName?: string;
  viewerEmail?: string;
  /** Opens the other locked page (CCTV <-> Emergency guidance). */
  onSwitch?: (feature: ShowcaseFeature) => void;
}) {
  return (
    <section className="mk-sc" aria-label={feature === "cctv" ? "Magic Keys Sentinel AI CCTV" : "Magic Keys Emergency Guidance"}>
      {feature === "cctv"
        ? <CctvShowcase name={viewerName} email={viewerEmail} onExplore={onSwitch && (() => onSwitch("guidance"))} />
        : <GuidanceShowcase name={viewerName} email={viewerEmail} onExplore={onSwitch && (() => onSwitch("cctv"))} />}
    </section>
  );
}
