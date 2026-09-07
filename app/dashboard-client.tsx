"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  Camera,
  CarFront,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  DoorOpen,
  Download,
  Fence,
  FileText,
  Flame,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MoreVertical,
  MonitorUp,
  Network,
  PhoneCall,
  Plus,
  Power,
  Radio,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Smartphone,
  Trash2,
  UnlockKeyhole,
  UserRound,
  UserPlus,
  Users,
  Volume2,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";

type GroupKey = "sports" | "staff" | "front";
type ViewKey = "dashboard" | "gates" | "schedule" | "automation" | "access" | "activity" | "settings";
type GatePosition = "open" | "closed";
type SystemMode = "normal" | "lockdown" | "fire";
type ModuleKey = "mobile" | "video" | "visitor" | "intercom" | "api" | "reporting";
type DayKey = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

type Gate = {
  id: string;
  name: string;
  area: string;
  type: string;
  group: GroupKey;
  defaultPosition: GatePosition;
};

type DayPlan = { enabled: boolean; open: string; close: string };
type WeekPlan = Record<DayKey, DayPlan>;
type ActivityRecord = { id: number; action: string; detail: string; time: string };
type AutomationRule = { id: number; name: string; trigger: string; action: string; enabled: boolean };

type DashboardClientProps = {
  user: { displayName: string; email: string };
  signOutHref?: string;
  onSignOut?: () => void;
};

const groupConfig = {
  sports: { name: "Tom Frizza Sports Area", short: "Sports area", icon: Fence },
  staff: { name: "Staff Car Park", short: "Staff car park", icon: CarFront },
  front: { name: "Front of Property", short: "Front boundary", icon: DoorOpen },
} satisfies Record<GroupKey, { name: string; short: string; icon: typeof Fence }>;

const gates: Gate[] = [
  { id: "TF-ENTRY", name: "Sports Entry Gate", area: "Tom Frizza Sports Area", type: "Automated sliding entry gate", group: "sports", defaultPosition: "open" },
  { id: "TF-EXIT", name: "Sports Exit Gate", area: "Tom Frizza Sports Area", type: "Automated sliding exit gate", group: "sports", defaultPosition: "open" },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `SCP-B${String(index + 1).padStart(2, "0")}`,
    name: `Staff Boom Gate ${String(index + 1).padStart(2, "0")}`,
    area: "Staff Car Park",
    type: "Automated boom gate",
    group: "staff" as const,
    defaultPosition: index < 4 ? "open" as const : "closed" as const,
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    id: `FRONT-DG${String(index + 1).padStart(2, "0")}`,
    name: `Front Double Gates ${String(index + 1).padStart(2, "0")}`,
    area: "Front of Property",
    type: "Automated double-gate set",
    group: "front" as const,
    defaultPosition: "closed" as const,
  })),
];

const days: DayKey[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function makeWeekPlan(gate: Gate): WeekPlan {
  return Object.fromEntries(days.map((day) => {
    const weekday = !["Saturday", "Sunday"].includes(day);
    const saturdaySports = day === "Saturday" && gate.group === "sports";
    return [day, {
      enabled: weekday || saturdaySports,
      open: saturdaySports ? "08:00" : "07:00",
      close: saturdaySports ? "18:00" : gate.group === "front" ? "17:00" : "18:00",
    }];
  })) as WeekPlan;
}

function makeSchedules() {
  return Object.fromEntries(gates.map((gate) => [gate.id, makeWeekPlan(gate)])) as Record<string, WeekPlan>;
}

const viewMeta: Record<ViewKey, { label: string; description: string }> = {
  dashboard: { label: "Dashboard", description: "Live school-wide access overview" },
  gates: { label: "Live gates", description: "Monitor and control all 17 automated access points" },
  schedule: { label: "Gate schedules", description: "Set daily opening and closing times for every gate" },
  automation: { label: "Automation", description: "Build operating rules for schedules, gate events and safety inputs" },
  access: { label: "Access & users", description: "Verified Magic Keys operator identity and permissions" },
  activity: { label: "Activity log", description: "Review commands completed during this signed-in session" },
  settings: { label: "System settings", description: "Configure monitoring, alerts and operating behaviour" },
};

const platformModules = [
  { key: "mobile", name: "Magic Keys mobile credentials", description: "Verified operator access and remote gate commands", icon: Smartphone, core: true },
  { key: "video", name: "Camera event verification", description: "Associate gate activity with camera snapshots and recordings", icon: Camera },
  { key: "visitor", name: "Visitor and contractor access", description: "Issue time-limited permissions with approval and expiry", icon: UserPlus },
  { key: "intercom", name: "Intercom and communications", description: "Connect gate calls, operator responses and broadcast notices", icon: Radio },
  { key: "api", name: "API and building systems", description: "Link alarms, facilities platforms and approved automations", icon: Network },
  { key: "reporting", name: "Compliance reporting", description: "Export events, operator actions and scheduled access changes", icon: FileText },
] satisfies Array<{ key: ModuleKey; name: string; description: string; icon: typeof Fence; core?: boolean }>;

const initialAutomations: AutomationRule[] = [
  { id: 1, name: "School-day opening", trigger: "Weekdays at 07:00", action: "Open scheduled staff and sports gates", enabled: true },
  { id: 2, name: "After-hours secure", trigger: "Daily at 18:05", action: "Close and secure all access points", enabled: true },
  { id: 3, name: "Extended-open alert", trigger: "Gate open for more than 15 minutes", action: "Notify authorised operators", enabled: true },
];

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function findAustralianMaleVoice(voices: SpeechSynthesisVoice[]) {
  const soundsMale = /(william|gordon|lee|jack|james|russell|daniel|oliver|thomas|noah|liam|henry|ethan|male|neural2[- ]?[bd]|wavenet[- ]?[bd]|standard[- ]?[bd])/i;
  return voices.find((voice) => /^en[-_]AU$/i.test(voice.lang) && soundsMale.test(`${voice.name} ${voice.voiceURI}`))
    ?? voices.find((voice) => /^en/i.test(voice.lang) && soundsMale.test(`${voice.name} ${voice.voiceURI}`))
    ?? voices.find((voice) => /^en[-_]AU$/i.test(voice.lang));
}

function timeToPercent(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return ((hours * 60 + minutes) / (24 * 60)) * 100;
}

function GateIcon({ gate, position }: { gate: Gate; position: GatePosition }) {
  if (gate.group === "sports") {
    const open = position === "open";
    return (
      <span className={`access-icon single-gate-visual is-${position}`} aria-hidden="true">
        <img
          key={`${gate.id}-${position}`}
          className="single-gate-image"
          src={open ? "/single-gate-open-transparent.png" : "/single-gate-closed-transparent.png"}
          alt=""
        />
      </span>
    );
  }
  if (gate.group === "front") {
    return (
      <span className={`access-icon double-gate-visual is-${position}`} aria-hidden="true">
        <img className="double-gate-image" src="/double-gate-icon.png" alt="" />
      </span>
    );
  }
  return (
    <span className={`access-icon boom-gate-visual is-${position}`} aria-hidden="true">
      <span className="boom-gate-base"><i /></span>
      <span className="boom-gate-arm"><i /></span>
      <span className="boom-gate-rest" />
    </span>
  );
}

function SafetyCommand({ mode, active, onConfirm }: { mode: "lockdown" | "fire"; active: boolean; onConfirm: () => void }) {
  const lockdown = mode === "lockdown";
  const Icon = lockdown ? ShieldAlert : Flame;
  return (
    <button
      className={`safety-command ${mode}`}
      aria-label={lockdown ? "Activate emergency lockdown" : "Activate fire evacuation mode"}
      aria-pressed={active}
      onClick={onConfirm}
    >
      <span className="safety-command-icon"><Icon /></span>
      <span>
        <strong>{lockdown ? "LOCKDOWN · CLOSE ALL" : "FIRE ALARM · EVACUATE"}</strong>
        <em>{active ? "Active now" : lockdown ? "Secure every automated gate" : "Open gates and publish projector notice"}</em>
      </span>
    </button>
  );
}

function EmergencyAlertPanel({ mode, onClear }: { mode: Exclude<SystemMode, "normal">; onClear: () => void }) {
  const fire = mode === "fire";
  const Icon = fire ? Flame : ShieldAlert;
  return (
    <section className={`emergency-alert-panel ${mode}`} role="alert" aria-live="assertive" aria-atomic="true">
      <header>
        <span className="emergency-alert-icon"><Icon /></span>
        <span><small>Priority mode active</small><strong>{fire ? "Fire alarm · all gates opening" : "Lockdown · all gates closing"}</strong></span>
        <i className="emergency-alert-pulse" />
      </header>
      <div className="emergency-alert-state">
        <span><Siren /><span><strong>Sirens and horns active</strong><small>Campus outputs synchronised</small></span></span>
        <span><Zap /><span><strong>17 gate controllers</strong><small>{fire ? "Opening together" : "Closing together"}</small></span></span>
        {fire && <span><MonitorUp /><span><strong>Projector information active</strong><small>Evacuation notice broadcasting</small></span></span>}
      </div>
      <p>{fire ? "Evacuate by the nearest safe exit and follow the school emergency plan." : "Move inside, secure the area and await an authorised all-clear."}</p>
      <footer>
        {fire && <a href="tel:000"><PhoneCall /> Triple Zero (000)</a>}
        <Button variant="outline" onClick={onClear}><RotateCcw /> Authorised all-clear</Button>
      </footer>
    </section>
  );
}

export default function DashboardClient({ user, signOutHref = "/", onSignOut }: DashboardClientProps) {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [systemMode, setSystemMode] = useState<SystemMode>("normal");
  const [gateOverrides, setGateOverrides] = useState<Record<string, GatePosition>>({});
  const [selectedGate, setSelectedGate] = useState<Gate | null>(null);
  const [selectedScheduleGateId, setSelectedScheduleGateId] = useState(gates[0].id);
  const [schedules, setSchedules] = useState<Record<string, WeekPlan>>(makeSchedules);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [positionMonitoring, setPositionMonitoring] = useState(true);
  const [faultAlerts, setFaultAlerts] = useState(true);
  const [voiceAnnouncements, setVoiceAnnouncements] = useState(true);
  const [gateQuery, setGateQuery] = useState("");
  const [gateGroup, setGateGroup] = useState<"all" | GroupKey>("all");
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey>>(() => new Set(["mobile"]));
  const [automations, setAutomations] = useState<AutomationRule[]>(initialAutomations);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState("At a scheduled time");
  const [automationAction, setAutomationAction] = useState("Notify authorised operators");
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const voiceModeRef = useRef<"browser" | "recorded" | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const prepareAustralianMaleVoice = () => {
      if (voiceModeRef.current === "recorded") return;
      const voice = findAustralianMaleVoice(window.speechSynthesis.getVoices());
      if (voice) selectedVoiceRef.current = voice;
    };
    prepareAustralianMaleVoice();
    window.speechSynthesis.addEventListener("voiceschanged", prepareAustralianMaleVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", prepareAustralianMaleVoice);
  }, []);

  useEffect(() => {
    if (systemMode === "normal" || typeof window === "undefined") return;

    const speakWarning = () => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const voice = selectedVoiceRef.current
        ?? findAustralianMaleVoice(synth.getVoices());
      if (voice) selectedVoiceRef.current = voice;

      const message = systemMode === "lockdown"
        ? "Warning. Lockdown active. All automation is closing."
        : "Warning. Fire alarm active. All automation is opening. Evacuate now.";
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-AU";
      utterance.rate = 0.84;
      utterance.pitch = 0.7;
      utterance.volume = 1;
      if (voice) utterance.voice = voice;
      synth.cancel();
      synth.speak(utterance);
    };

    speakWarning();
    const warningTimer = window.setInterval(speakWarning, 6500);

    return () => {
      window.clearInterval(warningTimer);
      window.speechSynthesis?.cancel();
    };
  }, [systemMode]);

  const selectedScheduleGate = gates.find((gate) => gate.id === selectedScheduleGateId) ?? gates[0];
  const selectedWeek = schedules[selectedScheduleGate.id];

  function getPosition(gate: Gate): GatePosition {
    if (systemMode === "lockdown") return "closed";
    if (systemMode === "fire") return "open";
    return gateOverrides[gate.id] ?? gate.defaultPosition;
  }

  const openCount = gates.filter((gate) => getPosition(gate) === "open").length;
  const closedCount = gates.length - openCount;

  const groupSummary = (Object.keys(groupConfig) as GroupKey[]).map((group) => {
    const groupGates = gates.filter((gate) => gate.group === group);
    return { group, total: groupGates.length, open: groupGates.filter((gate) => getPosition(gate) === "open").length };
  });

  const filteredGates = useMemo(() => {
    const query = gateQuery.trim().toLowerCase();
    return gates.filter((gate) => {
      const matchesGroup = gateGroup === "all" || gate.group === gateGroup;
      const matchesQuery = !query || `${gate.name} ${gate.area} ${gate.id} ${gate.type}`.toLowerCase().includes(query);
      return matchesGroup && matchesQuery;
    });
  }, [gateGroup, gateQuery]);

  function addActivity(action: string, detail: string) {
    const time = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Australia/Melbourne" }).format(new Date());
    setActivity((current) => [{ id: Date.now(), action, detail, time }, ...current]);
  }

  function announceGateState(position: GatePosition) {
    if (!voiceAnnouncements || typeof window === "undefined") return;
    const preparedVoice = selectedVoiceRef.current
      ?? ("speechSynthesis" in window ? findAustralianMaleVoice(window.speechSynthesis.getVoices()) : null);

    if (!voiceModeRef.current) voiceModeRef.current = preparedVoice ? "browser" : "recorded";

    if (voiceModeRef.current === "recorded" || !("speechSynthesis" in window)) {
      fallbackAudioRef.current?.pause();
      const audio = new Audio(position === "open" ? "/gate-open-male.mp3" : "/gate-closed-male.mp3");
      fallbackAudioRef.current = audio;
      void audio.play().catch(() => undefined);
      return;
    }

    const synth = window.speechSynthesis;
    const voice = preparedVoice;
    if (voice) selectedVoiceRef.current = voice;
    const utterance = new SpeechSynthesisUtterance(position === "open" ? "Gate open." : "Gate closed.");
    utterance.lang = "en-AU";
    utterance.rate = 0.88;
    utterance.pitch = 0.72;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  }

  function announceAllClear() {
    if (!voiceAnnouncements || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const voice = selectedVoiceRef.current ?? findAustralianMaleVoice(synth.getVoices());
    if (voice) selectedVoiceRef.current = voice;
    const utterance = new SpeechSynthesisUtterance("All clear. Emergency ended. Systems have returned to normal operation.");
    utterance.lang = "en-AU";
    utterance.rate = 0.86;
    utterance.pitch = 0.7;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  }

  function activateEmergency(mode: "lockdown" | "fire") {
    setSystemMode(mode);
    const emergencyPosition: GatePosition = mode === "fire" ? "open" : "closed";
    setGateOverrides(Object.fromEntries(gates.map((gate) => [gate.id, emergencyPosition])));
    setActiveView("gates");
    const label = mode === "lockdown" ? "Emergency lockdown activated" : "Fire / evacuation mode activated";
    addActivity(label, `${user.displayName} applied the command to all 17 automated gates, campus sirens and gate horns.`);
    toast.warning(label, { description: "All simulated gates, sirens, horns and automation controls are in emergency mode." });
  }

  function clearEmergency() {
    const previous = systemMode;
    setSystemMode("normal");
    addActivity("Emergency mode cleared", `${user.displayName} returned the system from ${previous} to normal operation.`);
    toast.success("All clear · Normal operation restored");
    if (typeof window !== "undefined") window.setTimeout(announceAllClear, 120);
  }

  function setGatePosition(gate: Gate, position: GatePosition) {
    if (systemMode !== "normal") return;
    setGateOverrides((current) => ({ ...current, [gate.id]: position }));
    addActivity(`${gate.name} ${position}`, `${user.displayName} used a manual simulation command.`);
    toast.success(`${gate.name} set to ${position}`);
    announceGateState(position);
  }

  function updateDay(day: DayKey, patch: Partial<DayPlan>) {
    setSchedules((current) => ({
      ...current,
      [selectedScheduleGate.id]: {
        ...current[selectedScheduleGate.id],
        [day]: { ...current[selectedScheduleGate.id][day], ...patch },
      },
    }));
    setScheduleDirty(true);
  }

  function copyMondayToWeekdays() {
    const monday = selectedWeek.Monday;
    setSchedules((current) => {
      const nextWeek = { ...current[selectedScheduleGate.id] };
      (["Tuesday", "Wednesday", "Thursday", "Friday"] as DayKey[]).forEach((day) => { nextWeek[day] = { ...monday }; });
      return { ...current, [selectedScheduleGate.id]: nextWeek };
    });
    setScheduleDirty(true);
    toast.success("Monday copied to Tuesday–Friday");
  }

  function saveSchedule() {
    setScheduleDirty(false);
    addActivity("Gate schedule updated", `${user.displayName} saved the weekly schedule for ${selectedScheduleGate.name}.`);
    toast.success("Schedule saved", { description: `${selectedScheduleGate.name} has been updated in this simulation.` });
  }

  function toggleModule(module: (typeof platformModules)[number]) {
    if (module.core) return;
    const enabling = !enabledModules.has(module.key);
    setEnabledModules((current) => {
      const next = new Set(current);
      if (enabling) next.add(module.key); else next.delete(module.key);
      return next;
    });
    const action = enabling ? "added to" : "removed from";
    addActivity(`${module.name} ${enabling ? "enabled" : "disabled"}`, `${user.displayName} ${action} the demonstration configuration.`);
    toast.success(`${module.name} ${enabling ? "added" : "removed"}`, { description: "Demonstration configuration updated." });
  }

  function exportActivity() {
    if (!activity.length) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = ["Time,Action,Detail", ...activity.map((record) => [record.time, record.action, record.detail].map(escape).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "balwyn-gate-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Activity log exported");
  }

  function addAutomation() {
    const name = automationName.trim();
    if (!name) {
      toast.error("Name the automation rule", { description: "Add a clear name before creating this demonstration rule." });
      return;
    }
    const next: AutomationRule = { id: Date.now(), name, trigger: automationTrigger, action: automationAction, enabled: true };
    setAutomations((current) => [...current, next]);
    setAutomationName("");
    addActivity("Automation rule added", `${user.displayName} created “${name}” in the demonstration configuration.`);
    toast.success("Automation rule added", { description: name });
  }

  function toggleAutomation(id: number, enabled: boolean) {
    const rule = automations.find((candidate) => candidate.id === id);
    setAutomations((current) => current.map((candidate) => candidate.id === id ? { ...candidate, enabled } : candidate));
    if (rule) addActivity(`Automation ${enabled ? "enabled" : "paused"}`, `${user.displayName} updated “${rule.name}”.`);
  }

  function deleteAutomation(id: number) {
    const rule = automations.find((candidate) => candidate.id === id);
    setAutomations((current) => current.filter((candidate) => candidate.id !== id));
    if (rule) {
      addActivity("Automation rule removed", `${user.displayName} removed “${rule.name}” from the demonstration configuration.`);
      toast.success("Automation rule removed");
    }
  }

  function navItem(view: ViewKey, Icon: typeof LayoutDashboard, badge?: string) {
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton className="portal-nav-button" isActive={activeView === view} tooltip={viewMeta[view].label} onClick={() => setActiveView(view)}>
          <Icon /><span>{viewMeta[view].label}</span>
        </SidebarMenuButton>
        {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
      </SidebarMenuItem>
    );
  }

  function renderGateCards(list: Gate[]) {
    return (
      <div className="access-grid">
        {list.map((gate) => {
          const position = getPosition(gate);
          return (
            <button className={`access-card ${positionMonitoring ? "" : "is-monitoring-paused"}`} key={gate.id} aria-label={`View controls for ${gate.name}`} aria-haspopup="dialog" onClick={() => setSelectedGate(gate)}>
              <span className="access-card-heading"><span><strong>{gate.name}</strong><small>{gate.area}</small></span><MoreVertical aria-hidden="true" /></span>
              <GateIcon gate={gate} position={position} />
              <span className="access-card-footer"><span className={`position-label ${positionMonitoring ? `is-${position}` : "is-unknown"}`}><i />{positionMonitoring ? position === "open" ? "Open / unlocked" : "Closed / secured" : "Monitoring paused"}</span><span>{gate.id}</span></span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <SidebarProvider className={`control-portal mode-${systemMode}`} style={{ "--sidebar-width": "17.5rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas" className="control-sidebar">
        <SidebarHeader className="portal-sidebar-header"><div className="school-sidebar-logo"><img src="/balwyn-watermark.png" alt="Balwyn High School crest" /></div><div><strong>BALWYN HIGH</strong><span>Magic Keys · RJL</span></div></SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup><SidebarGroupLabel>Operations</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{navItem("dashboard", LayoutDashboard)}{navItem("gates", DoorOpen, "17")}{navItem("schedule", CalendarDays)}{navItem("automation", Workflow, String(automations.filter((rule) => rule.enabled).length))}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <SidebarGroup><SidebarGroupLabel>Administration</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{navItem("access", Users)}{navItem("activity", ClipboardList, activity.length ? String(activity.length) : undefined)}{navItem("settings", Settings2)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <div className="sidebar-system-card"><span><Wifi /> System connection</span><strong><i /> Secure terminal online</strong><small>Balwyn High School · Live simulation</small><small className="voice-status"><Volume2 /> Gate voice · {voiceAnnouncements ? "On" : "Off"}</small></div>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="operator-footer"><Avatar size="lg"><AvatarImage src="/operator-avatar.webp" alt="Paul Sutton operator profile" /><AvatarFallback>{initials(user.displayName)}</AvatarFallback><AvatarBadge /></Avatar><div className="operator-footer-copy"><strong>{user.displayName}</strong><span>{user.email}</span><small>Authorised operator</small></div>{onSignOut ? <button type="button" className="operator-sign-out" onClick={onSignOut} aria-label="Sign out of Magic Keys"><LogOut /></button> : <a href={signOutHref} target="_top" aria-label="Sign out of Magic Keys"><LogOut /></a>}</SidebarFooter>
      </Sidebar>

      <SidebarInset className="portal-workspace">
        <header className="workspace-header">
          <div className="workspace-location"><SidebarTrigger className="sidebar-toggle" /><span className="location-logo"><img src="/balwyn-watermark.png" alt="" /></span><div><small>Managed site</small><strong>Balwyn High School</strong></div></div>
          <div className="workspace-header-right"><span className="connection-pill"><i /> Encrypted connection</span><button className="notification-button" aria-label="View system alerts" onClick={() => toast.info("No active system alerts", { description: "All 17 access points are reporting normally in this simulation." })}><Bell /></button><div className="header-operator"><Avatar><AvatarImage src="/operator-avatar.webp" alt="Professional operator avatar placeholder" /><AvatarFallback>{initials(user.displayName)}</AvatarFallback><AvatarBadge /></Avatar><span><strong>{user.displayName}</strong><small>Verified Magic Keys operator</small></span></div></div>
        </header>

        <section className="safety-bar" aria-label="Emergency gate commands">
          <div className="safety-bar-label"><ShieldAlert /><span><strong>Emergency operations</strong><small>Priority controls</small></span></div>
          <div className="safety-command-grid"><SafetyCommand mode="lockdown" active={systemMode === "lockdown"} onConfirm={() => activateEmergency("lockdown")} /><SafetyCommand mode="fire" active={systemMode === "fire"} onConfirm={() => activateEmergency("fire")} /></div>
          <div className="command-safety-note"><Radio /> Demonstration controls only</div>
        </section>

        {systemMode !== "normal" && <EmergencyAlertPanel mode={systemMode} onClear={clearEmergency} />}

        <div className="workspace-content">
          <div className="workspace-title-row"><div><h1>{viewMeta[activeView].label}</h1><span>{viewMeta[activeView].description}</span></div><Badge variant="outline" className="concept-badge"><ShieldCheck /> Operational simulation</Badge></div>

          {activeView === "dashboard" && (
            <>
              <section className="health-strip" aria-label="Demonstration platform health">
                <div className="health-lead"><span className="health-pulse"><i /></span><span><strong>Platform ready</strong><small>All simulated services available</small></span></div>
                <div><Network /><span><strong>17 / 17</strong><small>Controllers responding</small></span></div>
                <div><ShieldCheck /><span><strong>Ready</strong><small>Safety inputs</small></span></div>
                <div><Workflow /><span><strong>{automations.filter((rule) => rule.enabled).length} active</strong><small>Automation rules</small></span></div>
                <div><ClipboardList /><span><strong>Logging</strong><small>Operator audit trail</small></span></div>
              </section>
              <section className="summary-grid">
                <article className="summary-card primary-summary"><span>Total access points</span><strong>17</strong><small>Across three controlled areas</small></article>
                <article className="summary-card"><span>Open now</span><strong className="open-number">{positionMonitoring ? openCount : "—"}</strong><small>{positionMonitoring ? "Unlocked or held open" : "Position monitoring paused"}</small></article>
                <article className="summary-card"><span>Secured now</span><strong>{positionMonitoring ? closedCount : "—"}</strong><small>{positionMonitoring ? "Closed and access controlled" : "Position monitoring paused"}</small></article>
                <article className="summary-card"><span>System state</span><strong className={`mode-word ${systemMode}`}>{systemMode === "normal" ? "Normal" : systemMode === "fire" ? "Fire" : "Lockdown"}</strong><small>{systemMode === "normal" ? "Schedules and credentials active" : "Priority command overrides active"}</small></article>
              </section>
              <section className="dashboard-panels">
                <article className="panel area-panel"><div className="panel-heading"><div><h2>Controlled areas</h2><small>Estate status</small></div><Button variant="ghost" onClick={() => setActiveView("gates")}>View all gates <ChevronRight /></Button></div><div className="area-list">{groupSummary.map(({ group, total, open }) => { const sampleGate = gates.find((gate) => gate.group === group) ?? gates[0]; return <button key={group} onClick={() => setActiveView("gates")}><span className="area-icon"><GateIcon gate={sampleGate} position={getPosition(sampleGate)} /></span><span><strong>{groupConfig[group].name}</strong><small>{total} automated access points</small></span><span className="area-state"><strong>{positionMonitoring ? `${open} open` : "Paused"}</strong><small>{positionMonitoring ? `${total - open} secured` : "Monitoring"}</small></span><ChevronRight /></button>; })}</div></article>
                <article className="panel next-schedule-panel"><div className="panel-heading"><div><h2>Schedule</h2><small>Today · operating plan</small></div><CalendarDays /></div><div className="schedule-highlight"><Clock3 /><div><strong>07:00 — 18:00</strong><small>Weekday access window</small><span>Individual times can be set per gate</span></div></div><Button className="schedule-button" onClick={() => setActiveView("schedule")}>Manage gate schedules <ChevronRight /></Button></article>
              </section>
              <section className="quick-gates-section"><div className="section-heading"><div><h2>Gate controls</h2><small>Quick access</small></div><span>Select a gate to view its status and controls.</span></div>{renderGateCards(gates.slice(0, 6))}</section>
            </>
          )}

          {activeView === "gates" && (
            <section className="view-panel">
              <div className="view-panel-heading"><div><h2>All automated gates</h2><small>{filteredGates.length} of 17 access points shown</small></div><div className="status-legend"><span className="is-open"><i /> Open / unlocked</span><span className="is-closed"><i /> Closed / secured</span></div></div>
              <div className="gate-toolbar">
                <label className="gate-search"><Search aria-hidden="true" /><span className="sr-only">Search gates</span><Input value={gateQuery} onChange={(event) => setGateQuery(event.target.value)} placeholder="Search by gate, area or asset ID" /></label>
                <label><span className="sr-only">Filter gates by area</span><NativeSelect value={gateGroup} onChange={(event) => setGateGroup(event.target.value as "all" | GroupKey)}><NativeSelectOption value="all">All controlled areas</NativeSelectOption>{(Object.keys(groupConfig) as GroupKey[]).map((group) => <NativeSelectOption key={group} value={group}>{groupConfig[group].name}</NativeSelectOption>)}</NativeSelect></label>
              </div>
              {filteredGates.length ? renderGateCards(filteredGates) : <div className="gate-empty"><Search /><h3>No gates match this search</h3><p>Clear the search or choose another controlled area.</p><Button variant="outline" onClick={() => { setGateQuery(""); setGateGroup("all"); }}>Clear filters</Button></div>}
            </section>
          )}

          {activeView === "schedule" && (
            <section className="schedule-workspace">
              <div className="schedule-toolbar"><div><label htmlFor="schedule-gate">Select gate</label><NativeSelect id="schedule-gate" value={selectedScheduleGate.id} onChange={(event) => { setSelectedScheduleGateId(event.target.value); setScheduleDirty(false); }} className="gate-select">{gates.map((gate) => <NativeSelectOption key={gate.id} value={gate.id}>{gate.name} · {gate.area}</NativeSelectOption>)}</NativeSelect></div><div className="schedule-toolbar-actions"><Button variant="outline" onClick={copyMondayToWeekdays}><Copy /> Copy Monday to weekdays</Button><Button onClick={saveSchedule} disabled={!scheduleDirty}><Save /> {scheduleDirty ? "Save schedule" : "Schedule saved"}</Button></div></div>
              <div className="schedule-context"><span><GateIcon gate={selectedScheduleGate} position={getPosition(selectedScheduleGate)} /></span><div><h2>{selectedScheduleGate.name}</h2><small>{selectedScheduleGate.area} · {selectedScheduleGate.id}</small><p>{selectedScheduleGate.type}</p></div><div className="timezone-card"><Clock3 /><span><strong>Australia / Melbourne</strong><small>Schedule timezone</small></span></div></div>
              <div className="schedule-graph" aria-label={`${selectedScheduleGate.name} weekly schedule timeline`}>
                <div className="schedule-graph-heading"><div><h3>Weekly operating timeline</h3><p>Scheduled open periods across a full 24-hour day</p></div><span className="timeline-legend"><i /> Open and accessible</span></div>
                <div className="timeline-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
                <div className="timeline-days">
                  {days.map((day) => { const plan = selectedWeek[day]; const width = Math.max(0, timeToPercent(plan.close) - timeToPercent(plan.open)); return <div className={`timeline-day ${plan.enabled ? "is-enabled" : ""}`} key={day}><strong>{day.slice(0, 3)}</strong><div className="timeline-track">{plan.enabled ? <span className="timeline-bar" style={{ left: `${timeToPercent(plan.open)}%`, width: `${width}%` }}><em>{plan.open}–{plan.close}</em></span> : <span className="timeline-closed">Secured all day</span>}</div></div>; })}
                </div>
              </div>
              <div className="week-schedule" role="table" aria-label={`${selectedScheduleGate.name} weekly schedule`}>
                <div className="week-row week-head" role="row"><span>Day</span><span>Automatic schedule</span><span>Open time</span><span>Close time</span><span>Daily result</span></div>
                {days.map((day) => { const plan = selectedWeek[day]; return <div className={`week-row ${plan.enabled ? "is-enabled" : ""}`} role="row" key={day}><strong>{day}</strong><label className="schedule-switch"><Switch checked={plan.enabled} onCheckedChange={(enabled) => updateDay(day, { enabled })} /><span>{plan.enabled ? "Enabled" : "Closed all day"}</span></label><label><span className="sr-only">{day} open time</span><Input type="time" value={plan.open} disabled={!plan.enabled} onChange={(event) => updateDay(day, { open: event.target.value })} /></label><label><span className="sr-only">{day} close time</span><Input type="time" value={plan.close} disabled={!plan.enabled} onChange={(event) => updateDay(day, { close: event.target.value })} /></label><span className="daily-result">{plan.enabled ? <><CheckCircle2 /> Open {plan.open}–{plan.close}</> : <><LockKeyhole /> Remains secured</>}</span></div>; })}
              </div>
              <p className="schedule-footnote"><AlertTriangle /> Emergency lockdown and fire / evacuation commands override every normal weekly schedule.</p>
            </section>
          )}

          {activeView === "automation" && (
            <section className="automation-workspace">
              <article className="automation-builder">
                <div className="panel-heading"><div><h2>Build a rule</h2><small>Demonstration configuration</small></div><Zap /></div>
                <div className="automation-form">
                  <label><span>Rule name</span><Input value={automationName} onChange={(event) => setAutomationName(event.target.value)} placeholder="e.g. Weekend sports access" onKeyDown={(event) => event.key === "Enter" && addAutomation()} /></label>
                  <label><span>When this happens</span><NativeSelect value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value)}><NativeSelectOption value="At a scheduled time">At a scheduled time</NativeSelectOption><NativeSelectOption value="A gate remains open too long">A gate remains open too long</NativeSelectOption><NativeSelectOption value="A controller goes offline">A controller goes offline</NativeSelectOption><NativeSelectOption value="An approved safety input activates">An approved safety input activates</NativeSelectOption></NativeSelect></label>
                  <span className="automation-flow" aria-hidden="true"><Workflow /><i /><ChevronRight /></span>
                  <label><span>Then perform</span><NativeSelect value={automationAction} onChange={(event) => setAutomationAction(event.target.value)}><NativeSelectOption value="Notify authorised operators">Notify authorised operators</NativeSelectOption><NativeSelectOption value="Open scheduled gates">Open scheduled gates</NativeSelectOption><NativeSelectOption value="Close and secure all gates">Close and secure all gates</NativeSelectOption><NativeSelectOption value="Run the configured safety response">Run the configured safety response</NativeSelectOption></NativeSelect></label>
                  <Button onClick={addAutomation}><Plus /> Add automation rule</Button>
                </div>
                <p className="automation-note"><ShieldCheck /> Emergency commands always take priority over standard automation rules.</p>
              </article>

              <article className="automation-rules">
                <div className="view-panel-heading"><div><h2>Active rules</h2><small>{automations.filter((rule) => rule.enabled).length} enabled · {automations.length} configured</small></div><Badge variant="outline"><Workflow /> Rule engine</Badge></div>
                <div className="rule-list">
                  {automations.map((rule) => <div className={`rule-row ${rule.enabled ? "is-enabled" : ""}`} key={rule.id}><span className="rule-icon"><Zap /></span><div className="rule-copy"><strong>{rule.name}</strong><span><em>IF</em> {rule.trigger}</span><span><em>THEN</em> {rule.action}</span></div><div className="rule-state"><small>{rule.enabled ? "Enabled" : "Paused"}</small><Switch checked={rule.enabled} onCheckedChange={(enabled) => toggleAutomation(rule.id, enabled)} /></div><button className="rule-delete" aria-label={`Delete ${rule.name}`} onClick={() => deleteAutomation(rule.id)}><Trash2 /></button></div>)}
                </div>
              </article>
            </section>
          )}

          {activeView === "access" && <section className="identity-layout"><article className="identity-card"><div className="identity-card-head"><span><KeyRound /></span><div><h2>Signed-in operator</h2><small>Magic Keys verified identity</small></div></div><div className="identity-profile"><Avatar size="lg"><AvatarImage src="/operator-avatar.webp" alt="Professional operator avatar placeholder" /><AvatarFallback>{initials(user.displayName)}</AvatarFallback><AvatarBadge /></Avatar><div><strong>{user.displayName}</strong><span>{user.email}</span></div><Badge><ShieldCheck /> Authenticated</Badge></div><div className="identity-rows"><div><span>Access role</span><strong>Authorised operator</strong></div><div><span>Managed site</span><strong>Balwyn High School</strong></div><div><span>Identity provider</span><strong>Verified ChatGPT account</strong></div><div><span>Profile image</span><strong>Professional placeholder</strong></div><div><span>Session security</span><strong>Encrypted and signed in</strong></div></div></article><article className="permissions-card"><div className="panel-heading"><div><h2>Operator permissions</h2><small>Current session</small></div><ShieldCheck /></div><div className="permission-list"><span><CheckCircle2 /> View every gate state</span><span><CheckCircle2 /> Operate authorised gate controls</span><span><CheckCircle2 /> Manage weekly schedules</span><span><CheckCircle2 /> Activate emergency commands</span><span><CheckCircle2 /> Review session activity</span></div><p>Final roles and gate-specific permissions would be agreed with the school during commissioning.</p></article></section>}

          {activeView === "activity" && <section className="activity-panel"><div className="view-panel-heading"><div><h2>Current session activity</h2><small>Authenticated audit trail</small></div><div className="activity-heading-actions"><Badge variant="outline"><UserRound /> {user.displayName}</Badge><Button variant="outline" disabled={!activity.length} onClick={exportActivity}><Download /> Export CSV</Button></div></div>{activity.length === 0 ? <div className="activity-empty"><Activity /><h3>No commands recorded yet</h3><p>Emergency commands, manual gate changes, automation changes and schedule saves completed during this signed-in session will appear here.</p></div> : <div className="activity-list">{activity.map((record) => <article key={record.id}><span className="activity-record-icon"><Activity /></span><div><strong>{record.action}</strong><p>{record.detail}</p></div><time>{record.time}</time></article>)}</div>}</section>}

          {activeView === "settings" && (
            <>
              <section className="settings-layout"><article className="settings-card"><div className="panel-heading"><div><h2>Monitoring</h2><small>System behaviour</small></div><Gauge /></div><label><span><strong>Gate-position monitoring</strong><small>Display live open and closed states</small></span><Switch checked={positionMonitoring} onCheckedChange={setPositionMonitoring} /></label><label><span><strong>Fault and offline alerts</strong><small>Notify authorised administrators</small></span><Switch checked={faultAlerts} onCheckedChange={setFaultAlerts} /></label><label><span><strong>Australian male gate voice</strong><small>Speak once for manual commands; emergency warnings repeat until all-clear</small></span><Switch checked={voiceAnnouncements} onCheckedChange={setVoiceAnnouncements} /></label></article><article className="settings-card"><div className="panel-heading"><div><h2>Magic Keys</h2><small>System information</small></div><Power /></div><div className="setting-info"><div><span>Managed site</span><strong>Balwyn High School</strong></div><div><span>Proposed access points</span><strong>17</strong></div><div><span>Connection</span><strong className="online-text"><i /> Secure terminal online</strong></div><div><span>Voice profile</span><strong>Australian male · Repeating emergency warning</strong></div><div><span>Emergency alerts</span><strong>Non-blocking operator panel</strong></div><div><span>Emergency integration</span><strong>Subject to approved final design</strong></div></div></article></section>
              <section className="module-marketplace">
                <div className="module-heading"><div><h2>Platform modules</h2><p>Add capabilities as the school’s operational requirements expand.</p></div><Badge variant="outline">{enabledModules.size} of {platformModules.length} configured</Badge></div>
                <div className="module-list">{platformModules.map((module) => { const Icon = module.icon; const enabled = enabledModules.has(module.key); return <article className={`module-row ${enabled ? "is-enabled" : ""}`} key={module.key}><span className="module-icon"><Icon /></span><div><strong>{module.name}</strong><p>{module.description}</p></div><span className="module-status"><i />{module.core ? "Core service" : enabled ? "Added to concept" : "Available"}</span><Button variant={enabled ? "outline" : "default"} disabled={module.core} onClick={() => toggleModule(module)}>{module.core ? "Active" : enabled ? "Remove" : "Add module"}</Button></article>; })}</div>
                <p className="module-disclaimer">Modules shown are concept options. Final integrations, licensing and hardware compatibility are confirmed during detailed design.</p>
              </section>
            </>
          )}
        </div>
      </SidebarInset>

      <Sheet open={Boolean(selectedGate)} onOpenChange={(open) => !open && setSelectedGate(null)}>
        <SheetContent className="gate-sheet sm:max-w-[500px]">
          {selectedGate && <><SheetHeader className="gate-sheet-header"><SheetTitle>{selectedGate.name}</SheetTitle><SheetDescription>{selectedGate.type}</SheetDescription><span className="sheet-overline">{selectedGate.area} · {selectedGate.id}</span></SheetHeader><Tabs defaultValue="control" className="gate-tabs"><TabsList variant="line" className="gate-tabs-list"><TabsTrigger value="control">Control</TabsTrigger><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList><TabsContent value="control" className="sheet-tab-content"><div className="sheet-gate-visual"><GateIcon gate={selectedGate} position={getPosition(selectedGate)} /><strong>{positionMonitoring ? getPosition(selectedGate) === "open" ? "Open / unlocked" : "Closed / secured" : "Position monitoring paused"}</strong><span>{systemMode === "normal" ? "Normal operating control" : "Emergency priority mode overrides manual controls"}</span></div><div className="sheet-actions"><Button className="open-gate-command" onClick={() => setGatePosition(selectedGate, "open")} disabled={systemMode !== "normal"}><UnlockKeyhole /> Open gate</Button><Button variant="outline" onClick={() => setGatePosition(selectedGate, "closed")} disabled={systemMode !== "normal"}><LockKeyhole /> Close gate</Button></div></TabsContent><TabsContent value="schedule" className="sheet-tab-content"><div className="sheet-schedule-summary"><CalendarDays /><h3>Weekly operating schedule</h3><p>{Object.values(schedules[selectedGate.id]).filter((plan) => plan.enabled).length} scheduled days are enabled for this gate.</p><Button onClick={() => { setSelectedScheduleGateId(selectedGate.id); setSelectedGate(null); setActiveView("schedule"); }}>Edit full schedule <ChevronRight /></Button></div></TabsContent><TabsContent value="details" className="sheet-tab-content"><div className="identity-rows"><div><span>Asset ID</span><strong>{selectedGate.id}</strong></div><div><span>Controlled area</span><strong>{selectedGate.area}</strong></div><div><span>Gate type</span><strong>{selectedGate.type}</strong></div><div><span>Position monitoring</span><strong>{positionMonitoring ? "Enabled" : "Disabled"}</strong></div></div></TabsContent></Tabs></>}
        </SheetContent>
      </Sheet>
      <Toaster position="top-right" richColors />
    </SidebarProvider>
  );
}
