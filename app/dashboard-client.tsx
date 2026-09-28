"use client";

import GateConditionPanel from "./gate-condition-panel";
import CampusCalendar from "./campus-calendar";
import CampusWeather from "./campus-weather";
import FacilityHirePanel from "./facility-hire-panel";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
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
  Eye,
  Fence,
  FileText,
  Flame,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPin,
  Maximize2,
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
  Smartphone,
  Trash2,
  UnlockKeyhole,
  UserRound,
  UserPlus,
  Users,
  VideoOff,
  Volume2,
  Wifi,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import RemoteOpenPanel from "./remote-open-panel";
import CompassWiringReference from "./compass-wiring-reference";

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import PlanUpgradeGate from "./plan-upgrade-gate";
import BrandLogo from "./brand-logo";
import AdminSettingsUnlock from "./admin-settings-unlock";
import PortalAccountsManager from "./portal-accounts-manager";
import UserProfileEditor from "./user-profile-editor";
import OperationsRoomConcept from "./operations-room-concept";
import GateTile from "./gate-tile";
import { gateMotion } from "@/lib/gate-motion";
import type { UserProfile } from "@/lib/profile-model";
import { PROTECTED_SETTINGS_ACTIONS } from "@/lib/protected-settings";
import {
  DAYS as days,
  GATES as gates,
  ACTIVE_GATES as activeGates,
  gateVisualState,
  type GateVisualState,
  type AutomationRule,
  type DayKey,
  type Gate,
  type GatePosition,
  type GateRuntime,
  type GroupKey,
  type ModuleKey,
  type PortalSnapshot,
  type PortalUser,
  type SystemMode,
  type WeekPlan,
} from "@/lib/portal-model";

type ViewKey = "dashboard" | "hire" | "gates" | "cctv" | "guidance" | "schedule" | "automation" | "safety" | "access" | "activity" | "settings";

type DashboardClientProps = {
  user: PortalUser;
  initialData: PortalSnapshot;
  signOutHref?: string;
  onSignOut?: () => void | Promise<void>;
};

const groupConfig = {
  sports: { name: "Tony Frizza Stadium", short: "Stadium", icon: Fence },
  staff: { name: "Staff Car Park", short: "Staff car park", icon: CarFront },
  front: { name: "Office", short: "Office", icon: DoorOpen },
  side: { name: "Side Entry", short: "Side entry", icon: DoorOpen },
} satisfies Record<GroupKey, { name: string; short: string; icon: typeof Fence }>;

const viewMeta: Record<ViewKey, { label: string; description: string }> = {
  dashboard: { label: "Campus overview", description: "Your school. Connected and in view." },
  hire: { label: "Stadium hire", description: "Bookings, visitors and upcoming campus use" },
  gates: { label: "Gates & booms", description: `${activeGates.length} installed gate${activeGates.length === 1 ? "" : "s"} · live status` },
  cctv: { label: "CCTV & zones", description: "Authorised camera verification and site-zone awareness" },
  guidance: { label: "Emergency guidance", description: "Prepare verified, school-approved directions for staff and projector screens" },
  schedule: { label: "Gate schedules", description: "Set daily opening and closing times for every gate" },
  automation: { label: "Automation", description: "Build operating rules for schedules, gate events and safety inputs" },
  safety: { label: "Safety protocol", description: "School-approved controls, human authority and emergency safeguards" },
  access: { label: "Access & users", description: "Verified Magic Keys operator identity and permissions" },
  activity: { label: "Activity log", description: "Review the permanent operator and controller audit trail" },
  settings: { label: "System settings", description: "Configure monitoring, alerts and operating behaviour" },
};

const cctvCameras = [
  { id: "front-boundary", name: "Front boundary", zone: "Main entry", coverage: "Vehicle and pedestrian approach" },
  { id: "staff-car-park", name: "Staff car park", zone: "West zone", coverage: "Boom gate and arrival lane" },
  { id: "sports-area", name: "Sports area", zone: "North zone", coverage: "Perimeter access points" },
  { id: "internal-courtyard", name: "Internal courtyard", zone: "Central zone", coverage: "Assembly route intersection" },
] as const;

const platformModules = [
  { key: "mobile", name: "Magic Keys mobile credentials", description: "Verified operator access and remote gate commands", icon: Smartphone, core: true },
  { key: "video", name: "Camera event verification", description: "Associate gate activity with camera snapshots and recordings", icon: Camera },
  { key: "visitor", name: "Visitor and contractor access", description: "Issue time-limited permissions with approval and expiry", icon: UserPlus },
  { key: "intercom", name: "Intercom and communications", description: "Connect gate calls, operator responses and broadcast notices", icon: Radio },
  { key: "api", name: "API and building systems", description: "Link alarms, facilities platforms and approved automations", icon: Network },
  { key: "reporting", name: "Compliance reporting", description: "Export events, operator actions and scheduled access changes", icon: FileText },
] satisfies Array<{ key: ModuleKey; name: string; description: string; icon: typeof Fence; core?: boolean }>;

function OperationsGauge({ title, count, total, caption }: { title: string; count: number; total: number; caption: string }) {
  const percent = total > 0 ? Math.round(Math.min(total, Math.max(0, count)) / total * 100) : null;
  const complete = percent === 100;
  return <article className="operations-gauge bright-executive-glass">
    <header><h3>{title}</h3><span className={`gauge-status ${complete ? "is-current" : "is-pending"}`}>{percent === null ? "Not configured" : complete ? "Confirmed" : "Awaiting feedback"}</span></header>
    <div className="gauge-dial" role="img" aria-label={`${title}: ${percent === null ? "no active controllers configured" : `${count} of ${total} active controllers, ${percent}%`}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="gauge-bezel" cx="60" cy="60" r="55" />
        <circle className="gauge-track" cx="60" cy="60" r="46" />
        {percent !== null && percent > 0 && <circle className="gauge-fill" cx="60" cy="60" r="46" pathLength="100" strokeDasharray={`${percent} 100`} />}
      </svg>
      <div className="gauge-core" aria-hidden="true"><strong>{percent === null ? "—" : `${percent}%`}</strong><span>Verified</span></div>
    </div>
    <footer><strong>{count} / {total} controllers</strong><span>{caption}</span></footer>
  </article>;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function findAustralianVoice(voices: SpeechSynthesisVoice[]) {
  const australianVoices = voices.filter((voice) => /^en[-_]AU(?:[-_]|$)/i.test(voice.lang));
  const soundsMale = /\b(william|gordon|lee|jack|james|russell|daniel|oliver|thomas|noah|liam|henry|ethan|male|neural2[- ]?[bd]|wavenet[- ]?[bd]|standard[- ]?[bd])\b/i;
  // Keep the Australian accent ahead of the preference for a male voice.
  return australianVoices.find((voice) => soundsMale.test(`${voice.name} ${voice.voiceURI}`))
    ?? australianVoices.find((voice) => voice.default)
    ?? australianVoices[0];
}

function timeToPercent(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return ((hours * 60 + minutes) / (24 * 60)) * 100;
}

function GateIcon({ gate, position, runtime, monitoring = true }: { gate: Gate; position: GateVisualState; runtime?: GateRuntime; monitoring?: boolean }) {
  return <GateTile gate={gate} position={position} motion={gateMotion(gate, runtime, monitoring)} />;
}

function SafetyCommand({ mode, active, authorised, onConfirm }: { mode: "lockdown" | "fire"; active: boolean; authorised: boolean; onConfirm: () => void }) {
  const lockdown = mode === "lockdown";
  const Icon = lockdown ? ShieldAlert : Flame;
  return (
    <button
      className={`safety-command ${mode}${active ? " is-live" : ""}`}
      aria-label={lockdown ? "Review emergency lockdown gate commands" : "Review fire evacuation gate commands"}
      aria-pressed={active}
      disabled={!authorised}
      onClick={onConfirm}
    >
      <span className="safety-command-icon"><Icon /></span>
      <span>
        <strong>{active ? (lockdown ? "LOCKDOWN · ACTIVE" : "FIRE / EVACUATION · ACTIVE") : (lockdown ? "START LOCKDOWN" : "START FIRE / EVACUATION")}</strong>
        <em>{!authorised ? "Administrator approval required" : active ? "Priority active · confirmation required to reissue" : lockdown ? "Queues CLOSE commands · confirmation required" : "Queues OPEN commands · confirmation required"}</em>
      </span>
    </button>
  );
}

function EmergencyAlertPanel({
  mode,
  onClear,
  confirmed,
  pending,
  failed,
  canClear,
  projectorAccess,
}: {
  mode: Exclude<SystemMode, "normal">;
  onClear: () => void;
  confirmed: number;
  pending: number;
  failed: number;
  canClear: boolean;
  projectorAccess: boolean;
}) {
  const fire = mode === "fire";
  const Icon = fire ? Flame : ShieldAlert;
  return (
    <section className={`emergency-alert-panel ${mode}`} role="alert" aria-live="assertive" aria-atomic="true">
      <header>
        <span className="emergency-alert-icon"><Icon /></span>
        <span><small>Priority gate response issued</small><strong>{fire ? "Fire / evacuation · open commands" : "Lockdown · close commands"}</strong></span>
        <i className="emergency-alert-pulse" />
      </header>
      <div className="emergency-alert-state">
        <span><CheckCircle2 /><span><strong>{confirmed} physically confirmed</strong><small>Independent position feedback received</small></span></span>
        <span><Zap /><span><strong>{pending} awaiting confirmation</strong><small>Queued or being completed by controllers</small></span></span>
        <span><AlertTriangle /><span><strong>{failed} require attention</strong><small>Offline, blocked or faulted controllers</small></span></span>
        {fire && <span><MonitorUp /><span><strong>{projectorAccess ? "Projector link not yet commissioned" : "Projector broadcasts require a plan upgrade"}</strong><small>{projectorAccess ? "No broadcast is claimed without system feedback" : "Advanced feature · locked on this plan"}</small></span></span>}
      </div>
      <p>{fire ? "Evacuate by the nearest safe exit and follow the school emergency plan." : "Move inside, secure the area and await an authorised all-clear."}</p>
      <footer>
        {fire && <a href="tel:000"><PhoneCall /> Triple Zero (000)</a>}
        <Button variant="outline" disabled={!canClear} onClick={onClear}><RotateCcw /> {canClear ? "Clear emergency priority" : "Administrator required to clear"}</Button>
      </footer>
    </section>
  );
}

export default function DashboardClient({ user, initialData, signOutHref = "/", onSignOut }: DashboardClientProps) {
  const canOperate = user.role === "operator" || user.role === "administrator";
  const isAdministrator = user.role === "administrator";
  const roleLabel = isAdministrator ? "System administrator" : canOperate ? "Authorised operator" : "View-only operator";
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [currentTime, setCurrentTime] = useState(() => Date.parse(initialData.serverTime));
  const [adminAccessUntil, setAdminAccessUntil] = useState(0);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const displayName = userProfile?.displayName || user.displayName;
  const profileImage = userProfile?.avatarUrl || undefined;
  const [adminUnlockOpen, setAdminUnlockOpen] = useState(false);
  const adminUnlocked = isAdministrator && adminAccessUntil > currentTime;
  const configurationView = ["settings", "automation"].includes(activeView);
  // CCTV and Emergency guidance open only after the administrator password (same 10-minute unlock as settings).
  const passwordLockedView = activeView === "cctv" || activeView === "guidance";
  const [plan, setPlan] = useState(initialData.plan);
  const [serverTime, setServerTime] = useState(initialData.serverTime);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const advancedFeaturesEnabled = plan?.advancedFeatures === true;
  const [systemMode, setSystemMode] = useState<SystemMode>(initialData.systemMode);
  const [gateRuntime, setGateRuntime] = useState<Record<string, GateRuntime>>(() => Object.fromEntries(initialData.gates.map((gate) => [gate.gateId, gate])));
  const [selectedGate, setSelectedGate] = useState<Gate | null>(null);
  const [selectedScheduleGateId, setSelectedScheduleGateId] = useState(gates[0].id);
  const [schedules, setSchedules] = useState<Record<string, WeekPlan>>(initialData.schedules);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [activity, setActivity] = useState(initialData.activity);
  const [positionMonitoring, setPositionMonitoring] = useState(initialData.settings.positionMonitoring);
  const [faultAlerts, setFaultAlerts] = useState(initialData.settings.faultAlerts);
  const [voiceAnnouncements, setVoiceAnnouncements] = useState(initialData.settings.voiceAnnouncements);
  const [voiceStatus, setVoiceStatus] = useState("Checking Australian voice availability…");
  const [gateQuery, setGateQuery] = useState("");
  const [gateGroup, setGateGroup] = useState<"all" | GroupKey>("all");
  const [selectedCameraId, setSelectedCameraId] = useState<(typeof cctvCameras)[number]["id"]>(cctvCameras[0].id);
  const [guidanceIncident, setGuidanceIncident] = useState<"fire" | "security" | "other">("fire");
  const [guidanceZone, setGuidanceZone] = useState("Central zone");
  const [guidancePrepared, setGuidancePrepared] = useState(false);
  const [ptzTrackingActive, setPtzTrackingActive] = useState(false);
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey>>(() => new Set(initialData.settings.enabledModules));
  const [automations, setAutomations] = useState<AutomationRule[]>(initialData.automations);
  const [automationName, setAutomationName] = useState("");
  // Typed automation builder: "Hold a gate open for a time window" (see lib/gate-windows.ts).
  const [automationGate, setAutomationGate] = useState(activeGates[0]?.id ?? "");
  const [automationRepeat, setAutomationRepeat] = useState<"weekly" | "once">("weekly");
  const [automationDays, setAutomationDays] = useState<DayKey[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [automationDate, setAutomationDate] = useState("");
  const [automationOpen, setAutomationOpen] = useState("07:30");
  const [automationClose, setAutomationClose] = useState("08:45");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [clearingEmergency, setClearingEmergency] = useState(false);
  const [pendingEmergency, setPendingEmergency] = useState<"lockdown" | "fire" | "clear" | null>(null);
  const [pendingGateCommand, setPendingGateCommand] = useState<{ gate: Gate; position: GatePosition } | null>(null);
  const [controllerCredential, setControllerCredential] = useState<{ gateId: string; token: string } | null>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Incremented whenever this operator changes something. Background refreshes
  // started before the change are discarded, so stale state never reappears.
  const mutationEpochRef = useRef(0);

  useEffect(() => {
    if (!isAdministrator) return;
    let active = true;
    void fetch("/api/auth/admin", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).then((body) => {
      if (active && body?.unlocked && typeof body.expiresAt === "number") setAdminAccessUntil(body.expiresAt);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [isAdministrator]);

  useEffect(() => {
    if (!adminAccessUntil) return;
    const timer = window.setTimeout(() => { setAdminAccessUntil(0); setControllerCredential(null); setCurrentTime(Date.now()); }, Math.max(0, adminAccessUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [adminAccessUntil]);

  useEffect(() => {
    const tick = () => setCurrentTime(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null)
      .then((body) => { if (active && body?.profile) setUserProfile(body.profile); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function profileSaved(profile: UserProfile) {
    setUserProfile((current) => !current || current.id === profile.id ? profile : current);
  }

  function settingsUnlocked(expiresAt: number) {
    setAdminAccessUntil(expiresAt);
    setAdminUnlockOpen(false);
    toast.success("Administrator settings unlocked for 10 minutes");
  }

  async function lockSettings() {
    try {
      const result = await fetch("/api/auth/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lock" }) });
      if (!result.ok) throw new Error("Settings could not be locked. Please try again.");
      setAdminAccessUntil(0); setControllerCredential(null);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Settings could not be locked."); }
  }

  function applySnapshot(snapshot: PortalSnapshot, preserveSchedule = false) {
    setPlan(snapshot.plan);
    setServerTime(snapshot.serverTime);
    setCurrentTime(Date.parse(snapshot.serverTime));
    setSystemMode(snapshot.systemMode);
    setGateRuntime(Object.fromEntries(snapshot.gates.map((gate) => [gate.gateId, gate])));
    if (!preserveSchedule) setSchedules(snapshot.schedules);
    setActivity(snapshot.activity);
    setAutomations(snapshot.automations);
    setPositionMonitoring(snapshot.settings.positionMonitoring);
    setFaultAlerts(snapshot.settings.faultAlerts);
    setVoiceAnnouncements(snapshot.settings.voiceAnnouncements);
    setEnabledModules(new Set(snapshot.settings.enabledModules));
    if (!snapshot.plan.advancedFeatures) {
      setPtzTrackingActive(false);
      setGuidancePrepared(false);
    }
  }

  async function postPortal(payload: Record<string, unknown>, label: string) {
    if (PROTECTED_SETTINGS_ACTIONS.has(String(payload.action)) && !adminUnlocked) {
      if (isAdministrator) setAdminUnlockOpen(true);
      throw new Error("Enter an administrator password, then submit the change again.");
    }
    setBusyAction(label);
    mutationEpochRef.current += 1;
    try {
      const response = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { snapshot?: PortalSnapshot; error?: string; code?: string; controllerCredential?: { gateId: string; token: string } };
      if (response.status === 401) {
        await onSignOut?.();
        throw new Error("Your secure session expired. Sign in again.");
      }
      if (result.code === "admin_password_required") { setAdminAccessUntil(0); setControllerCredential(null); if (isAdministrator) setAdminUnlockOpen(true); }
      if (!response.ok || !result.snapshot) throw new Error(result.error || "The operation could not be completed.");
      mutationEpochRef.current += 1;
      applySnapshot(result.snapshot);
      if (["save_schedule", "add_automation", "toggle_automation", "delete_automation"].includes(String(payload.action))) window.dispatchEvent(new Event("gate-windows-updated"));
      if (result.controllerCredential) setControllerCredential(result.controllerCredential);
      return result;
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      const epochAtStart = mutationEpochRef.current;
      try {
        const response = await fetch("/api/portal", { cache: "no-store" });
        if (response.status === 401) {
          await onSignOut?.();
          return;
        }
        if (response.ok) {
          const result = await response.json() as { snapshot?: PortalSnapshot };
          // Discard if the operator changed something while this was in flight.
          if (active && result.snapshot && epochAtStart === mutationEpochRef.current) applySnapshot(result.snapshot, scheduleDirty);
        }
      } catch {
        // Retain the last confirmed state and let the connection status communicate staleness.
      } finally {
        if (active) timer = window.setTimeout(refresh, systemMode !== "normal" || busyAction?.startsWith("emergency-") || busyAction === "clear-emergency" ? 1000 : 4000);
      }
    };
    timer = window.setTimeout(refresh, systemMode !== "normal" || busyAction?.startsWith("emergency-") || busyAction === "clear-emergency" ? 1000 : 4000);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [scheduleDirty, onSignOut, systemMode, busyAction]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    const prepareAustralianVoice = () => {
      const voice = findAustralianVoice(window.speechSynthesis.getVoices());
      selectedVoiceRef.current = voice ?? null;
      setVoiceStatus(voice
        ? `Australian English · ${voice.name}`
        : "Install an Australian English voice on this device for an Australian accent. Until then, announcements use the browser’s available voice.");
    };
    prepareAustralianVoice();
    window.speechSynthesis.addEventListener("voiceschanged", prepareAustralianVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", prepareAustralianVoice);
  }, []);

  useEffect(() => {
    if (!voiceAnnouncements || clearingEmergency || systemMode === "normal" || typeof window === "undefined") return;

    const speakWarning = () => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const voice = findAustralianVoice(synth.getVoices()) ?? selectedVoiceRef.current;

      const message = systemMode === "lockdown"
        ? "Warning. Lockdown gate commands issued. Check every gate confirmation."
        : "Warning. Fire evacuation gate commands issued. Check every gate confirmation and evacuate now.";
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "en-AU";
      utterance.rate = 0.84;
      utterance.pitch = 1;
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
  }, [systemMode, voiceAnnouncements, clearingEmergency]);

  const voiceStatusText = typeof window !== "undefined" && !("speechSynthesis" in window)
    ? "Voice announcements are unavailable in this browser."
    : voiceStatus;

  const selectedScheduleGate = gates.find((gate) => gate.id === selectedScheduleGateId) ?? gates[0];
  const selectedWeek = schedules[selectedScheduleGate.id];
  const selectedCamera = cctvCameras.find((camera) => camera.id === selectedCameraId) ?? cctvCameras[0];
  const cameraWorkspaceEnabled = advancedFeaturesEnabled && enabledModules.has("video");

  function runtimeFor(gate: Gate) {
    return gateRuntime[gate.id];
  }

  function getPosition(gate: Gate): GateVisualState {
    return gateVisualState(gate, runtimeFor(gate), positionMonitoring);
  }

  const openCount = activeGates.filter((gate) => getPosition(gate) === "open").length;
  const closedCount = activeGates.filter((gate) => getPosition(gate) === "closed").length;
  const unknownCount = activeGates.length - openCount - closedCount;
  const onlineCount = activeGates.filter((gate) => runtimeFor(gate)?.controllerState === "online").length;
  const safetyHealthyCount = activeGates.filter((gate) => runtimeFor(gate)?.controllerState === "online" && runtimeFor(gate)?.safetyOk === true).length;
  const commissionedCount = activeGates.filter((gate) => runtimeFor(gate)?.commissioned).length;
  const credentialCount = activeGates.filter((gate) => runtimeFor(gate)?.credentialIssued).length;
  const scheduledGateCount = activeGates.filter((gate) => Object.values(schedules[gate.id]).some((plan) => plan.enabled)).length;
  const operationalReady = commissionedCount === activeGates.length && onlineCount === activeGates.length && safetyHealthyCount === activeGates.length;
  const respondingGates = activeGates.filter((gate) => {
    const runtime = runtimeFor(gate);
    const seen = runtime?.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
    return runtime?.controllerState === "online" && Number.isFinite(seen) && currentTime - seen <= 90_000;
  });
  const verifiedSafetyCount = respondingGates.filter((gate) => runtimeFor(gate)?.safetyOk === true).length;

  const emergencyExpected = systemMode === "fire" ? "open" : "closed";
  const emergencyConfirmed = systemMode === "normal" ? 0 : activeGates.filter((gate) => {
    const runtime = runtimeFor(gate);
    return runtime?.controllerState === "online" && runtime.lastCommandState === "acknowledged" && runtime.reportedPosition === emergencyExpected;
  }).length;
  const emergencyPending = systemMode === "normal" ? 0 : activeGates.filter((gate) => ["queued", "dispatched"].includes(runtimeFor(gate)?.lastCommandState ?? "idle")).length;
  const emergencyFailed = systemMode === "normal" ? 0 : activeGates.length - emergencyConfirmed - emergencyPending;

  const filteredGates = useMemo(() => {
    const query = gateQuery.trim().toLowerCase();
    return gates.filter((gate) => {
      const matchesGroup = gateGroup === "all" || gate.group === gateGroup;
      const matchesQuery = !query || `${gate.name} ${gate.area} ${gate.id} ${gate.type}`.toLowerCase().includes(query);
      return matchesGroup && matchesQuery;
    });
  }, [gateGroup, gateQuery]);

  function activityTime(value: string) {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "medium", timeZone: "Australia/Melbourne" }).format(new Date(value));
  }

  function relativeHeartbeat(value: string | null) {
    if (!value || !Number.isFinite(Date.parse(value))) return "Awaiting verified heartbeat";
    const deltaMinutes = Math.max(0, Math.round((currentTime - Date.parse(value)) / 60000));
    if (deltaMinutes < 1) return "Heartbeat just now";
    if (deltaMinutes === 1) return "Heartbeat 1 minute ago";
    if (deltaMinutes < 60) return `Heartbeat ${deltaMinutes} minutes ago`;
    const hours = Math.floor(deltaMinutes / 60);
    return `Heartbeat ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  function portalTimeLabel(value: string) {
    return new Intl.DateTimeFormat("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Australia/Melbourne",
    }).format(new Date(value));
  }

  function announceGateCommand(position: GatePosition) {
    if (!voiceAnnouncements || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const voice = findAustralianVoice(synth.getVoices()) ?? selectedVoiceRef.current;
    const utterance = new SpeechSynthesisUtterance(`${position === "open" ? "Open" : "Close"} command queued. Awaiting physical gate confirmation.`);
    utterance.lang = "en-AU";
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  }

  function announceAllClear() {
    if (!voiceAnnouncements || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const voice = findAustralianVoice(synth.getVoices()) ?? selectedVoiceRef.current;
    const utterance = new SpeechSynthesisUtterance("Emergency priority cleared. Confirm all gate positions before returning to normal operation.");
    utterance.lang = "en-AU";
    utterance.rate = 0.86;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  }

  async function activateEmergency(mode: "lockdown" | "fire") {
    try {
      await postPortal({ action: "emergency", mode }, `emergency-${mode}`);
      setActiveView("gates");
      toast.warning(mode === "lockdown" ? "Lockdown gate commands issued" : "Fire / evacuation gate commands issued", {
        description: "The portal is waiting for each controller and physical position input.",
      });
    } catch (reason) {
      toast.error("Emergency gate command was not issued", { description: reason instanceof Error ? reason.message : "Try again or use the approved local emergency controls." });
    }
  }

  async function clearEmergency() {
    setClearingEmergency(true);
    // Stop the repeating spoken warning straight away; the confirmed state follows.
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    try {
      await postPortal({ action: "clear_emergency" }, "clear-emergency");
      toast.success("Emergency priority cleared", { description: "Uncollected emergency packets were cancelled. Already-collected packets cannot be recalled; confirm every gate before resuming normal operation." });
      announceAllClear();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      if (/not active/i.test(message)) {
        // Already cleared on the server: show the real state instead of an error.
        try {
          const response = await fetch("/api/portal", { cache: "no-store" });
          const result = await response.json() as { snapshot?: PortalSnapshot };
          if (result.snapshot) { mutationEpochRef.current += 1; applySnapshot(result.snapshot); }
          toast.success("Emergency priority is already cleared");
          return;
        } catch { /* fall through to the error below */ }
      }
      toast.error("Emergency priority was not cleared", { description: message || "Use the approved local procedure." });
    } finally {
      setClearingEmergency(false);
    }
  }

  async function setGatePosition(gate: Gate, position: GatePosition) {
    if (!gate.active || systemMode !== "normal") return;
    try {
      await postPortal({ action: "gate_command", gateId: gate.id, position }, `gate-${gate.id}`);
      toast.success(`${gate.name}: ${position} command queued`, { description: "Waiting for controller and physical position confirmation." });
      announceGateCommand(position);
    } catch (reason) {
      toast.error(`${gate.name}: command not issued`, { description: reason instanceof Error ? reason.message : "The portal could not queue the command." });
    }
  }

  function updateDay(day: DayKey, patch: Partial<WeekPlan[DayKey]>) {
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

  async function saveSchedule() {
    try {
      await postPortal({ action: "save_schedule", gateId: selectedScheduleGate.id, week: selectedWeek }, `schedule-${selectedScheduleGate.id}`);
      setScheduleDirty(false);
      toast.success("Schedule saved", { description: `${selectedScheduleGate.name} has been updated in the central operating record.` });
    } catch (reason) {
      toast.error("Schedule was not saved", { description: reason instanceof Error ? reason.message : "Check the entered times." });
    }
  }

  async function toggleModule(module: (typeof platformModules)[number]) {
    if (module.core) return;
    if (module.key === "video" && !advancedFeaturesEnabled) { setUpgradeOpen(true); return; }
    const enabling = !enabledModules.has(module.key);
    const next = new Set(enabledModules);
    if (enabling) next.add(module.key); else next.delete(module.key);
    try {
      await postPortal({ action: "update_settings", patch: { enabledModules: [...next] } }, `module-${module.key}`);
      toast.success(`${module.name} ${enabling ? "enabled" : "disabled"}`);
    } catch (reason) {
      toast.error("Module setting was not changed", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  async function updateSetting(patch: Partial<PortalSnapshot["settings"]>, label: string) {
    try {
      await postPortal({ action: "update_settings", patch }, label);
    } catch (reason) {
      toast.error("Setting was not changed", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  function exportActivity() {
    if (!activity.length) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = ["Time,Actor,Category,Action,Detail", ...activity.map((record) => [activityTime(record.createdAt), record.actorName, record.category, record.action, record.detail].map(escape).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "balwyn-gate-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Activity log exported");
  }

  async function addAutomation() {
    const name = automationName.trim();
    if (!name) {
      toast.error("Name the automation rule", { description: "Add a clear name before saving the rule." });
      return;
    }
    try {
      const config = { gateId: automationGate, open: automationOpen, close: automationClose, ...(automationRepeat === "once" ? { date: automationDate } : { days: automationDays }) };
      await postPortal({ action: "add_automation", name, kind: "gate_window", config }, "add-automation");
      setAutomationName("");
      toast.success("Automation rule saved", { description: name });
    } catch (reason) {
      toast.error("Automation rule was not saved", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  async function toggleAutomation(id: number, enabled: boolean) {
    try {
      await postPortal({ action: "toggle_automation", id, enabled }, `automation-${id}`);
    } catch (reason) {
      toast.error("Automation rule was not changed", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  async function deleteAutomation(id: number) {
    try {
      await postPortal({ action: "delete_automation", id }, `automation-${id}`);
      toast.success("Automation rule removed");
    } catch (reason) {
      toast.error("Automation rule was not removed", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  async function provisionController(gateId: string) {
    try {
      await postPortal({ action: "provision_controller", gateId }, `provision-${gateId}`);
      toast.success("One-time controller credential issued", { description: "Download it now. Issuing another credential revokes this one." });
    } catch (reason) {
      toast.error("Controller credential was not issued", { description: reason instanceof Error ? reason.message : undefined });
    }
  }

  function downloadControllerCredential() {
    if (!controllerCredential) return;
    const contents = `# Complete every REPLACE value from the signed commissioning sheet.\n# The agent refuses to start with missing or invalid safety inputs.\nPORTAL_URL=${window.location.origin}\nGATE_ID=${controllerCredential.gateId}\nCONTROLLER_TOKEN=${controllerCredential.token}\nOPEN_RELAY_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nCLOSE_RELAY_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nOPEN_LIMIT_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nCLOSED_LIMIT_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nSAFETY_OK_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nESTOP_PIN=REPLACE_WITH_VERIFIED_BCM_PIN\nRELAY_ACTIVE_LOW=REPLACE_WITH_TRUE_OR_FALSE\nINPUT_ACTIVE_LOW=REPLACE_WITH_TRUE_OR_FALSE\nINPUT_BIAS=REPLACE_WITH_PULL_UP_PULL_DOWN_OR_OFF\nPULSE_SECONDS=REPLACE_WITH_COMMISSIONED_VALUE\nMOVEMENT_TIMEOUT_SECONDS=REPLACE_WITH_COMMISSIONED_VALUE\nENABLE_SCHEDULE_CONTROL=false\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${controllerCredential.gateId.toLowerCase()}-controller.env`;
    link.click();
    URL.revokeObjectURL(url);
    setControllerCredential(null);
  }

  function navItem(view: ViewKey, Icon: typeof LayoutDashboard, badge?: string) {
    const locked = (view === "cctv" || view === "guidance") && (!adminUnlocked || !advancedFeaturesEnabled);
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton className="portal-nav-button" isActive={activeView === view} tooltip={viewMeta[view].label} onClick={() => setActiveView(view)}>
          <Icon /><span>{viewMeta[view].label}</span>
        </SidebarMenuButton>
        {locked ? <SidebarMenuBadge><LockKeyhole className="plan-nav-lock" aria-hidden="true" /><span className="sr-only">Password or plan required</span></SidebarMenuBadge> : badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
      </SidebarMenuItem>
    );
  }

  function gateStatus(gate: Gate) {
    if (!gate.active) return { label: "Inactive", className: "is-inactive", detail: "Not activated yet" };
    const runtime = runtimeFor(gate);
    const requested = runtime?.commandedPosition ?? gate.defaultPosition;
    if (!runtime?.commissioned) return { label: "Controller not commissioned", className: "is-unknown", detail: runtime?.credentialIssued ? "Credential issued · awaiting verified heartbeat" : "No relay credential issued" };
    if (runtime.lastCommandState === "queued") return { label: `${requested === "open" ? "Open" : "Close"} requested`, className: "is-pending", detail: "Waiting for controller" };
    if (runtime.lastCommandState === "dispatched") return { label: `${requested === "open" ? "Opening" : "Closing"} requested`, className: "is-pending", detail: "Controller completing command" };
    if (runtime.lastCommandState === "failed" || runtime.lastCommandState === "blocked" || runtime.controllerState === "fault") {
      return { label: "Attention required", className: "is-fault", detail: runtime.lastError || "Controller or safety input fault" };
    }
    if (runtime.controllerState === "offline") {
      const lastPosition = runtime.reportedPosition === "open" || runtime.reportedPosition === "closed" ? `Last confirmed ${runtime.reportedPosition}` : "Position unavailable";
      return { label: lastPosition, className: "is-unknown", detail: "Controller offline" };
    }
    if (runtime.reportedPosition === "open") return { label: "Open confirmed", className: "is-open", detail: "Physical input confirmed" };
    if (runtime.reportedPosition === "closed") return { label: "Closed confirmed", className: "is-closed", detail: "Physical input confirmed" };
    return { label: "Position unavailable", className: "is-unknown", detail: "Awaiting physical input" };
  }

  function renderGateCards(list: Gate[]) {
    return (
      <div className="access-grid">
        {list.map((gate) => {
          const position = getPosition(gate);
          const status = gateStatus(gate);
          const runtime = runtimeFor(gate);
          const safetyLabel = !gate.active
            ? "Inactive"
            : runtime?.controllerState === "online" && runtime?.safetyOk === true
              ? "Safety healthy"
              : runtime?.safetyOk === false
                ? "Safety blocked"
                : "Safety pending";
          return (
            <button className={`access-card ${gate.active ? "is-active" : "is-inactive"} ${positionMonitoring ? "" : "is-monitoring-paused"} controller-${runtimeFor(gate)?.controllerState ?? "uncommissioned"}`} key={gate.id} aria-label={`${gate.name} · ${gate.active ? "Active" : "Inactive"} · ${status.label}`} aria-haspopup="dialog" onClick={() => setSelectedGate(gate)}>
              <span className="access-card-heading"><span><strong>{gate.name}</strong><small>{gate.type}</small></span><span className={`gate-activation-badge ${gate.active ? "is-active" : "is-inactive"}`}>{gate.active ? "Active" : "Inactive"}</span></span>
              {/* Area / ID pills removed at the owner's request: the card shows the gate itself. */}
              <GateIcon gate={gate} position={position} runtime={runtime} monitoring={positionMonitoring} />
              <span className="access-card-footer">
                <span className="access-card-context">
                  <span className={`position-label ${(!gate.active || positionMonitoring) ? status.className : "is-unknown"}`}><i />{!gate.active || positionMonitoring ? status.label : "Monitoring paused"}</span>
                  <small className="controller-detail">{!gate.active || positionMonitoring ? status.detail : "Physical feedback hidden"}</small>
                  <small className="controller-heartbeat">{relativeHeartbeat(runtime?.lastSeen ?? null)}</small>
                </span>
                <span className="access-card-statuses" aria-hidden="true">
                  <span className={`status-chip is-${runtime?.controllerState ?? "uncommissioned"}`}>{runtime?.controllerState ?? "uncommissioned"}</span>
                  <span className={`status-chip ${runtime?.safetyOk === true ? "is-healthy" : runtime?.safetyOk === false ? "is-fault" : "is-pending"}`}>{safetyLabel}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <SidebarProvider className={`control-portal mode-${systemMode}`} style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas" className="control-sidebar">
        <SidebarHeader className="portal-sidebar-header"><div className="magic-sidebar-brand"><BrandLogo tone="dark" /></div></SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup><SidebarGroupLabel>Operations</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{navItem("dashboard", LayoutDashboard)}{navItem("schedule", CalendarClock)}{navItem("hire", CalendarDays)}{navItem("cctv", Camera)}{navItem("guidance", MapPin)}{navItem("automation", Workflow, String(automations.filter((rule) => rule.enabled).length))}{navItem("safety", ShieldCheck)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <SidebarGroup><SidebarGroupLabel>Administration</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{navItem("access", Users)}{navItem("activity", ClipboardList, activity.length ? String(activity.length) : undefined)}{navItem("settings", Settings2)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <div className="sidebar-system-card"><span><Wifi /> System connection</span><strong><i /> Portal online</strong><small>{activeGates.length} active · {gates.length - activeGates.length} inactive</small><small>{onlineCount} of {activeGates.length} active gate controllers online</small><small>{commissionedCount} commissioned · {credentialCount} credentials issued</small><small className="voice-status"><Volume2 /> Gate voice · {voiceAnnouncements ? "On" : "Off"}</small></div><div className="sidebar-rjl-brand"><img src="/rjl-commercial-logo-clear.png" alt="RJL Commercial Fencing and Gates" /></div>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="operator-footer"><Avatar size="lg"><AvatarImage src={profileImage} alt={`${user.displayName} profile`} /><AvatarFallback>{initials(displayName)}</AvatarFallback><AvatarBadge /></Avatar><div className="operator-footer-copy"><strong>{displayName}</strong><span>{user.email}</span><small>{roleLabel}</small></div>{onSignOut ? <button type="button" className="operator-sign-out" onClick={onSignOut} aria-label="Sign out of Magic Keys"><LogOut /></button> : <a href={signOutHref} target="_top" aria-label="Sign out of Magic Keys"><LogOut /></a>}</SidebarFooter>
      </Sidebar>

      <SidebarInset className="portal-workspace">
        <header className="workspace-header">
          <div className="workspace-location"><SidebarTrigger className="sidebar-toggle" /><span className="workspace-school-brand"><img src="/balwyn-high-school-logo-clear.png" alt="Balwyn High School" /></span><div className="header-safety" role="region" aria-label="Emergency gate commands"><div className={`safety-bar-status${systemMode === "normal" ? "" : " is-alert"}`}><i className="status-dot" /><span><small>System state</small><strong>{systemMode === "normal" ? "No emergency active" : systemMode === "lockdown" ? "Lockdown active" : "Fire / evacuation active"}</strong><em className="header-safety-note"><Radio aria-hidden="true" /> Local safety circuits remain authoritative</em></span></div><SafetyCommand mode="fire" active={systemMode === "fire"} authorised={isAdministrator} onConfirm={() => setPendingEmergency("fire")} /></div></div>
          <div className="workspace-header-right"><div className={`system-status-cluster ${operationalReady ? "is-ready" : "is-attention"}`}><i className="signal-dot" /><span><small>Controller status</small><strong>{operationalReady ? "All systems ready" : "Commissioning"}</strong></span><b>{onlineCount}/{activeGates.length}</b></div><span className="connection-pill"><i /> Encrypted connection</span><button className="notification-button" aria-label="View system alerts" onClick={() => onlineCount === activeGates.length ? toast.success("All controllers online", { description: "Physical gate feedback is available for every access point." }) : toast.warning(`${activeGates.length - onlineCount} active gate controllers are not online`, { description: `${commissionedCount} have completed a verified heartbeat; ${credentialCount} credentials have been issued.` })}><Bell /></button><div className="header-operator"><Avatar><AvatarImage src={profileImage} alt="Operator profile" /><AvatarFallback>{initials(displayName)}</AvatarFallback><AvatarBadge /></Avatar><span><strong>{displayName}</strong><small>{roleLabel}</small></span></div></div>
        </header>

        <div className="campus-context"><CampusCalendar onManage={() => setActiveView("hire")} canBook={canOperate} /><CampusWeather /></div>

        {/* The fire / evacuation control lives in the header (always visible on every page). */}

        {systemMode !== "normal" && <EmergencyAlertPanel mode={systemMode} onClear={() => setPendingEmergency("clear")} confirmed={emergencyConfirmed} pending={emergencyPending} failed={emergencyFailed} canClear={isAdministrator} projectorAccess={advancedFeaturesEnabled} />}


        <div className="workspace-content" data-view={activeView}>
          {activeView !== "dashboard" && <div className="workspace-title-row"><div><h1>{viewMeta[activeView].label}</h1><span>{viewMeta[activeView].description}</span><div className="workspace-context" aria-label="Portal context"><span>Portal sync · {portalTimeLabel(serverTime)}</span><span>Timezone · Australia/Melbourne</span><span>Heartbeat coverage · {onlineCount}/{activeGates.length} active controllers</span></div></div><div className="workspace-title-meta"><Badge variant="outline" className="concept-badge"><ShieldCheck /> {operationalReady ? "All controllers ready" : "Commissioning / attention required"}</Badge></div></div>}
          {activeView === "dashboard" && (
            <div className="desk-service-row is-dashboard-utility">
              <button type="button" onClick={() => { setActiveView("activity"); toast.message("Fault report", { description: "Use the activity log to record the gate, time and fault. Controllers stay amber until a verified heartbeat exists." }); }}>Report a fault</button>
              <span className="service-chip">Next scheduled service<small>Countdown starts after commissioning</small></span>
            </div>
          )}

          {activeView === "dashboard" && (
            <>
              <div className="sr-only" aria-label="Portal context">Portal sync · {portalTimeLabel(serverTime)} · Timezone · Australia/Melbourne · Heartbeat coverage · {onlineCount}/{activeGates.length} active controllers</div>
              <GateConditionPanel gates={activeGates} runtime={gateRuntime} getPosition={getPosition} monitoring={positionMonitoring} systemMode={systemMode} now={currentTime} canOperate={canOperate} busy={Boolean(busyAction)} onSelect={setSelectedGate} onCommand={(gate, position) => setPendingGateCommand({ gate, position })} />
              <section className="compact-controller-health" aria-label="Controller verification">
                <OperationsGauge title="Controller connection" count={respondingGates.length} total={activeGates.length} caption="Recent heartbeat" />
                <OperationsGauge title="Gate commissioning" count={commissionedCount} total={activeGates.length} caption="Commissioned" />
                <OperationsGauge title="Safety feedback" count={verifiedSafetyCount} total={activeGates.length} caption="Healthy inputs" />
              </section>
              {!advancedFeaturesEnabled && <section className="advanced-discovery"><span className="advanced-eyebrow"><LockKeyhole /> Discover Magic Keys Advanced</span><h2>See what’s possible beyond gate access.</h2><p>Explore camera zones, an emergency-response example and the messages a connected classroom could display.</p><div className="advanced-discovery-actions"><Button variant="outline" onClick={() => setActiveView("guidance")}><MapPin /> Explore emergency guidance</Button><Button variant="outline" onClick={() => setActiveView("cctv")}><Camera /> Explore CCTV & zones</Button><Button onClick={() => setUpgradeOpen(true)}>Discuss your school’s upgrade <ChevronRight /></Button></div></section>}
            </>
          )}

          {activeView === "hire" && <FacilityHirePanel canBook={canOperate} />}

          {activeView === "gates" && (
            <section className="view-panel">
              <div className="view-panel-heading"><div><h2>Gates & booms</h2><small>{activeGates.length} installed gate{activeGates.length === 1 ? "" : "s"} · live status</small></div><div className="status-legend"><span className="is-open"><i /> Open confirmed</span><span className="is-closed"><i /> Closed confirmed</span><span className="is-pending"><i /> Awaiting feedback</span><span className="is-inactive"><i /> Inactive · lights off</span></div></div>
              <div className="gate-toolbar">
                <label className="gate-search"><Search aria-hidden="true" /><span className="sr-only">Search gates</span><Input value={gateQuery} onChange={(event) => setGateQuery(event.target.value)} placeholder="Search by gate, area or asset ID" /></label>
                <label><span className="sr-only">Filter gates by area</span><NativeSelect value={gateGroup} onChange={(event) => setGateGroup(event.target.value as "all" | GroupKey)}><NativeSelectOption value="all">All controlled areas</NativeSelectOption>{(Object.keys(groupConfig) as GroupKey[]).filter((group) => gates.some((gate) => gate.group === group)).map((group) => <NativeSelectOption key={group} value={group}>{groupConfig[group].name}</NativeSelectOption>)}</NativeSelect></label>
              </div>
              {filteredGates.some((gate) => gate.active) ? renderGateCards(filteredGates.filter((gate) => gate.active)) : <div className="gate-empty"><Search /><h3>No gates match this search</h3><p>Clear the search or choose another controlled area.</p><Button variant="outline" onClick={() => { setGateQuery(""); setGateGroup("all"); }}>Clear filters</Button></div>}
            </section>
          )}

          {passwordLockedView && !adminUnlocked && <section className="admin-settings-locked"><span className="admin-lock-icon"><LockKeyhole /></span><h2>{viewMeta[activeView].label} is password protected</h2><p>{isAdministrator ? "Enter the administrator password to open this section. It locks again after 10 minutes." : "Only an administrator can open this section."}</p>{isAdministrator && <AdminSettingsUnlock onUnlocked={settingsUnlocked} />}</section>}
          {adminUnlocked && !advancedFeaturesEnabled && (activeView === "cctv" || activeView === "guidance") && <PlanUpgradeGate key={activeView} feature={activeView} onUpgrade={() => setUpgradeOpen(true)} />}

          {activeView === "cctv" && adminUnlocked && advancedFeaturesEnabled && (
            <section className="cctv-workspace"><OperationsRoomConcept variant="cctv" />
              <div className={`cctv-readiness ${cameraWorkspaceEnabled ? "is-enabled" : ""}`} role="status">
                <span className="cctv-readiness-icon">{cameraWorkspaceEnabled ? <ShieldCheck /> : <VideoOff />}</span>
                <span>
                  <strong>{cameraWorkspaceEnabled ? "Camera workspace enabled" : "CCTV integration preview"}</strong>
                  <small>{cameraWorkspaceEnabled ? "Live feeds remain unavailable until authorised CCTV endpoints are commissioned." : "No live footage is connected. Enable Camera event verification in System settings before commissioning."}</small>
                </span>
                <Button variant="outline" onClick={() => setActiveView("settings")}>Review integration <ChevronRight /></Button>
              </div>

              <article className={`fire-intelligence-console ${systemMode === "fire" ? "is-active" : ""}`}>
                <div className="fire-intelligence-heading">
                  <span className="fire-intelligence-icon"><Flame /></span>
                  <div>
                    <small>AI-assisted fire response</small>
                    <h2>{systemMode === "fire" ? "Fire priority active · verification required" : "Camera detection to safe evacuation guidance"}</h2>
                    <p>CCTV analytics can flag possible smoke or flame. Magic Keys then combines an authorised check, the fire-alarm input and the approved emergency map before any route is displayed.</p>
                  </div>
                  <span className="fire-intelligence-state"><i /> {systemMode === "fire" ? "Alarm workflow active" : "Awaiting commissioning"}</span>
                </div>

                <div className="fire-response-flow" aria-label="Verified fire detection and evacuation workflow">
                  <span><em>1</em><Flame /><span><strong>Possible fire detected</strong><small>Approved camera analytics raises a zone event</small></span></span>
                  <ChevronRight aria-hidden="true" />
                  <span><em>2</em><UserRound /><span><strong>Zone verified</strong><small>Authorised staff and fire-panel input confirm the event</small></span></span>
                  <ChevronRight aria-hidden="true" />
                  <span><em>3</em><MapPin /><span><strong>Unsafe zone excluded</strong><small>Only school-approved evacuation paths are considered</small></span></span>
                  <ChevronRight aria-hidden="true" />
                  <span><em>4</em><MonitorUp /><span><strong>Guidance displayed</strong><small>Staff and student screens show the safe route and assembly point</small></span></span>
                </div>

                <div className="fire-response-guardrail"><ShieldAlert /><span><strong>No camera-only evacuation commands</strong><small>The building fire indicator panel, authorised emergency controller and school emergency management plan remain authoritative.</small></span></div>
              </article>

              <div className="cctv-console-grid">
                <article className="cctv-camera-console">
                  <div className="cctv-panel-heading">
                    <div><span>Authorised camera view</span><strong>{selectedCamera.name}</strong></div>
                    <span className={`cctv-mode is-${systemMode}`}>{systemMode === "normal" ? "Normal mode" : systemMode === "fire" ? "Fire priority" : "Lockdown priority"}</span>
                  </div>

                  <div className="cctv-primary-feed" aria-label={`${selectedCamera.name} camera preview is not connected`}>
                    <div className="cctv-feed-brand"><BrandLogo /><span>Secure camera workspace</span></div>
                    <div className="cctv-feed-empty"><VideoOff /><strong>Live stream unavailable</strong><span>{selectedCamera.coverage}</span><small>Awaiting approved CCTV endpoint and onsite verification</small></div>
                    <div className="cctv-feed-meta"><span><MapPin /> {selectedCamera.zone}</span><span><i /> Not commissioned</span></div>
                  </div>

                  <div className="cctv-camera-selector" aria-label="Camera selection">
                    {cctvCameras.map((camera) => (
                      <button key={camera.id} className={selectedCamera.id === camera.id ? "is-selected" : ""} aria-pressed={selectedCamera.id === camera.id} onClick={() => setSelectedCameraId(camera.id)}>
                        <span className="cctv-thumbnail"><Camera /><i /></span>
                        <span><strong>{camera.name}</strong><small>{camera.zone}</small></span>
                        <em>Offline</em>
                      </button>
                    ))}
                  </div>
                </article>

                <article className="cctv-zone-console">
                  <div className="cctv-panel-heading">
                    <div><span>Emergency operations</span><strong>Site-zone awareness</strong></div>
                    <Badge variant="outline"><MapPin /> Operator view</Badge>
                  </div>

                  <div className="cctv-zone-map">
                    <svg viewBox="0 0 720 470" role="img" aria-label="Concept site-zone map awaiting approved school plans">
                      <title>Concept site-zone map awaiting approved school plans</title>
                      <rect className="map-campus" x="25" y="25" width="670" height="420" rx="16" />
                      <path className="map-path" d="M70 380 H650 M155 70 V400 M555 70 V400" />
                      <rect className="map-building" x="195" y="70" width="145" height="115" rx="5" />
                      <rect className="map-building" x="365" y="70" width="150" height="115" rx="5" />
                      <rect className="map-building" x="195" y="215" width="125" height="125" rx="5" />
                      <rect className="map-building" x="350" y="215" width="165" height="125" rx="5" />
                      <rect className="map-zone" x="332" y="196" width="202" height="164" rx="8" />
                      <circle className="map-camera" cx="145" cy="377" r="13" />
                      <circle className="map-camera" cx="555" cy="377" r="13" />
                      <circle className="map-camera" cx="170" cy="100" r="13" />
                      <circle className="map-camera" cx="540" cy="118" r="13" />
                      <text x="87" y="420">MAIN ENTRY</text>
                      <text x="215" y="130">NORTH WING</text>
                      <text x="390" y="130">SPORTS AREA</text>
                      <text x="215" y="280">ADMINISTRATION</text>
                      <text x="378" y="280">CENTRAL ZONE</text>
                      <text className="map-zone-label" x="381" y="318">MAP REVIEW REQUIRED</text>
                    </svg>
                    <span className="map-disclaimer"><ShieldAlert /> Concept only · replace with the school-approved emergency plan</span>
                  </div>

                  <div className="cctv-zone-status">
                    <div><span><i /> Main entry</span><strong>No feed</strong></div>
                    <div><span><i /> West zone</span><strong>No feed</strong></div>
                    <div><span><i /> North zone</span><strong>No feed</strong></div>
                    <div><span><i /> Central zone</span><strong>Map review</strong></div>
                  </div>

                  <div className={`cctv-evacuation-display ${systemMode === "fire" ? "is-active" : ""}`}>
                    <div><BrandLogo /><span>Projector and staff display</span></div>
                    <span className="evacuation-display-icon"><MonitorUp /></span>
                    <span><small>{systemMode === "fire" ? "Fire priority active" : "Evacuation guidance"}</small><strong>{systemMode === "fire" ? "Awaiting confirmed safe route" : "No route published"}</strong><em>Assembly point and route must match the approved emergency plan.</em></span>
                    <Badge variant="outline">{systemMode === "fire" ? "Hold for verification" : "Not commissioned"}</Badge>
                  </div>
                </article>
              </div>

              <div className="cctv-response-grid">
                <article className="cctv-verification-panel">
                  <div className="cctv-panel-heading"><div><span>Commissioning status</span><strong>Camera and response readiness</strong></div><Eye /></div>
                  <div className="cctv-verification-list">
                    <span><Camera /><span><strong>CCTV endpoints</strong><small>Secure stream addresses and credentials required</small></span><em>Not connected</em></span>
                    <span><MapPin /><span><strong>School zone map</strong><small>Emergency plan and assembly points require approval</small></span><em>Review required</em></span>
                    <span><MonitorUp /><span><strong>Projector guidance</strong><small>No broadcast without verified system feedback</small></span><em>Not commissioned</em></span>
                    <span><ClipboardList /><span><strong>Evidence retention</strong><small>Policy, permissions and retention period required</small></span><em>Not configured</em></span>
                  </div>
                </article>

                <article className="cctv-action-panel">
                  <div className="cctv-action-brand"><BrandLogo /><span>Powered by RJL Commercial</span></div>
                  <ShieldCheck />
                  <h2>Human-confirmed response</h2>
                  <p>CCTV can help authorised staff verify a zone. Sensitive footage and threat locations are never broadcast to students.</p>
                  <div><Button onClick={() => setActiveView("gates")}>Review live gates <ChevronRight /></Button><Button variant="outline" disabled><Maximize2 /> Open selected feed</Button></div>
                </article>
              </div>
            </section>
          )}

          {configurationView && !adminUnlocked && <section className="admin-settings-locked"><span className="admin-lock-icon"><LockKeyhole /></span><h2>Administrator settings</h2><p>{isAdministrator ? "Enter the administrator password to customise system settings, relay controllers and automation." : "An administrator must sign in to change system and relay settings."}</p>{isAdministrator && <AdminSettingsUnlock onUnlocked={settingsUnlocked} />}</section>}
          {(configurationView || activeView === "access") && adminUnlocked && <div className="admin-settings-banner"><span><ShieldCheck /> Administrator configuration unlocked</span><Button variant="outline" onClick={() => void lockSettings()}><LockKeyhole /> Lock settings</Button></div>}

          {activeView === "schedule" && (
            <section className="schedule-workspace">
              <div className="schedule-toolbar"><div><label htmlFor="schedule-gate">Select gate</label><NativeSelect id="schedule-gate" value={selectedScheduleGate.id} onChange={(event) => { setSelectedScheduleGateId(event.target.value); setScheduleDirty(false); }} className="gate-select">{gates.map((gate) => <NativeSelectOption key={gate.id} value={gate.id} disabled={!gate.active}>{gate.name}{gate.active ? "" : " · Inactive"}</NativeSelectOption>)}</NativeSelect></div><div className="schedule-toolbar-actions"><Button variant="outline" disabled={!canOperate} onClick={copyMondayToWeekdays}><Copy /> Copy Monday to weekdays</Button><Button onClick={saveSchedule} disabled={!canOperate || !scheduleDirty || busyAction === `schedule-${selectedScheduleGate.id}`}><Save /> {busyAction === `schedule-${selectedScheduleGate.id}` ? "Saving…" : scheduleDirty ? "Save schedule" : "No unsaved changes"}</Button></div></div>
              <div className="schedule-context schedule-context-plain"><div><h2>{selectedScheduleGate.name}</h2><small>{selectedScheduleGate.area} · {selectedScheduleGate.id}</small><p>{selectedScheduleGate.type}</p></div><div className="timezone-card"><Clock3 /><span><strong>Australia / Melbourne</strong><small>Schedule timezone</small></span></div></div>
              <div className="schedule-graph" aria-label={`${selectedScheduleGate.name} weekly schedule timeline`}>
                <div className="schedule-graph-heading"><div><h3>Weekly operating timeline</h3><p>Scheduled open periods across a full 24-hour day</p></div><span className="timeline-legend"><i /> Open and accessible</span></div>
                <div className="timeline-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
                <div className="timeline-days">
                  {days.map((day) => { const plan = selectedWeek[day]; const width = Math.max(0, timeToPercent(plan.close) - timeToPercent(plan.open)); return <div className={`timeline-day ${plan.enabled ? "is-enabled" : ""}`} key={day}><strong>{day.slice(0, 3)}</strong><div className="timeline-track">{plan.enabled ? <span className="timeline-bar" style={{ left: `${timeToPercent(plan.open)}%`, width: `${width}%` }}><em>{plan.open}–{plan.close}</em></span> : <span className="timeline-closed">No automatic action</span>}</div></div>; })}
                </div>
              </div>
              <div className="week-schedule" role="table" aria-label={`${selectedScheduleGate.name} weekly schedule`}>
                <div className="week-row week-head" role="row"><span>Day</span><span>Automatic schedule</span><span>Open time</span><span>Close time</span><span>Scheduled request</span></div>
                {days.map((day) => { const plan = selectedWeek[day]; return <div className={`week-row ${plan.enabled ? "is-enabled" : ""}`} role="row" key={day}><strong>{day}</strong><label className="schedule-switch"><Switch checked={plan.enabled} disabled={!canOperate} onCheckedChange={(enabled) => updateDay(day, { enabled })} /><span>{plan.enabled ? "Enabled" : "No automatic schedule"}</span></label><label><span className="sr-only">{day} open time</span><Input type="time" value={plan.open} disabled={!canOperate || !plan.enabled} onChange={(event) => updateDay(day, { open: event.target.value })} /></label><label><span className="sr-only">{day} close time</span><Input type="time" value={plan.close} disabled={!canOperate || !plan.enabled} onChange={(event) => updateDay(day, { close: event.target.value })} /></label><span className="daily-result">{plan.enabled ? plan.open && plan.close ? <><CheckCircle2 /> Request open {plan.open}–{plan.close}</> : <><AlertTriangle /> Enter approved times</> : <><LockKeyhole /> No scheduled relay commands</>}</span></div>; })}
              </div>
              <p className="schedule-footnote"><AlertTriangle /> Emergency priority overrides schedules. A gate follows its schedules, bookings and rules only when its controller is commissioned, its safety input is healthy and schedule control is switched on in that controller’s settings.</p>
            </section>
          )}

          {activeView === "automation" && adminUnlocked && (
            <section className="automation-workspace">
              <article className="automation-builder">
                <div className="panel-heading"><div><h2>Build a rule</h2><small>Persistent operating policy</small></div><Zap /></div>
                <div className="automation-form automation-form-typed">
                  <label><span>Rule name</span><Input value={automationName} disabled={!isAdministrator} onChange={(event) => setAutomationName(event.target.value)} placeholder="e.g. Morning drop-off" /></label>
                  <label><span>Gate</span><NativeSelect value={automationGate} disabled={!isAdministrator} onChange={(event) => setAutomationGate(event.target.value)}>{activeGates.map((gate) => <NativeSelectOption key={gate.id} value={gate.id}>{gate.name}</NativeSelectOption>)}</NativeSelect></label>
                  <label><span>Repeat</span><NativeSelect value={automationRepeat} disabled={!isAdministrator} onChange={(event) => setAutomationRepeat(event.target.value as "weekly" | "once")}><NativeSelectOption value="weekly">Every week on…</NativeSelectOption><NativeSelectOption value="once">Once, on a date</NativeSelectOption></NativeSelect></label>
                  {automationRepeat === "weekly"
                    ? <fieldset className="automation-days"><legend>Days</legend>{days.map((day) => <label key={day} className={automationDays.includes(day) ? "is-on" : ""}><input type="checkbox" disabled={!isAdministrator} checked={automationDays.includes(day)} onChange={(event) => setAutomationDays((current) => event.target.checked ? days.filter((item) => item === day || current.includes(item)) : current.filter((item) => item !== day))} />{day.slice(0, 3)}</label>)}</fieldset>
                    : <label><span>Date</span><Input type="date" value={automationDate} disabled={!isAdministrator} onChange={(event) => setAutomationDate(event.target.value)} /></label>}
                  <label><span>Hold open from</span><Input type="time" value={automationOpen} disabled={!isAdministrator} onChange={(event) => setAutomationOpen(event.target.value)} /></label>
                  <label><span>Release at</span><Input type="time" value={automationClose} disabled={!isAdministrator} onChange={(event) => setAutomationClose(event.target.value)} /></label>
                  <Button onClick={addAutomation} disabled={!isAdministrator || busyAction === "add-automation"}><Plus /> {busyAction === "add-automation" ? "Saving…" : "Add automation rule"}</Button>
                </div>
                <p className="automation-note"><ShieldCheck /> Rules run through the same engine as Gate schedules and appear on the School scheduler. Fire / evacuation always overrides every rule. A gate only moves once its controller is commissioned and its safety input is healthy.</p>
              </article>

              <article className="automation-rules">
                <div className="view-panel-heading"><div><h2>Configured rules</h2><small>{automations.filter((rule) => rule.enabled).length} enabled · {automations.length} configured</small></div><Badge variant="outline"><Workflow /> {automations.filter((rule) => rule.kind === "gate_window").length} automated</Badge></div>
                <div className="rule-list">
                  {automations.length === 0 && <div className="activity-empty"><Workflow /><h3>No automation rules configured</h3><p>Add only a reviewed and approved rule. Storing a rule does not claim that physical integration is commissioned.</p></div>}
                  {automations.map((rule) => <div className={`rule-row ${rule.enabled ? "is-enabled" : ""}`} key={rule.id}><span className="rule-icon"><Zap /></span><div className="rule-copy"><strong>{rule.name}{rule.kind !== "gate_window" && <span className="rule-kind-note">Note only · not automated</span>}</strong><span><em>WHEN</em> {rule.trigger}</span><span><em>THEN</em> {rule.action}</span></div><div className="rule-state"><small>{rule.enabled ? "Enabled" : "Paused"}</small><Switch checked={rule.enabled} disabled={!isAdministrator} onCheckedChange={(enabled) => toggleAutomation(rule.id, enabled)} /></div><button className="rule-delete" disabled={!isAdministrator} aria-label={`Delete ${rule.name}`} onClick={() => deleteAutomation(rule.id)}><Trash2 /></button></div>)}
                </div>
              </article>
            </section>
          )}

          {activeView === "access" && <>
            <UserProfileEditor ownProfile={userProfile} adminUnlocked={adminUnlocked} isAdministrator={isAdministrator} onUnlock={() => setAdminUnlockOpen(true)} onSaved={profileSaved} />
            {isAdministrator && <PortalAccountsManager />}
            <section className="identity-layout"><article className="identity-card"><div className="identity-card-head"><span><KeyRound /></span><div><h2>Signed-in operator</h2><small>Magic Keys server-verified identity</small></div></div><div className="identity-profile"><Avatar size="lg"><AvatarImage src={profileImage} alt="Operator profile" /><AvatarFallback>{initials(displayName)}</AvatarFallback><AvatarBadge /></Avatar><div><strong>{displayName}</strong><span>{user.email}</span></div><Badge><ShieldCheck /> Authenticated</Badge></div><div className="identity-rows"><div><span>Access role</span><strong>{isAdministrator ? "System administrator" : canOperate ? "Authorised operator" : "View-only operator"}</strong></div><div><span>Managed site</span><strong>Balwyn High School</strong></div><div><span>Session</span><strong>Signed, HTTP-only, 8-hour maximum</strong></div><div><span>Audit</span><strong>Commands and changes retained centrally</strong></div></div></article><article className="permissions-card"><div className="panel-heading"><div><h2>Operator permissions</h2><small>Current role</small></div><ShieldCheck /></div><div className="permission-list"><span><CheckCircle2 /> View physical gate feedback</span>{canOperate && <span><CheckCircle2 /> Queue authorised relay commands</span>}{isAdministrator && <span><CheckCircle2 /> Manage schedules after password verification</span>}{isAdministrator && <span><CheckCircle2 /> Issue emergency gate responses</span>}{isAdministrator && <span><CheckCircle2 /> Configure controllers and system policy</span>}<span><CheckCircle2 /> Review and export the audit trail</span></div><p>Gate-specific roles, a second emergency approver and school identity integration can be added before final production handover.</p></article></section>

            <section className="controller-commissioning"><div className="view-panel-heading"><div><h2>Separate controller commissioning</h2><small>Sensor-equipped controller path · separate from the ACB-004 open-only trigger</small></div><Badge variant="outline"><Network /> {commissionedCount} commissioned · {credentialCount} issued</Badge></div>{controllerCredential && <div className="credential-issued" role="status"><ShieldCheck /><span><strong>{controllerCredential.gateId} interface credential ready</strong><small>Transfer it once to the approved Compass interface gateway. It will be removed from this screen after download.</small></span><Button onClick={downloadControllerCredential}><Download /> Download setup file</Button><Button variant="ghost" onClick={() => setControllerCredential(null)}>Close</Button></div>}<div className="controller-list">{activeGates.map((gate) => { const runtime = runtimeFor(gate); return <article key={gate.id}><span className={`controller-state-dot is-${runtime?.controllerState ?? "uncommissioned"}`} /><span><strong>{gate.name}</strong><small>{gate.id} · {runtime?.commissioned ? runtime.controllerState : runtime?.credentialIssued ? "interface credential issued · awaiting verified Compass output and position feedback" : "Compass relay output not mapped"}{runtime?.lastSeen ? ` · last contact ${activityTime(runtime.lastSeen)}` : ""}</small></span><span className="controller-safety">{runtime?.controllerState === "online" && runtime.safetyOk === true ? <><ShieldCheck /> Current safety healthy</> : runtime?.safetyOk === false ? <><AlertTriangle /> Safety fault</> : <><Radio /> No current safety feedback</>}</span><Button variant="outline" disabled={!isAdministrator || busyAction === `provision-${gate.id}`} onClick={() => provisionController(gate.id)}>{busyAction === `provision-${gate.id}` ? "Issuing…" : runtime?.credentialIssued ? "Rotate credential" : "Issue credential"}</Button></article>; })}</div><p className="module-disclaimer">The existing Compass ACB-004 open-only trigger is configured separately and supplies no sensor feedback. This controller list is for the Pi gate controller (one relay contact plus reed switches and a safety input); it must not be used to infer ACB-004 position or commissioning status.</p></section>
          </>}

          {activeView === "activity" && <section className="activity-panel"><div className="view-panel-heading"><div><h2>Permanent activity record</h2><small>Operator requests, settings and controller acknowledgements</small></div><div className="activity-heading-actions"><Badge variant="outline"><UserRound /> {user.displayName}</Badge><Button variant="outline" disabled={!activity.length} onClick={exportActivity}><Download /> Export CSV</Button></div></div>{activity.length === 0 ? <div className="activity-empty"><Activity /><h3>No activity recorded yet</h3><p>Authorised commands, controller acknowledgements, automation changes and schedule saves will appear here.</p></div> : <div className="activity-list">{activity.map((record) => <article key={record.id}><span className="activity-record-icon"><Activity /></span><div><strong>{record.action}</strong><p>{record.detail}</p><small>{record.actorName} · {record.category}</small></div><time>{activityTime(record.createdAt)}</time></article>)}</div>}</section>}

          {activeView === "guidance" && adminUnlocked && advancedFeaturesEnabled && <section className="dynamic-guidance-workspace">
            <div className="guidance-command-header"><div><small>Dynamic Emergency Guidance</small><h2>Verified directions, updated as conditions change</h2><p>The portal can prepare a guidance preview from confirmed hazards, available exits and the school’s approved route library. A trained incident controller must verify it before distribution.</p></div><span className="guidance-commission-state"><i /> Simulation only · not commissioned</span></div>
            <OperationsRoomConcept variant="emergency" />
            <article className={`ptz-tracking-console ${ptzTrackingActive ? "is-tracking" : ""}`}>
              <div className="ptz-tracking-heading"><span><Camera /></span><div><small>AI PTZ camera integration</small><h3>{ptzTrackingActive ? `Tracking simulated ${guidanceIncident === "fire" ? "fire / smoke movement" : guidanceIncident === "security" ? "threat movement" : "hazard movement"}` : "Hazard tracking mesh ready for commissioning"}</h3><p>The required Hikvision TandemVu cameras can hand off a verified hazard between zones, update its last known direction and notify the route engine when a corridor becomes unsafe.</p></div><Button variant={ptzTrackingActive ? "outline" : "default"} onClick={() => setPtzTrackingActive((active) => !active)}>{ptzTrackingActive ? <><VideoOff /> Stop simulation</> : <><Camera /> Run tracking simulation</>}</Button></div>
              <div className="ptz-required-hardware"><ShieldCheck /><span><small>Required threat and fire tracking camera</small><strong>Hikvision DS-2SF8C442MXG1-ELW/26 · 4 MP TandemVu PTZ · 24/7 colour · 42× optical zoom</strong></span><Badge variant="outline">Specified</Badge></div>
              <div className="ptz-camera-mesh">
                {["PTZ-01 · Main entry", "PTZ-02 · West zone", "PTZ-03 · Central zone", "PTZ-04 · North zone"].map((camera, index) => {
                  const zoneMatch = camera.includes(guidanceZone.replace(" zone", ""));
                  return <div className={ptzTrackingActive && zoneMatch ? "is-primary" : ptzTrackingActive && index === 2 ? "is-handoff" : ""} key={camera}><span><i /><Camera /></span><strong>{camera}</strong><small>{!ptzTrackingActive ? "Awaiting integration" : zoneMatch ? "Primary hazard view" : index === 2 ? "Predictive handoff ready" : "Monitoring adjacent route"}</small></div>;
                })}
              </div>
              <div className="ptz-safety-boundary"><ShieldCheck /><span><strong>Tracks the hazard—not individual children</strong><small>No facial identification and no camera-only emergency commands. Low confidence, conflicting views or a lost track triggers human verification and conservative route exclusion.</small></span></div>
            </article>
            <div className="guidance-layout">
              <article className="guidance-input-panel">
                <div className="panel-heading"><div><h3>1 · Confirm the incident</h3><small>Authorised staff input required</small></div><ShieldAlert /></div>
                <label><span>Incident type</span><NativeSelect value={guidanceIncident} onChange={(event) => { setGuidanceIncident(event.target.value as "fire" | "security" | "other"); setGuidancePrepared(false); }}><NativeSelectOption value="fire">Possible fire / smoke</NativeSelectOption><NativeSelectOption value="security">Security threat</NativeSelectOption><NativeSelectOption value="other">Other unsafe condition</NativeSelectOption></NativeSelect></label>
                <label><span>Confirmed unsafe zone</span><NativeSelect value={guidanceZone} onChange={(event) => { setGuidanceZone(event.target.value); setGuidancePrepared(false); }}><NativeSelectOption value="Main entry">Main entry</NativeSelectOption><NativeSelectOption value="West zone">West zone</NativeSelectOption><NativeSelectOption value="North zone">North zone</NativeSelectOption><NativeSelectOption value="Central zone">Central zone</NativeSelectOption></NativeSelect></label>
                <div className="guidance-evidence"><div><Camera /><span><strong>AI PTZ hazard track</strong><small>{ptzTrackingActive ? `Simulated location: ${guidanceZone} · handoff active` : "No verified live camera feed connected"}</small></span><Badge variant="outline">{ptzTrackingActive ? "Simulation" : "Unconfirmed"}</Badge></div><div><Flame /><span><strong>Alarm / sensor input</strong><small>No commissioned building-system input</small></span><Badge variant="outline">Unconfirmed</Badge></div><div><UserRound /><span><strong>Incident controller</strong><small>{user.displayName} · administrator</small></span><Badge variant="outline">Signed in</Badge></div></div>
                <Button onClick={() => setGuidancePrepared(true)}><MapPin /> Prepare guidance preview</Button>
              </article>

              <article className={`guidance-route-panel ${guidancePrepared ? "is-prepared" : ""}`}>
                <div className="panel-heading"><div><h3>2 · Exclude danger and compare routes</h3><small>Uses approved route library only</small></div><Workflow /></div>
                <div className="guidance-route-map" aria-label="Demonstration emergency route map">
                  <svg viewBox="0 0 680 330" role="img" aria-label={`Demonstration map with ${guidanceZone} marked unsafe`}>
                    <rect x="28" y="28" width="624" height="274" rx="13" className="guidance-campus" />
                    <rect x="245" y="92" width="190" height="135" rx="8" className="guidance-building" />
                    <rect x="62" y="62" width="132" height="88" rx="8" className={guidanceZone === "West zone" ? "guidance-hazard" : "guidance-zone"} />
                    <rect x="486" y="62" width="132" height="88" rx="8" className={guidanceZone === "North zone" ? "guidance-hazard" : "guidance-zone"} />
                    <rect x="274" y="116" width="132" height="88" rx="8" className={guidanceZone === "Central zone" ? "guidance-hazard" : "guidance-zone"} />
                    <rect x="486" y="218" width="132" height="55" rx="8" className={guidanceZone === "Main entry" ? "guidance-hazard" : "guidance-zone"} />
                    <path d="M340 160 C 405 160, 435 256, 535 246" className={guidancePrepared ? "guidance-safe-route" : "guidance-route-muted"} />
                    <path d="M340 160 C 258 160, 220 105, 128 105" className="guidance-blocked-route" />
                    <circle cx="340" cy="160" r="9" className="guidance-origin" />
                    <circle cx="535" cy="246" r="11" className="guidance-assembly" />
                    <text x="270" y="80">School building</text><text x="72" y="53">West zone</text><text x="496" y="53">North zone</text><text x="495" y="296">Main entry / assembly</text>
                  </svg>
                  <span className="guidance-map-legend"><i className="safe" /> Preview route <i className="blocked" /> Excluded route <i className="hazard" /> Unsafe zone</span>
                </div>
                <div className="guidance-decision"><AlertTriangle /><span><small>{guidancePrepared ? `${guidanceZone} excluded · ${guidanceIncident} scenario${ptzTrackingActive ? " · PTZ track updating" : ""}` : "Awaiting incident confirmation"}</small><strong>{guidancePrepared ? "Approved Route Set A is the current preview" : "No guidance has been prepared"}</strong><em>{guidancePrepared ? "If the PTZ hazard track enters this route, it is withdrawn and the next school-approved route is presented for verification." : "Choose the incident and confirmed unsafe zone to create a non-live preview."}</em></span></div>
              </article>
            </div>

            <article className="guidance-distribution-panel">
              <div><MonitorUp /><span><small>3 · Authorise and distribute</small><strong>Projectors · staff screens · authorised mobile devices</strong><p>Every screen receives the same timestamped instruction, affected zone and approved assembly point. Guidance is withdrawn or revised when the verified incident state changes.</p></span></div>
              <div className="guidance-distribution-actions"><Badge variant="outline">No live endpoints connected</Badge><Button disabled><ShieldCheck /> Publish verified guidance</Button></div>
            </article>
            <div className="guidance-fallback"><Radio /><span><strong>Uncertainty fallback</strong><small>If the hazard location, route status, connectivity or approval is uncertain, the portal does not publish a route. Screens direct people to follow trained staff, local alarms and the school’s approved emergency procedure.</small></span></div>
            <OperationsRoomConcept variant="projector" />
          </section>}

          {activeView === "safety" && <section className={`safety-access-gate ${!advancedFeaturesEnabled ? "is-locked" : ""}`} aria-label="School emergency safety protocol">
            <div className="school-safety-protocol" aria-hidden={!advancedFeaturesEnabled || undefined} inert={!advancedFeaturesEnabled}>
            <div className="safety-protocol-lead"><span><ShieldAlert /></span><div><small>Child safety is the controlling requirement</small><h2>School emergency safety protocol</h2><p>Magic Keys supports trained staff; it does not replace the school Emergency Management Plan, the fire indicator panel, emergency services, onsite judgement or physical emergency controls.</p></div><Badge variant="outline">Approval & commissioning required</Badge></div>
            <div className="safety-principles">
              <article><span>01</span><ShieldCheck /><div><strong>Named human authority</strong><p>Only the school’s authorised incident controller can activate, change or clear an emergency mode. Staff call Triple Zero when required.</p></div></article>
              <article><span>02</span><Radio /><div><strong>Independent manual fallback</strong><p>Physical alarms, keys, releases and local controls remain usable if this portal, power, internet, CCTV or a controller is unavailable.</p></div></article>
              <article><span>03</span><Camera /><div><strong>No camera-only decisions</strong><p>CCTV analytics may flag a possible threat, smoke or flame, but cannot declare an emergency or publish an evacuation route without authorised verification.</p></div></article>
              <article><span>04</span><Fence /><div><strong>Movement is locally protected</strong><p>Safety beams, edges, loops, obstruction sensing and gate-area supervision remain authoritative. A fault blocks the relay command.</p></div></article>
              <article><span>05</span><MonitorUp /><div><strong>Only approved guidance</strong><p>Projectors and staff screens show routes and assembly points taken from the current school-approved emergency plan—not a route invented live by software.</p></div></article>
              <article><span>06</span><ClipboardList /><div><strong>Test, record and review</strong><p>Every command, acknowledgement, failure and override is logged. Term drills, monthly checks and post-incident reviews require named sign-off.</p></div></article>
            </div>
            <div className="safety-stop-rule"><AlertTriangle /><div><strong>Stop rule</strong><p>If information conflicts, a safety input is unhealthy, confirmation is missing, or the real-world condition is uncertain: stop automation, use the approved manual procedure and follow authorised staff and emergency-service directions.</p></div></div>
            <div className="safety-security-row"><div><KeyRound /><span><strong>Sign in with Google</strong><small>Google’s signed identity token is verified on the Magic Keys server. Only approved operator email addresses can create a portal session.</small></span></div><div><Users /><span><strong>Least-privilege access</strong><small>Emergency commands, overrides and configuration require an authorised administrator and are audit logged.</small></span></div></div>
            <p className="safety-commissioning-note">Draft operational framework for joint review by Balwyn High School leadership, its emergency-management advisers, fire-safety contractor, IT/privacy representatives and RJL. No integration should be relied upon for life safety until documented testing, training and written acceptance are complete.</p>
            </div>
            {!advancedFeaturesEnabled && <div className="safety-access-overlay">
              <div className="safety-access-card">
                <span className="safety-access-icon" aria-hidden="true"><LockKeyhole /></span>
                <h2>Please contact RJL for access.</h2>
                <Button asChild size="lg"><a href={`mailto:info@rjlcommercialgroup.com?subject=${encodeURIComponent("Safety Protocol access — Balwyn High School")}`}>Contact RJL <ChevronRight aria-hidden="true" /></a></Button>
              </div>
            </div>}
          </section>}

          {activeView === "settings" && adminUnlocked && (
            <>
              <section className="plan-summary"><div><span>Current plan</span><h2>{plan?.name ?? "Gate Operations"}</h2><p>{advancedFeaturesEnabled ? "Advanced features included. Connected equipment requires commissioning." : "CCTV, PTZ tracking, emergency guidance and projector broadcasts require an upgrade."}</p></div>{!advancedFeaturesEnabled && <Button onClick={() => setUpgradeOpen(true)}><LockKeyhole /> Upgrade plan <ChevronRight /></Button>}</section>
              <div className="admin-settings-shortcuts"><Button variant="outline" onClick={() => setActiveView("access")}><Network /> Relay controllers</Button><Button variant="outline" onClick={() => setActiveView("schedule")}><CalendarDays /> Operating schedules</Button><Button variant="outline" onClick={() => setActiveView("automation")}><Workflow /> Automation rules</Button></div>
              <CompassWiringReference />
              <section className="settings-layout"><article className="settings-card"><div className="panel-heading"><div><h2>Monitoring</h2><small>Persistent system behaviour · administrator only</small></div><Gauge /></div><label><span><strong>Gate-position monitoring</strong><small>Display independent open and closed inputs</small></span><Switch checked={positionMonitoring} disabled={!isAdministrator} onCheckedChange={(value) => updateSetting({ positionMonitoring: value }, "setting-position")} /></label><label><span><strong>Fault and offline alerts</strong><small>Highlight controllers that stop reporting</small></span><Switch checked={faultAlerts} disabled={!isAdministrator} onCheckedChange={(value) => updateSetting({ faultAlerts: value }, "setting-faults")} /></label><label><span><strong>Australian English announcements</strong><small>{voiceStatusText}</small></span><Switch checked={voiceAnnouncements} disabled={!isAdministrator} onCheckedChange={(value) => updateSetting({ voiceAnnouncements: value }, "setting-voice")} /></label></article><article className="settings-card"><div className="panel-heading"><div><h2>Magic Keys</h2><small>System information</small></div><Power /></div><div className="setting-info"><div><span>Managed site</span><strong>Balwyn High School</strong></div><div><span>Access points</span><strong>{gates.length}</strong></div><div><span>Portal</span><strong className="online-text"><i /> Secure service online</strong></div><div><span>Controllers</span><strong>{onlineCount} online · {commissionedCount} commissioned · {credentialCount} credentials</strong></div><div><span>Position feedback</span><strong>{activeGates.length - unknownCount} of {activeGates.length} active gates confirmed</strong></div><div><span>Emergency integration</span><strong>Not complete until school-approved commissioning</strong></div></div></article></section>
              <section className="settings-layout"><article className="settings-card"><div className="panel-heading"><div><h2>Compass ACB-004 integration</h2><small>Existing school control system · retained</small></div><Network /></div><div className="setting-info"><div><span>Control platform</span><strong>Existing Compass ACB-004 · four doors</strong></div><div><span>Interface method</span><strong>Pi isolated relay · open-only trigger</strong></div><div><span>ACB-004 feedback</span><strong>No live position or safety feedback</strong></div><div><span>Output mapping</span><strong>Awaiting onsite schedule and terminal verification</strong></div><div><span>Command policy</span><strong>Blocked until each output is commissioned</strong></div></div></article><article className="settings-card"><div className="panel-heading"><div><h2>Integration safeguards</h2><small>Required before live relay control</small></div><ShieldCheck /></div><div className="permission-list"><span><CheckCircle2 /> Document each Compass output and served gate</span><span><CheckCircle2 /> Verify NO/NC state and pulse or maintained mode</span><span><CheckCircle2 /> Retain local gate safety and manual controls</span><span><CheckCircle2 /> Confirm independent open and closed feedback</span><span><CheckCircle2 /> Witness normal, fire and lockdown scenarios</span></div></article></section>
              <section className="module-marketplace">
                <div className="module-heading"><div><h2>Platform modules</h2><p>Add capabilities as the school’s operational requirements expand.</p></div><Badge variant="outline">{enabledModules.size} of {platformModules.length} configured</Badge></div>
                <div className="module-list">{platformModules.map((module) => { const Icon = module.icon; const locked = module.key === "video" && !advancedFeaturesEnabled; const enabled = !locked && enabledModules.has(module.key); return <article className={`module-row ${enabled ? "is-enabled" : ""}`} key={module.key}><span className="module-icon"><Icon /></span><div><strong>{module.name}</strong><p>{module.description}</p></div><span className="module-status"><i />{module.core ? "Core service" : locked ? "Upgrade required" : enabled ? "Enabled in portal" : "Available"}</span><Button variant={enabled ? "outline" : "default"} disabled={!isAdministrator || Boolean(module.core) || busyAction === `module-${module.key}`} onClick={() => toggleModule(module)}>{locked ? <><LockKeyhole /> Upgrade plan</> : module.core ? "Active" : enabled ? "Disable" : "Enable"}</Button></article>; })}</div>
                <p className="module-disclaimer">Enabling a portal module records the approved configuration only. Camera, intercom, alarm and projector functions will not display as active until their real interfaces provide confirmation.</p>
              </section>
            </>
          )}
        </div>
      </SidebarInset>

      <Sheet open={adminUnlockOpen} onOpenChange={setAdminUnlockOpen}>
        <SheetContent className="admin-unlock-sheet"><SheetHeader><SheetTitle>Unlock administrator settings</SheetTitle><SheetDescription>Verify your password before changing relay or system configuration.</SheetDescription></SheetHeader>{adminUnlockOpen && <AdminSettingsUnlock onUnlocked={settingsUnlocked} />}</SheetContent>
      </Sheet>

      <Sheet open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <SheetContent className="plan-upgrade-sheet sm:max-w-[500px]">
          <SheetHeader>
            <SheetTitle>Bring Magic Keys Advanced to your school</SheetTitle>
            <SheetDescription>Start with a guided demonstration. See how cameras, zone awareness and classroom guidance could fit Balwyn’s needs.</SheetDescription>
          </SheetHeader>
          <div className="plan-upgrade-sheet-body">
            <BrandLogo />
            <span className="plan-lock-label"><LockKeyhole /> Current plan: {plan?.name ?? "Gate Operations"}</span>
            <h3>Magic Keys Advanced</h3>
            <ul><li><Camera /><span><strong>CCTV, PTZ & zone awareness</strong><small>A shared view of camera events and the areas that need attention.</small></span></li><li><MapPin /><span><strong>Dynamic Emergency Guidance</strong><small>Turn an authorised response into clear, location-specific guidance.</small></span></li><li><MonitorUp /><span><strong>Classroom & staff screens</strong><small>Make the approved message visible where people need it.</small></span></li></ul>
            <div className="upgrade-steps"><span><strong>1. Explore</strong> — a demonstration with your school’s decision-makers.</span><span><strong>2. Tailor</strong> — review equipment, coverage and the proposed scope.</span><span><strong>3. Activate</strong> — confirm the plan, commissioning and staff handover.</span></div>
            <p>RJL will provide a tailored proposal and confirm availability, pricing and the integration work required before activation.</p>
            {isAdministrator ? <Button asChild size="lg"><a href={`mailto:info@rjlcommercialgroup.com?subject=${encodeURIComponent("Magic Keys Advanced demonstration & proposal — Balwyn High School")}&body=${encodeURIComponent(`Hello RJL,\n\nWe would like to explore Magic Keys Advanced for Balwyn High School. Please arrange a demonstration of CCTV/PTZ and zones, Dynamic Emergency Guidance, and classroom/projector displays.\n\nPlease also provide a tailored proposal covering availability, pricing, equipment integration, commissioning and staff handover.\n\n${user.displayName}\n${user.email}`)}`}>Email RJL for a demonstration <ChevronRight /></a></Button> : <p className="plan-activation-note">Invite your school’s portal administrator to arrange a demonstration and tailored proposal with RJL.</p>}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selectedGate)} onOpenChange={(open) => !open && setSelectedGate(null)}>
        <SheetContent className="gate-sheet sm:max-w-[500px]">
          {selectedGate && (() => {
            const runtime = runtimeFor(selectedGate);
            const status = gateStatus(selectedGate);
            const commandInFlight = ["queued", "dispatched"].includes(runtime?.lastCommandState ?? "idle");
            const canControl = selectedGate.active && canOperate && systemMode === "normal" && runtime?.controllerState === "online" && runtime.safetyOk === true && !commandInFlight && !busyAction;
            if (!selectedGate.active) return <>
              <SheetHeader className="gate-sheet-header"><SheetTitle>{selectedGate.name}</SheetTitle><SheetDescription>{selectedGate.type} · {selectedGate.area}</SheetDescription></SheetHeader>
              <div className="inactive-gate-details"><GateIcon gate={selectedGate} position="inactive" /><span className="gate-activation-badge is-inactive">Inactive</span><h3>Not activated yet</h3><p>This access point is listed for future activation. Gate controls, schedules and indicator lights are off.</p></div>
            </>;
            return <><SheetHeader className="gate-sheet-header"><SheetTitle>{selectedGate.name}</SheetTitle><SheetDescription>{selectedGate.type}</SheetDescription><span className="sheet-overline">{selectedGate.area} · {selectedGate.id}</span></SheetHeader><Tabs defaultValue="control" className="gate-tabs"><TabsList variant="line" className="gate-tabs-list"><TabsTrigger value="control">Control</TabsTrigger><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList><TabsContent value="control" className="sheet-tab-content"><div className="sheet-gate-visual"><GateIcon gate={selectedGate} position={getPosition(selectedGate)} runtime={runtimeFor(selectedGate)} monitoring={positionMonitoring} /><strong>{positionMonitoring ? status.label : "Position monitoring paused"}</strong><span>{positionMonitoring ? status.detail : "Physical feedback is hidden by the current portal setting."}</span></div><div className="command-packet-path" aria-label="Gate command packet path"><span><strong>1 · Portal</strong><small>Authorised request stored</small></span><ChevronRight /><span><strong>2 · Controller</strong><small>Encrypted poll retrieves packet</small></span><ChevronRight /><span><strong>3 · Relay</strong><small>Local safety permits pulse</small></span><ChevronRight /><span><strong>4 · Feedback</strong><small>Limit input confirms result</small></span></div><div className="command-packet-state"><Network /><span><strong>{runtime?.lastCommandId ? `Packet #${runtime.lastCommandId} · ${runtime.lastCommandState}` : "No command packet issued"}</strong><small>{runtime?.lastCommandId ? runtime.lastError || "Physical result remains separate from the requested direction." : "Opening this screen or reviewing a command does not signal the gate."}</small></span></div>{!canControl && <p className="control-blocked-note"><AlertTriangle /> {systemMode !== "normal" ? "Manual controls are blocked by emergency priority." : !canOperate ? "Your current role is view-only and cannot issue relay commands." : commandInFlight ? "A command packet is already awaiting controller or physical confirmation." : !runtime?.commissioned ? "Issue this controller's credential and complete onsite commissioning first." : runtime?.safetyOk !== true ? "Relay commands are blocked until the local safety circuit reports healthy." : "Relay commands are blocked while the controller is offline."}</p>}<div className="sheet-actions"><Button className="open-gate-command" onClick={() => setPendingGateCommand({ gate: selectedGate, position: "open" })} disabled={!canControl}><UnlockKeyhole /> Review open command</Button><Button variant="outline" onClick={() => setPendingGateCommand({ gate: selectedGate, position: "closed" })} disabled={!canControl}><LockKeyhole /> Review close command</Button></div><RemoteOpenPanel key={selectedGate.id} endpoint="/api/doors/open" gateId={selectedGate.id} allowed={canOperate && systemMode === "normal"} /></TabsContent><TabsContent value="schedule" className="sheet-tab-content"><div className="sheet-schedule-summary"><CalendarDays /><h3>Weekly operating schedule</h3><p>{Object.values(schedules[selectedGate.id]).filter((plan) => plan.enabled).length} scheduled days are enabled. Enabled days hold the gate open once its controller is commissioned with schedule control switched on.</p><Button onClick={() => { setSelectedScheduleGateId(selectedGate.id); setSelectedGate(null); setActiveView("schedule"); }}>Edit full schedule <ChevronRight /></Button></div></TabsContent><TabsContent value="details" className="sheet-tab-content"><img className="gate-caution-sign" src="/automatic-gate-caution.webp" alt="Caution: automatic gate. Keep clear." /><div className="identity-rows"><div><span>Asset ID</span><strong>{selectedGate.id}</strong></div><div><span>Controlled area</span><strong>{selectedGate.area}</strong></div><div><span>Gate type</span><strong>{selectedGate.type}</strong></div><div><span>Controller</span><strong>{runtime?.controllerState ?? "uncommissioned"}</strong></div><div><span>Safety input</span><strong>{runtime?.safetyOk === true ? "Healthy" : runtime?.safetyOk === false ? "Fault / blocked" : "No feedback"}</strong></div><div><span>Last physical contact</span><strong>{runtime?.lastSeen ? activityTime(runtime.lastSeen) : "Never"}</strong></div><div><span>Last command packet</span><strong>{runtime?.lastCommandId ? `#${runtime.lastCommandId} · ${runtime.lastCommandState}` : "None issued"}</strong></div></div></TabsContent></Tabs></>;
          })()}
        </SheetContent>
      </Sheet>
      <AlertDialog open={Boolean(pendingGateCommand)} onOpenChange={(open) => !open && setPendingGateCommand(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {pendingGateCommand?.position.toUpperCase()} command?</AlertDialogTitle>
            <AlertDialogDescription>
              This stores a {pendingGateCommand?.position.toUpperCase()} command packet for {pendingGateCommand?.gate.name}. Confirm the gate area is supervised and clear. The assigned controller must authenticate and collect the packet; its local safety circuit can block the relay pulse, and success is recorded only after the independent physical position input confirms it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const command = pendingGateCommand;
                setPendingGateCommand(null);
                if (command) void setGatePosition(command.gate, command.position);
              }}
            >
              Queue {pendingGateCommand?.position.toUpperCase()} command
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(pendingEmergency)} onOpenChange={(open) => !open && setPendingEmergency(null)}>
        <AlertDialogContent className="emergency-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingEmergency === "clear" ? "Clear emergency priority?" : systemMode === pendingEmergency ? `Reissue ${pendingEmergency} gate command packets?` : pendingEmergency === "fire" ? "Issue fire / evacuation gate commands?" : "Issue lockdown gate commands?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEmergency === "clear"
                ? "This clears portal priority only. It does not move any gate or declare the site safe. Gates opened by the fire command can stay held open after this: check each gate and press Close where needed. Confirm every gate and follow the school’s approved all-clear procedure."
                : `${systemMode === pendingEmergency ? "This deliberately reissues" : "This will queue"} ${pendingEmergency === "fire" ? "OPEN" : "CLOSE"} command packets for ${activeGates.length} active gate controllers. The ${gates.length - activeGates.length} inactive access points are excluded. Only ${onlineCount} controllers are currently online and ${commissionedCount} are commissioned. Previously queued packets are superseded; already-collected packets cannot be recalled. Local safety controls and the school’s Emergency Management Plan remain authoritative.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={pendingEmergency === "fire" ? "confirm-fire" : "confirm-lockdown"}
              onClick={() => {
                const action = pendingEmergency;
                setPendingEmergency(null);
                if (action === "clear") void clearEmergency();
                else if (action) void activateEmergency(action);
              }}
            >
              {pendingEmergency === "clear" ? "Clear priority" : pendingEmergency === "fire" ? "Issue OPEN commands" : "Issue CLOSE commands"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="top-right" richColors />
    </SidebarProvider>
  );
}
