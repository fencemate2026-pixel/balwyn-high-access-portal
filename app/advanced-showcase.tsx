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
 * Visitors whose device asks for reduced motion get a still picture and can
 * click through the steps themselves.
 *
 * Accuracy: a person confirms every alert; nothing here claims to replace the
 * fire detection and warning system, procedures or emergency services.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight, BellRing, CheckCircle2, ClipboardList, DoorOpen, Eye, Hand, LockKeyhole, Mail,
  MonitorUp, Phone, Route, ScanEye, ShieldCheck, Users, Wrench,
} from "lucide-react";

export type ShowcaseFeature = "cctv" | "guidance";

const RJL_EMAIL = "info@rjlcommercialgroup.com";
const RJL_PHONE_LINK = "tel:0400101132";
const RJL_PHONE_TEXT = "0400 101 132";

type Step = { title: string; text: string };

const CCTV_STEPS: Step[] = [
  { title: "It watches", text: "AI keeps an eye on the zones you pick, day and night, without getting tired or distracted." },
  { title: "It flags", text: "When something needs attention, the right person gets a prompt with the live picture and where it is." },
  { title: "You decide", text: "One tap to confirm or dismiss. Every alert, decision and action is recorded for later review." },
];

const GUIDANCE_STEPS: Step[] = [
  { title: "Detect", text: "An AI camera picks up signs of smoke near the plant room." },
  { title: "Prompt", text: "The duty staff member gets a prompt with the live picture and the location." },
  { title: "Confirm", text: "They check it and confirm with one tap. Nothing goes out without a person's say-so." },
  { title: "Guide", text: "Every classroom projector shows the way out, away from the danger. Gates follow the plan, and everything is logged." },
];

const STEP_MS = 3600;

function enquiryLink(subject: string, interest: string, name?: string, email?: string) {
  const signature = [name, email].filter(Boolean).join("\n");
  const body = `Hi Jarrod,\n\nI saw ${interest} in the Magic Keys portal and would like to find out more. Could you get in touch to arrange a walkthrough?\n\n${signature}`.trim();
  return `mailto:${RJL_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Advances through the steps on a timer unless the device asks for reduced motion. */
function useStory(length: number, stillStep: number) {
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
    const timer = window.setInterval(() => setStep((current) => (current + 1) % length), STEP_MS);
    return () => window.clearInterval(timer);
  }, [animated, length, cycle]);

  const choose = (index: number) => { setStep(index); setCycle((value) => value + 1); };
  return { step, animated, choose };
}

function StepRail({ steps, step, animated, onChoose, label }: { steps: Step[]; step: number; animated: boolean; onChoose: (index: number) => void; label: string }) {
  return (
    <ol className="mk-sc-steps" style={{ ["--mk-sc-n" as string]: steps.length }} aria-label={label}>
      {steps.map((item, index) => (
        <li key={item.title}>
          <button type="button" className={index === step ? "is-on" : undefined} aria-pressed={index === step} onClick={() => onChoose(index)}>
            <span className="mk-sc-num">{index + 1}</span>
            <strong>{item.title}</strong>
            <span className="mk-sc-step-text">{item.text}</span>
            {index === step && animated && <i key={`${step}`} className="mk-sc-progress" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ol>
  );
}

function LockStrip({ text }: { text: string }) {
  return (
    <div className="mk-sc-lock" role="note">
      <LockKeyhole aria-hidden="true" />
      <p><strong>This module isn&rsquo;t switched on for your site yet.</strong> {text}</p>
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

/* --------------------------------------------------------------- CCTV page */

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

function CctvStage({ step }: { step: number }) {
  return (
    <figure className="mk-sc-stage" data-step={step}>
      <div className="mk-sc-frame">
        <img src="/showcase/sentinel-cctv-wall.jpg" alt="" width={1400} height={933} decoding="async" />
        <span className="mk-sc-det" style={{ left: "44.9%", top: "31.3%", width: "6.2%", height: "5.6%" }}><span>PERSON AFTER HOURS</span></span>
        <span className="mk-sc-det" style={{ left: "36.2%", top: "55.6%", width: "6.8%", height: "4.8%", animationDelay: "1.1s" }}><span>GATE OPEN 4 MIN</span></span>
        <span className="mk-sc-det is-red mk-sc-from-1" style={{ left: "57.4%", top: "47.8%", width: "5.6%", height: "5.2%" }}><span>SMOKE?</span></span>
        <div className="mk-sc-screen mk-sc-mon" style={{ left: "2.3%", top: "22.4%", width: "30.4%", height: "39.3%" }}>
          <h4>Live zones</h4>
          <div className="mk-sc-zone"><span><i className="mk-sc-dot" />North gate</span><span>Clear</span></div>
          <div className="mk-sc-zone"><span><i className="mk-sc-dot is-amber" />Car park</span><span>After hours</span></div>
          <div className="mk-sc-zone">
            <span><i className={step >= 1 ? "mk-sc-dot is-red" : "mk-sc-dot"} />Plant room</span>
            <span>{step >= 1 ? "Smoke?" : "Clear"}</span>
          </div>
          <div className="mk-sc-zone"><span><i className="mk-sc-dot" />Main entry</span><span>Clear</span></div>
        </div>
        <div className="mk-sc-screen mk-sc-mon" style={{ left: "67.1%", top: "22.4%", width: "31%", height: "39.3%" }}>
          <h4>Prompts for duty staff</h4>
          {step === 0 && <div className="mk-sc-idle"><i className="mk-sc-pulse" />Watching every zone<small>No prompts waiting</small></div>}
          {step >= 1 && (
            <div className={`mk-sc-alert${step === 2 ? " is-done" : ""}`}>
              <b>Possible smoke</b>
              Zone 3, plant room, rear wall. Live view attached.
              {step === 1
                ? <div className="mk-sc-acts"><i>Confirm</i><i className="is-grey">Dismiss</i></div>
                : <div className="mk-sc-confirmed"><CheckCircle2 aria-hidden="true" />Confirmed by duty staff and logged</div>}
            </div>
          )}
        </div>
        <span className="mk-sc-tag">EXAMPLE SCREENS</span>
      </div>
      <StageCaption steps={CCTV_STEPS} step={step} />
      <figcaption className="mk-sc-sr">Example: an AI monitoring wall marks a person after hours, a gate left open and possible smoke, then sends a prompt for duty staff to confirm.</figcaption>
    </figure>
  );
}

function CctvShowcase({ name, email, onExplore }: { name?: string; email?: string; onExplore?: () => void }) {
  const story = useStory(CCTV_STEPS.length, 1);
  return (
    <>
      <LockStrip text="Ask RJL Commercial and we'll show you what it can do for your campus." />
      <div className="mk-sc-hero">
        <div className="mk-sc-copy">
          <span className="mk-sc-eyebrow"><ScanEye aria-hidden="true" />Magic Keys Sentinel<i className="mk-sc-sep" aria-hidden="true" />AI CCTV</span>
          <h2 className="mk-sc-title">Eyes on every zone. <em>Even when no one&rsquo;s watching.</em></h2>
          <p className="mk-sc-lead">Sentinel adds AI to your cameras so they don&rsquo;t just record, they watch. It keeps an eye on the zones you choose, picks out what matters, and puts the decision straight into the hands of your staff.</p>
          <ul className="mk-sc-ticks">
            <li>Watches gates, car parks, entries, perimeters and roof lines around the clock</li>
            <li>Picks out signs of smoke or flame, people where they shouldn&rsquo;t be after hours, gates left open and crowds building</li>
            <li>Sends your duty staff a prompt with a live picture and the exact location</li>
            <li>A person confirms every alert before anything happens</li>
            <li>Works hand in hand with your Magic Keys gates and doors</li>
          </ul>
          <Contact subject="Magic Keys Sentinel – walkthrough request" interest="Magic Keys Sentinel (AI CCTV)" primary="Book a walkthrough" name={name} email={email} />
          <p className="mk-sc-small">Designed, installed and supported by RJL Commercial. Every system is set up and tested on site before it goes live.</p>
        </div>
        <CctvStage step={story.step} />
      </div>
      <StepRail steps={CCTV_STEPS} step={story.step} animated={story.animated} onChoose={story.choose} label="How Sentinel works" />
      <div className="mk-sc-features">
        <article><Eye aria-hidden="true" /><h3>Fewer blind spots</h3><p>AI PTZ cameras with a 180-degree overview and 42x zoom can watch a wide area and close in on detail.</p></article>
        <article><Hand aria-hidden="true" /><h3>People stay in charge</h3><p>Sentinel suggests, your staff decide. Nothing happens on its own.</p></article>
        <article><ClipboardList aria-hidden="true" /><h3>One system</h3><p>Alerts, gates, schedules and history all live in the Magic Keys portal you already use.</p></article>
        <article><Wrench aria-hidden="true" /><h3>Your cameras assessed</h3><p>We review the cameras you already have and recommend only what&rsquo;s needed.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Privacy built in</h3><p>Set up to suit your privacy and CCTV policies, with access limited to approved staff.</p></article>
        <article><Users aria-hidden="true" /><h3>Supported locally</h3><p>Installed, tuned and maintained by RJL Commercial, the team behind your gates.</p></article>
      </div>
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
        {/* Scene 1: the AI camera wall spots smoke */}
        <div className={`mk-sc-scene${step === 0 ? " is-active" : ""}`}>
          <img src="/showcase/sentinel-cctv-wall.jpg" alt="" width={1400} height={933} decoding="async" />
          <span className="mk-sc-det is-red is-steady" style={{ left: "57.4%", top: "47.8%", width: "5.6%", height: "5.2%" }}><span>SMOKE?</span></span>
          <div className="mk-sc-screen mk-sc-mon" style={{ left: "2.3%", top: "22.4%", width: "30.4%", height: "39.3%" }}>
            <h4>Live zones</h4>
            <div className="mk-sc-zone"><span><i className="mk-sc-dot" />North gate</span><span>Clear</span></div>
            <div className="mk-sc-zone"><span><i className="mk-sc-dot is-red" />Plant room</span><span>Smoke?</span></div>
            <div className="mk-sc-zone"><span><i className="mk-sc-dot" />Main entry</span><span>Clear</span></div>
          </div>
          <div className="mk-sc-screen mk-sc-mon" style={{ left: "67.1%", top: "22.4%", width: "31%", height: "39.3%" }}>
            <h4>Sentinel camera 07</h4>
            <div className="mk-sc-idle is-alert"><i className="mk-sc-pulse is-red" />Signs of smoke detected<small>Notifying duty staff...</small></div>
          </div>
        </div>

        {/* Scenes 2 and 3: the duty staff prompt, then the confirmation */}
        <div className={`mk-sc-scene${step === 1 || step === 2 ? " is-active" : ""}`}>
          <img src="/showcase/emergency-operations-desk.jpg" alt="" width={1400} height={933} decoding="async" />
          <div className="mk-sc-screen mk-sc-mon" style={{ left: "2.4%", top: "26.4%", width: "30.7%", height: "36.9%" }}>
            <h4>Incident: Zone 3</h4>
            <div className="mk-sc-zone"><span>Plant room</span><span>Rear wall</span></div>
            <div className="mk-sc-zone"><span>Camera 07</span><span>Live view</span></div>
            <div className="mk-sc-zone"><span>Status</span><span>{step === 2 ? "Confirmed" : "Waiting"}</span></div>
          </div>
          <div className="mk-sc-screen mk-sc-mon" style={{ left: "66.3%", top: "26.4%", width: "31.2%", height: "36.7%" }}>
            <h4>Prompt for duty staff</h4>
            {step === 1 && (
              <div className="mk-sc-alert">
                <b>Possible smoke</b>
                Zone 3, plant room. Check the live view, then confirm to start evacuation guidance.
                <div className="mk-sc-acts"><i>Confirm</i><i className="is-grey">Dismiss</i></div>
              </div>
            )}
            {step === 2 && (
              <div className="mk-sc-alert is-done">
                <b>Confirmed by duty staff</b>
                Sending evacuation guidance to classroom screens...
                <div className="mk-sc-send"><i /></div>
              </div>
            )}
          </div>
        </div>

        {/* Scene 4: every classroom projector shows the way out */}
        <div className={`mk-sc-scene${step === 3 ? " is-active" : ""}`}>
          <img src="/showcase/classroom-projector.jpg" alt="" width={1400} height={933} decoding="async" />
          <div className="mk-sc-screen mk-sc-proj" style={{ left: "25.7%", top: "11.8%", width: "49.6%", height: "39.2%" }}>
            <div className="mk-sc-evac-hd"><span>EVACUATE NOW</span><small>Fire reported: Zone 3</small></div>
            <div className="mk-sc-evac-sub">Leave calmly. Follow the green route to Assembly Area A.</div>
            <svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <rect x="8" y="8" width="384" height="154" fill="#f4f7fc" stroke="#9fb0cc" strokeWidth="2" />
              <rect x="20" y="20" width="110" height="60" fill="#fff" stroke="#9fb0cc" /><text x="75" y="55" fontSize="11" textAnchor="middle" fill="#5b6b85">Library</text>
              <rect x="140" y="20" width="110" height="60" fill="#fff" stroke="#9fb0cc" /><text x="228" y="74" fontSize="11" textAnchor="middle" fill="#5b6b85">Room 12</text>
              <rect x="260" y="20" width="120" height="60" fill="#ffe8e6" stroke="#e5373a" /><text x="320" y="55" fontSize="11" textAnchor="middle" fill="#b3261e">Plant room</text>
              <g className="mk-sc-flame"><circle cx="352" cy="36" r="9" fill="#e5373a" /><path d="M352 28c4 5 5 9 0 14-5-5-4-9 0-14z" fill="#ffd166" /></g>
              <rect x="20" y="96" width="230" height="54" fill="#fff" stroke="#9fb0cc" /><text x="135" y="128" fontSize="11" textAnchor="middle" fill="#5b6b85">Room 14</text>
              <circle cx="195" cy="58" r="6" fill="#1463ff" /><text x="195" y="42" fontSize="9" textAnchor="middle" fill="#1463ff" fontWeight="700">YOU ARE HERE</text>
              <path className="mk-sc-route" d="M195 58 V88 H40 V150 H12" />
              <path d="M24 150 l-12 0 m0 0 l6 -6 m-6 6 l6 6" stroke="#19b36b" strokeWidth="4" fill="none" />
              <rect x="268" y="96" width="112" height="54" fill="#fff1f0" stroke="#e5373a" strokeDasharray="4 3" /><text x="324" y="120" fontSize="10" textAnchor="middle" fill="#b3261e" fontWeight="700">Avoid this</text><text x="324" y="134" fontSize="10" textAnchor="middle" fill="#b3261e" fontWeight="700">area</text>
              <text x="14" y="141" fontSize="8" fill="#0b6b3c" fontWeight="700">EXIT</text>
            </svg>
            {/* The lesson slide shows for a moment, then the evacuation screen takes over. */}
            <div className="mk-sc-proj-idle">Lesson in progress</div>
          </div>
        </div>

        <ol className="mk-sc-scene-dots" aria-hidden="true">{GUIDANCE_STEPS.map((item, index) => <li key={item.title} className={index === step ? "is-on" : undefined}>{item.title}</li>)}</ol>
        <span className="mk-sc-tag">EXAMPLE SCREENS</span>
      </div>
      <StageCaption steps={GUIDANCE_STEPS} step={step} />
      <figcaption className="mk-sc-sr">Example: an AI camera spots possible smoke, the duty staff member gets a prompt and confirms it, and every classroom projector then shows an evacuation route away from the danger.</figcaption>
    </figure>
  );
}

function GuidanceShowcase({ name, email, onExplore }: { name?: string; email?: string; onExplore?: () => void }) {
  const story = useStory(GUIDANCE_STEPS.length, 3);
  return (
    <>
      <LockStrip text="Ask RJL Commercial about adding it to your campus." />
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
      <StepRail steps={GUIDANCE_STEPS} step={story.step} animated={story.animated} onChoose={story.choose} label="How Emergency Guidance works" />
      <div className="mk-sc-features">
        <article><MonitorUp aria-hidden="true" /><h3>The screens you already have</h3><p>Classroom projectors and displays become the clearest emergency sign in the room.</p></article>
        <article><Route aria-hidden="true" /><h3>Away from the danger</h3><p>Each room is shown a route that avoids the affected area and leads to the assembly point.</p></article>
        <article><Hand aria-hidden="true" /><h3>A person gives the word</h3><p>Nothing goes to the classrooms until duty staff confirm what the camera saw.</p></article>
        <article><DoorOpen aria-hidden="true" /><h3>Gates follow the plan</h3><p>Magic Keys gates and doors respond the way your agreed emergency plan says they should.</p></article>
        <article><ClipboardList aria-hidden="true" /><h3>Every step logged</h3><p>Alerts, confirmations and messages are recorded for your debrief and drills.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Built around your plan</h3><p>Routes, assembly areas and wording are set up with you and tested on site.</p></article>
      </div>
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
