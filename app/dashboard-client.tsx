"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Flame,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Map,
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

import { DetectionAlertPanel } from "@/components/DetectionAlertPanel";
import { EvacuationRoutingPanel } from "@/components/EvacuationRoutingPanel";
import { PerimeterGateIcon } from "@/components/PerimeterGateIcon";
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
import { createSyntheticDetectionEvent, processDetectionAlert } from "@/lib/detection-alerts";
import { calculateEvacuationRoutes, markRoutePlanReviewed } from "@/lib/evacuation-routes";
import { buildActivityRecord } from "@/lib/portal-activity";
import {
  days,
  gates,
  groupConfig,
  initialAutomations,
  makeGatePositions,
  makeSchedules,
  makeWeekPlan,
  perimeterForceGateId,
  totalGates,
} from "@/lib/portal-config";
import { loadSentinelFloorPlan } from "@/lib/sentinel-integration";
import type {
  ActivityRecord,
  AlertDecision,
  AlertVerification,
  AutomationRule,
  DayKey,
  DayPlan,
  DetectionEvent,
  Gate,
  GatePosition,
  GroupKey,
  ModuleKey,
  PerimeterGateState,
  PersistedPortalState,
  SystemEventRecord,
  SystemMode,
  ViewKey,
  WeekPlan,
} from "@/lib/portal-types";

const platformModules = [
  {
    key: "mobile",
    name: "Magic Keys mobile credentials",
    description: "Verified operator access and remote gate commands",
    icon: KeyRound,
    core: true,
  },
  {
    key: "video",
    name: "Camera event verification",
    description: "Associate gate activity with camera snapshots and recordings",
    icon: MonitorUp,
  },
  {
    key: "visitor",
    name: "Visitor and contractor access",
    description: "Issue time-limited permissions with approval and expiry",
    icon: UserPlus,
  },
  {
    key: "intercom",
    name: "Intercom and communications",
    description: "Connect gate calls, operator responses and broadcast notices",
    icon: Radio,
  },
  {
    key: "api",
    name: "API and building systems",
    description: "Link alarms, facilities platforms and approved automations",
    icon: Network,
  },
  {
    key: "reporting",
    name: "Compliance reporting",
    description: "Export events, operator actions and scheduled access changes",
    icon: ClipboardList,
  },
] satisfies Array<{
  key: ModuleKey;
  name: string;
  description: string;
  icon: typeof KeyRound;
  core?: boolean;
}>;

type DashboardClientProps = {
  user: { displayName: string; email: string };
  signOutHref?: string;
  onSignOut?: () => void;
};

const viewMeta: Record<ViewKey, { label: string; description: string }> = {
  dashboard: { label: "Dashboard", description: "Live school-wide access overview" },
  gates: {
    label: "Live gates",
    description: `Monitor and control all ${totalGates} automated access points`,
  },
  evacuation: {
    label: "Evacuation routing",
    description:
      "Review sg-pro-sentinel advisory routes before publishing any fire-mode guidance",
  },
  schedule: {
    label: "Gate schedules",
    description: "Set daily opening and closing times for every gate",
  },
  automation: {
    label: "Automation",
    description: "Build operating rules for schedules, gate events and safety inputs",
  },
  access: {
    label: "Access & users",
    description: "Verified Magic Keys operator identity and permissions",
  },
  activity: {
    label: "Activity log",
    description: "Review commands completed during this signed-in session",
  },
  settings: {
    label: "System settings",
    description: "Configure monitoring, alerts and operating behaviour",
  },
};

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function findAustralianMaleVoice(voices: SpeechSynthesisVoice[]) {
  const soundsMale =
    /(william|gordon|lee|jack|james|russell|daniel|oliver|thomas|noah|liam|henry|ethan|male|neural2[- ]?[bd]|wavenet[- ]?[bd]|standard[- ]?[bd])/i;
  return (
    voices.find(
      (voice) =>
        /^en[-_]AU$/i.test(voice.lang) &&
        soundsMale.test(`${voice.name} ${voice.voiceURI}`),
    ) ??
    voices.find(
      (voice) =>
        /^en/i.test(voice.lang) && soundsMale.test(`${voice.name} ${voice.voiceURI}`),
    ) ??
    voices.find((voice) => /^en[-_]AU$/i.test(voice.lang))
  );
}

function timeToPercent(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return ((hours * 60 + minutes) / (24 * 60)) * 100;
}

function makePerimeterStates() {
  return Object.fromEntries(
    gates.filter((gate) => gate.forceGate).map((gate) => [gate.id, "normal"]),
  ) as Record<string, PerimeterGateState>;
}

function GateIcon({
  gate,
  position,
  perimeterState,
}: {
  gate: Gate;
  position: GatePosition;
  perimeterState?: PerimeterGateState;
}) {
  if (gate.forceGate) {
    return <PerimeterGateIcon position={position} state={perimeterState ?? "normal"} />;
  }

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
      <span className="boom-gate-base">
        <i />
      </span>
      <span className="boom-gate-arm">
        <i />
      </span>
      <span className="boom-gate-rest" />
    </span>
  );
}

function SafetyCommand({
  mode,
  active,
  onConfirm,
}: {
  mode: "lockdown" | "fire";
  active: boolean;
  onConfirm: () => void;
}) {
  const lockdown = mode === "lockdown";
  const Icon = lockdown ? ShieldAlert : Flame;
  return (
    <button
      className={`safety-command ${mode}`}
      aria-label={lockdown ? "Activate emergency lockdown" : "Activate fire evacuation mode"}
      aria-pressed={active}
      onClick={onConfirm}
    >
      <span className="safety-command-icon">
        <Icon />
      </span>
      <span>
        <strong>{lockdown ? "LOCKDOWN · CLOSE ALL" : "FIRE ALARM · EVACUATE"}</strong>
        <em>
          {active
            ? "Active now"
            : lockdown
              ? "Secure every automated gate"
              : "Open gates and prepare reviewed evacuation advice"}
        </em>
      </span>
    </button>
  );
}

function EmergencyAlertPanel({
  mode,
  onClear,
  onViewRoutes,
  routeReviewReady,
}: {
  mode: Exclude<SystemMode, "normal">;
  onClear: () => void;
  onViewRoutes: () => void;
  routeReviewReady: boolean;
}) {
  const fire = mode === "fire";
  const Icon = fire ? Flame : ShieldAlert;
  return (
    <section
      className={`emergency-alert-panel ${mode}`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <header>
        <span className="emergency-alert-icon">
          <Icon />
        </span>
        <span>
          <small>Priority mode active</small>
          <strong>
            {fire ? "Fire alarm · all gates opening" : "Lockdown · all gates closing"}
          </strong>
        </span>
        <i className="emergency-alert-pulse" />
      </header>
      <div className="emergency-alert-state">
        <span>
          <Siren />
          <span>
            <strong>Sirens and horns active</strong>
            <small>Campus outputs synchronised</small>
          </span>
        </span>
        <span>
          <Zap />
          <span>
            <strong>{totalGates} gate controllers</strong>
            <small>{fire ? "Opening together" : "Closing together"}</small>
          </span>
        </span>
        {fire && (
          <span>
            <MonitorUp />
            <span>
              <strong>
                {routeReviewReady
                  ? "Evacuation routes reviewed"
                  : "Evacuation suggestions pending review"}
              </strong>
              <small>sg-pro-sentinel advisory mode</small>
            </span>
          </span>
        )}
      </div>
      <p>
        {fire
          ? "Evacuate by the nearest safe exit and follow the school emergency plan."
          : "Move inside, secure the area and await an authorised all-clear."}
      </p>
      <footer>
        {fire && (
          <>
            <Button variant="outline" onClick={onViewRoutes}>
              <Map /> Review routes
            </Button>
            <a href="tel:000">
              <PhoneCall /> Triple Zero (000)
            </a>
          </>
        )}
        <Button variant="outline" onClick={onClear}>
          <RotateCcw /> Authorised all-clear
        </Button>
      </footer>
    </section>
  );
}

export default function DashboardClient({
  user,
  signOutHref = "/",
  onSignOut,
}: DashboardClientProps) {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [systemMode, setSystemMode] = useState<SystemMode>("normal");
  const [gateOverrides, setGateOverrides] = useState<Record<string, GatePosition>>(makeGatePositions);
  const [perimeterStates, setPerimeterStates] =
    useState<Record<string, PerimeterGateState>>(makePerimeterStates);
  const [selectedGate, setSelectedGate] = useState<Gate | null>(null);
  const [selectedScheduleGateId, setSelectedScheduleGateId] = useState(gates[0].id);
  const [schedules, setSchedules] = useState<Record<string, WeekPlan>>(makeSchedules);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEventRecord[]>([]);
  const [detectionEvents, setDetectionEvents] = useState<DetectionEvent[]>([]);
  const [alertVerifications, setAlertVerifications] = useState<AlertVerification[]>([]);
  const [positionMonitoring, setPositionMonitoring] = useState(true);
  const [faultAlerts, setFaultAlerts] = useState(true);
  const [voiceAnnouncements, setVoiceAnnouncements] = useState(true);
  const [gateQuery, setGateQuery] = useState("");
  const [gateGroup, setGateGroup] = useState<"all" | GroupKey>("all");
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey>>(
    () => new Set(["mobile"]),
  );
  const [automations, setAutomations] = useState<AutomationRule[]>(initialAutomations);
  const [automationName, setAutomationName] = useState("");
  const [automationTrigger, setAutomationTrigger] = useState("At a scheduled time");
  const [automationAction, setAutomationAction] = useState("Notify authorised operators");
  const [incidentLocation, setIncidentLocation] = useState("Science Lab");
  const [routesReviewed, setRoutesReviewed] = useState(false);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const voiceModeRef = useRef<"browser" | "recorded" | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const persistenceReadyRef = useRef(false);

  const floorPlan = useMemo(() => loadSentinelFloorPlan(), []);
  const evacuationDraft = useMemo(
    () => calculateEvacuationRoutes(floorPlan, incidentLocation),
    [floorPlan, incidentLocation],
  );
  const evacuationPlan = useMemo(
    () => (routesReviewed ? markRoutePlanReviewed(evacuationDraft) : evacuationDraft),
    [evacuationDraft, routesReviewed],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const prepareAustralianMaleVoice = () => {
      if (voiceModeRef.current === "recorded") return;
      const voice = findAustralianMaleVoice(window.speechSynthesis.getVoices());
      if (voice) selectedVoiceRef.current = voice;
    };
    prepareAustralianMaleVoice();
    window.speechSynthesis.addEventListener("voiceschanged", prepareAustralianMaleVoice);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", prepareAustralianMaleVoice);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/system-state")
      .then(async (response) => response.json())
      .then((payload: { state?: Partial<PersistedPortalState> | null }) => {
        const state = payload.state;
        if (cancelled || !state) return;
        if (state.systemMode) setSystemMode(state.systemMode);
        if (state.gateOverrides && Object.keys(state.gateOverrides).length) {
          setGateOverrides((current) => ({ ...current, ...state.gateOverrides }));
        }
        if (state.perimeterStates && Object.keys(state.perimeterStates).length) {
          setPerimeterStates((current) => ({ ...current, ...state.perimeterStates }));
        }
        if (state.schedules && Object.keys(state.schedules).length) {
          setSchedules((current) => ({ ...current, ...state.schedules }));
        }
        if (state.automations?.length) setAutomations(state.automations);
        if (state.activity?.length) setActivity(state.activity);
        if (state.detectionEvents?.length) setDetectionEvents(state.detectionEvents);
        if (state.alertVerifications?.length) {
          setAlertVerifications(state.alertVerifications);
        }
        if (state.systemEvents?.length) setSystemEvents(state.systemEvents);
      })
      .catch(() => undefined)
      .finally(() => {
        persistenceReadyRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/system-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operator: user.displayName,
          state: {
            systemMode,
            gateOverrides,
            perimeterStates,
            schedules,
            automations,
            activity,
            detectionEvents,
            alertVerifications,
            systemEvents,
          },
        }),
        signal: controller.signal,
      }).catch(() => undefined);
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    activity,
    alertVerifications,
    automations,
    detectionEvents,
    gateOverrides,
    perimeterStates,
    schedules,
    systemEvents,
    systemMode,
    user.displayName,
  ]);

  useEffect(() => {
    if (systemMode === "normal" || typeof window === "undefined") return;

    const speakWarning = () => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const voice = selectedVoiceRef.current ?? findAustralianMaleVoice(synth.getVoices());
      if (voice) selectedVoiceRef.current = voice;

      const message =
        systemMode === "lockdown"
          ? "Warning. Lockdown active. All automation is closing."
          : "Warning. Fire alarm active. All automation is opening. Review evacuation routes now.";
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
  const selectedWeek = schedules[selectedScheduleGate.id] ?? makeWeekPlan(selectedScheduleGate);
  const perimeterGate = gates.find((gate) => gate.id === perimeterForceGateId) ?? null;

  function getPosition(gate: Gate): GatePosition {
    return gateOverrides[gate.id] ?? gate.defaultPosition;
  }

  const openCount = gates.filter((gate) => getPosition(gate) === "open").length;
  const closedCount = gates.length - openCount;

  const groupSummary = (Object.keys(groupConfig) as GroupKey[]).map((group) => {
    const groupGates = gates.filter((gate) => gate.group === group);
    return {
      group,
      total: groupGates.length,
      open: groupGates.filter((gate) => getPosition(gate) === "open").length,
    };
  });

  const filteredGates = useMemo(() => {
    const query = gateQuery.trim().toLowerCase();
    return gates.filter((gate) => {
      const matchesGroup = gateGroup === "all" || gate.group === gateGroup;
      const matchesQuery =
        !query ||
        `${gate.name} ${gate.area} ${gate.id} ${gate.type}`.toLowerCase().includes(query);
      return matchesGroup && matchesQuery;
    });
  }, [gateGroup, gateQuery]);

  function addSystemEvent(
    category: SystemEventRecord["category"],
    mode: SystemMode,
    detail: string,
  ) {
    const event: SystemEventRecord = {
      id: `${category}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      category,
      mode,
      detail,
      timestamp: new Date().toISOString(),
    };
    setSystemEvents((current) => [event, ...current]);
  }

  function addActivity(action: string, detail: string, source?: string) {
    const record = buildActivityRecord(action, detail, { source });
    setActivity((current) => [record, ...current]);
  }

  function pushActivity(records: ActivityRecord[]) {
    setActivity((current) => [...records, ...current]);
  }

  function speakMessage(message: string) {
    if (!voiceAnnouncements || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const synth = window.speechSynthesis;
    const voice = selectedVoiceRef.current ?? findAustralianMaleVoice(synth.getVoices());
    if (voice) selectedVoiceRef.current = voice;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "en-AU";
    utterance.rate = 0.87;
    utterance.pitch = 0.72;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    synth.cancel();
    synth.speak(utterance);
  }

  function announceGateState(position: GatePosition) {
    if (!voiceAnnouncements || typeof window === "undefined") return;
    const preparedVoice =
      selectedVoiceRef.current ??
      ("speechSynthesis" in window ? findAustralianMaleVoice(window.speechSynthesis.getVoices()) : null);

    if (!voiceModeRef.current) voiceModeRef.current = preparedVoice ? "browser" : "recorded";

    if (voiceModeRef.current === "recorded" || !("speechSynthesis" in window)) {
      fallbackAudioRef.current?.pause();
      const audio = new Audio(position === "open" ? "/gate-open-male.mp3" : "/gate-closed-male.mp3");
      fallbackAudioRef.current = audio;
      void audio.play().catch(() => undefined);
      return;
    }

    speakMessage(position === "open" ? "Gate open." : "Gate closed.");
  }

  function announceAllClear() {
    speakMessage("All clear. Emergency ended. Systems have returned to normal operation.");
  }

  function confirmSafetyAction(title: string, detail: string) {
    if (typeof window === "undefined") return true;
    return window.confirm(`${title}\n\n${detail}`);
  }

  function activateEmergency(mode: "lockdown" | "fire", source = "manual emergency command") {
    const label =
      mode === "lockdown" ? "Emergency lockdown activated" : "Fire / evacuation mode activated";

    if (
      !confirmSafetyAction(
        label,
        mode === "lockdown"
          ? "This will close all gates and may deploy the perimeter force-gate."
          : "This will open all standard gates and prepare evacuation routing for review.",
      )
    ) {
      return;
    }

    const emergencyPosition: GatePosition = mode === "fire" ? "open" : "closed";
    setSystemMode(mode);
    setGateOverrides(
      Object.fromEntries(
        gates.map((gate) => [
          gate.id,
          gate.forceGate && perimeterStates[gate.id] === "deployed" ? "closed" : emergencyPosition,
        ]),
      ),
    );
    setActiveView(mode === "fire" ? "evacuation" : "gates");
    addActivity(
      label,
      `${user.displayName} applied the ${source} to all ${totalGates} automated gates, campus sirens and gate horns.`,
    );
    addSystemEvent("mode", mode, `${user.displayName} activated ${mode} from the dashboard.`);
    toast.warning(label, {
      description:
        "All simulated gates, sirens, horns and automation controls are in emergency mode.",
    });
  }

  function clearEmergency() {
    const previous = systemMode;
    setSystemMode("normal");
    setGateOverrides(makeGatePositions());
    setPerimeterStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([gateId, state]) => [
          gateId,
          state === "deployed" ? "reset" : "normal",
        ]),
      ) as Record<string, PerimeterGateState>,
    );
    addActivity(
      "Emergency mode cleared",
      `${user.displayName} returned the system from ${previous} to normal operation.`,
    );
    addSystemEvent("mode", "normal", `${user.displayName} cleared ${previous} mode.`);
    toast.success("All clear · Normal operation restored");
    if (typeof window !== "undefined") window.setTimeout(announceAllClear, 120);
  }

  function setGatePosition(
    gate: Gate,
    position: GatePosition,
    detail = "manual simulation command",
  ) {
    if (systemMode !== "normal" && !gate.forceGate) return;
    setGateOverrides((current) => ({ ...current, [gate.id]: position }));
    addActivity(
      `${gate.name} ${position}`,
      `${user.displayName} used a ${detail}.`,
    );
    toast.success(`${gate.name} set to ${position}`);
    announceGateState(position);
  }

  function updateDay(day: DayKey, patch: Partial<DayPlan>) {
    setSchedules((current) => ({
      ...current,
      [selectedScheduleGate.id]: {
        ...(current[selectedScheduleGate.id] ?? makeWeekPlan(selectedScheduleGate)),
        [day]: {
          ...(current[selectedScheduleGate.id]?.[day] ?? selectedWeek[day]),
          ...patch,
        },
      },
    }));
    setScheduleDirty(true);
  }

  function copyMondayToWeekdays() {
    const monday = selectedWeek.Monday;
    setSchedules((current) => {
      const nextWeek = {
        ...(current[selectedScheduleGate.id] ?? makeWeekPlan(selectedScheduleGate)),
      };
      (["Tuesday", "Wednesday", "Thursday", "Friday"] as DayKey[]).forEach((day) => {
        nextWeek[day] = { ...monday };
      });
      return { ...current, [selectedScheduleGate.id]: nextWeek };
    });
    setScheduleDirty(true);
    toast.success("Monday copied to Tuesday–Friday");
  }

  function saveSchedule() {
    setScheduleDirty(false);
    addActivity(
      "Gate schedule updated",
      `${user.displayName} saved the weekly schedule for ${selectedScheduleGate.name}.`,
    );
    toast.success("Schedule saved", {
      description: `${selectedScheduleGate.name} has been updated in this simulation.`,
    });
  }

  function toggleModule(module: (typeof platformModules)[number]) {
    if (module.core) return;
    const enabling = !enabledModules.has(module.key);
    setEnabledModules((current) => {
      const next = new Set(current);
      if (enabling) next.add(module.key);
      else next.delete(module.key);
      return next;
    });
    const action = enabling ? "added to" : "removed from";
    addActivity(
      `${module.name} ${enabling ? "enabled" : "disabled"}`,
      `${user.displayName} ${action} the demonstration configuration.`,
    );
    toast.success(`${module.name} ${enabling ? "added" : "removed"}`, {
      description: "Demonstration configuration updated.",
    });
  }

  function exportActivity() {
    if (!activity.length) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      "Time,Timestamp,Action,Detail",
      ...activity.map((record) =>
        [record.time, record.timestamp, record.action, record.detail].map(escape).join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }),
    );
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
      toast.error("Name the automation rule", {
        description: "Add a clear name before creating this demonstration rule.",
      });
      return;
    }
    const next: AutomationRule = {
      id: Date.now(),
      name,
      trigger: automationTrigger,
      action: automationAction,
      enabled: true,
    };
    setAutomations((current) => [...current, next]);
    setAutomationName("");
    addActivity(
      "Automation rule added",
      `${user.displayName} created “${name}” in the demonstration configuration.`,
    );
    toast.success("Automation rule added", { description: name });
  }

  function toggleAutomation(id: number, enabled: boolean) {
    const rule = automations.find((candidate) => candidate.id === id);
    setAutomations((current) =>
      current.map((candidate) => (candidate.id === id ? { ...candidate, enabled } : candidate)),
    );
    if (rule) {
      addActivity(
        `Automation ${enabled ? "enabled" : "paused"}`,
        `${user.displayName} updated “${rule.name}”.`,
      );
    }
  }

  function deleteAutomation(id: number) {
    const rule = automations.find((candidate) => candidate.id === id);
    setAutomations((current) => current.filter((candidate) => candidate.id !== id));
    if (rule) {
      addActivity(
        "Automation rule removed",
        `${user.displayName} removed “${rule.name}” from the demonstration configuration.`,
      );
      toast.success("Automation rule removed");
    }
  }

  function queueDetectionAlert(type: "firearm" | "smoke") {
    const location = type === "smoke" ? incidentLocation : "North Corridor";
    const event = createSyntheticDetectionEvent(type, location);
    setDetectionEvents((current) => [event, ...current]);
    addActivity(
      "Detection received",
      `${event.source} reported a ${event.type} event at ${event.incidentLocation} with ${event.confidence.toFixed(2)} confidence.`,
      event.source,
    );
    addSystemEvent("detection", systemMode, `${event.type} alert queued for human review.`);
    toast.warning(`${event.type.toUpperCase()} detection queued`, {
      description: "Operator review is required before any action is taken.",
    });
  }

  function reviewDetection(event: DetectionEvent, decision: AlertDecision) {
    if (
      decision === "confirmed" &&
      !confirmSafetyAction(
        `Confirm ${event.type} detection`,
        "This will record the operator decision and trigger the mapped emergency response.",
      )
    ) {
      return;
    }

    const result = processDetectionAlert({
      detectionEvent: event,
      decision,
      operator: user.displayName,
    });

    setDetectionEvents((current) =>
      current.map((candidate) => (candidate.id === event.id ? result.reviewedEvent : candidate)),
    );
    setAlertVerifications((current) => [result.verification, ...current]);
    pushActivity(result.activity);
    addSystemEvent(
      "detection",
      result.nextMode === "normal" ? systemMode : result.nextMode,
      `${user.displayName} ${decision} the ${event.type} alert at ${event.incidentLocation}.`,
    );

    if (decision !== "confirmed") {
      toast.success(`Detection marked ${decision}`);
      return;
    }

    if (result.nextMode === "lockdown") {
      setPerimeterStates((current) => ({
        ...current,
        [perimeterForceGateId]: result.perimeterState,
      }));
      setGateOverrides(
        Object.fromEntries(
          gates.map((gate) => [
            gate.id,
            gate.id === perimeterForceGateId ? "closed" : "closed",
          ]),
        ),
      );
      setSystemMode("lockdown");
      setActiveView("gates");
      speakMessage("Confirmed weapon alert. Lockdown active. Perimeter force-gate deployed.");
      toast.warning("Confirmed detection triggered lockdown", {
        description: "Perimeter force-gate deployed and all gates secured.",
      });
    }

    if (result.nextMode === "fire") {
      setGateOverrides(
        Object.fromEntries(
          gates.map((gate) => [gate.id, gate.forceGate ? getPosition(gate) : "open"]),
        ),
      );
      setSystemMode("fire");
      setIncidentLocation(event.incidentLocation);
      setActiveView("evacuation");
      speakMessage("Confirmed fire alert. Fire mode active. Review evacuation routes.");
      toast.warning("Confirmed detection triggered fire mode", {
        description: "Standard gates opened and evacuation routes are ready for review.",
      });
    }
  }

  function setPerimeterState(nextState: PerimeterGateState) {
    if (!perimeterGate) return;
    const actionLabel = nextState === "normal" ? "return to normal" : nextState;
    if (
      !confirmSafetyAction(
        `Perimeter force-gate: ${actionLabel}`,
        "This command updates the incident-response state machine and records the action in the audit trail.",
      )
    ) {
      return;
    }

    setPerimeterStates((current) => ({ ...current, [perimeterGate.id]: nextState }));

    if (nextState === "deployed" || nextState === "armed" || nextState === "reset") {
      setGateOverrides((current) => ({ ...current, [perimeterGate.id]: "closed" }));
    } else {
      setGateOverrides((current) => ({
        ...current,
        [perimeterGate.id]: perimeterGate.defaultPosition,
      }));
    }

    addActivity(
      "Perimeter force-gate state updated",
      `${user.displayName} moved ${perimeterGate.name} to ${nextState}.`,
    );
    addSystemEvent("perimeter", systemMode, `${perimeterGate.name} set to ${nextState}.`);
    speakMessage(
      nextState === "deployed"
        ? "Perimeter force-gate deployed."
        : `Perimeter force-gate ${nextState}.`,
    );
    toast.success(`Perimeter gate ${nextState}`);
  }

  function reviewEvacuationRoutes() {
    setRoutesReviewed(true);
    addActivity(
      "Evacuation routes reviewed",
      `${user.displayName} approved advisory evacuation routing for ${incidentLocation}.`,
    );
    addSystemEvent(
      "routing",
      systemMode,
      `${user.displayName} reviewed advisory routes for ${incidentLocation}.`,
    );
    toast.success("Advisory routes marked reviewed");
  }

  function handleIncidentLocationChange(value: string) {
    setRoutesReviewed(false);
    setIncidentLocation(value);
  }

  function navItem(view: ViewKey, Icon: typeof LayoutDashboard, badge?: string) {
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton
          className="portal-nav-button"
          isActive={activeView === view}
          tooltip={viewMeta[view].label}
          onClick={() => setActiveView(view)}
        >
          <Icon />
          <span>{viewMeta[view].label}</span>
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
          const perimeterState = perimeterStates[gate.id];
          return (
            <button
              className={`access-card ${positionMonitoring ? "" : "is-monitoring-paused"} ${gate.forceGate ? "is-perimeter" : ""}`}
              key={gate.id}
              aria-label={`View controls for ${gate.name}`}
              aria-haspopup="dialog"
              onClick={() => setSelectedGate(gate)}
            >
              <span className="access-card-heading">
                <span>
                  <strong>{gate.name}</strong>
                  <small>{gate.area}</small>
                  {gate.forceGate && <em>Perimeter state · {perimeterState}</em>}
                </span>
                <MoreVertical aria-hidden="true" />
              </span>
              <GateIcon gate={gate} position={position} perimeterState={perimeterState} />
              <span className="access-card-footer">
                <span
                  className={`position-label ${positionMonitoring ? `is-${position}` : "is-unknown"}`}
                >
                  <i />
                  {positionMonitoring
                    ? position === "open"
                      ? "Open / unlocked"
                      : "Closed / secured"
                    : "Monitoring paused"}
                </span>
                <span>{gate.id}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <SidebarProvider
      className={`control-portal mode-${systemMode}`}
      style={{ "--sidebar-width": "17.5rem" } as CSSProperties}
    >
      <Sidebar collapsible="offcanvas" className="control-sidebar">
        <SidebarHeader className="portal-sidebar-header">
          <div className="school-sidebar-logo">
            <img src="/balwyn-watermark.png" alt="Balwyn High School crest" />
          </div>
          <div>
            <strong>BALWYN HIGH</strong>
            <span>Magic Keys · RJL</span>
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItem("dashboard", LayoutDashboard)}
                {navItem("gates", UnlockKeyhole, String(totalGates))}
                {navItem(
                  "evacuation",
                  Map,
                  systemMode === "fire" ? String(evacuationPlan.routes.filter((route) => route.status === "safe").length) : undefined,
                )}
                {navItem("schedule", CalendarDays)}
                {navItem("automation", Workflow, String(automations.filter((rule) => rule.enabled).length))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItem("access", Users)}
                {navItem(
                  "activity",
                  ClipboardList,
                  activity.length ? String(activity.length) : undefined,
                )}
                {navItem("settings", Settings2)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <div className="sidebar-system-card">
            <span>
              <Wifi /> System connection
            </span>
            <strong>
              <i /> Secure terminal online
            </strong>
            <small>Balwyn High School · Live simulation</small>
            <small className="voice-status">
              <Volume2 /> Gate voice · {voiceAnnouncements ? "On" : "Off"}
            </small>
          </div>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="operator-footer">
          <Avatar size="lg">
            <AvatarImage src="/operator-avatar.webp" alt="Paul Sutton operator profile" />
            <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
            <AvatarBadge />
          </Avatar>
          <div className="operator-footer-copy">
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
            <small>Authorised operator</small>
          </div>
          {onSignOut ? (
            <button
              type="button"
              className="operator-sign-out"
              onClick={onSignOut}
              aria-label="Sign out of Magic Keys"
            >
              <LogOut />
            </button>
          ) : (
            <a href={signOutHref} target="_top" aria-label="Sign out of Magic Keys">
              <LogOut />
            </a>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="portal-workspace">
        <header className="workspace-header">
          <div className="workspace-location">
            <SidebarTrigger className="sidebar-toggle" />
            <span className="location-logo">
              <img src="/balwyn-watermark.png" alt="" />
            </span>
            <div>
              <small>Managed site</small>
              <strong>Balwyn High School</strong>
            </div>
          </div>
          <div className="workspace-header-right">
            <span className="connection-pill">
              <i /> Encrypted connection
            </span>
            <button
              className="notification-button"
              aria-label="View system alerts"
              onClick={() =>
                toast.info("System alerts summary", {
                  description: `${detectionEvents.filter((event) => event.status === "pending").length} pending detection alerts.`,
                })
              }
            >
              <Bell />
            </button>
            <div className="header-operator">
              <Avatar>
                <AvatarImage
                  src="/operator-avatar.webp"
                  alt="Professional operator avatar placeholder"
                />
                <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
                <AvatarBadge />
              </Avatar>
              <span>
                <strong>{user.displayName}</strong>
                <small>Verified Magic Keys operator</small>
              </span>
            </div>
          </div>
        </header>

        <section className="safety-bar" aria-label="Emergency gate commands">
          <div className="safety-bar-label">
            <ShieldAlert />
            <span>
              <strong>Emergency operations</strong>
              <small>Priority controls</small>
            </span>
          </div>
          <div className="safety-command-grid">
            <SafetyCommand
              mode="lockdown"
              active={systemMode === "lockdown"}
              onConfirm={() => activateEmergency("lockdown")}
            />
            <SafetyCommand
              mode="fire"
              active={systemMode === "fire"}
              onConfirm={() => activateEmergency("fire")}
            />
          </div>
          <div className="command-safety-note">
            <Radio /> Demonstration controls only
          </div>
        </section>

        {systemMode !== "normal" && (
          <EmergencyAlertPanel
            mode={systemMode}
            onClear={clearEmergency}
            onViewRoutes={() => setActiveView("evacuation")}
            routeReviewReady={evacuationPlan.humanReviewed}
          />
        )}

        <div className="workspace-content">
          <div className="workspace-title-row">
            <div>
              <h1>{viewMeta[activeView].label}</h1>
              <span>{viewMeta[activeView].description}</span>
            </div>
            <Badge variant="outline" className="concept-badge">
              <ShieldCheck /> Operational simulation
            </Badge>
          </div>

          {activeView === "dashboard" && (
            <>
              <section className="health-strip" aria-label="Demonstration platform health">
                <div className="health-lead">
                  <span className="health-pulse">
                    <i />
                  </span>
                  <span>
                    <strong>Platform ready</strong>
                    <small>All simulated services available</small>
                  </span>
                </div>
                <div>
                  <Network />
                  <span>
                    <strong>
                      {totalGates} / {totalGates}
                    </strong>
                    <small>Controllers responding</small>
                  </span>
                </div>
                <div>
                  <ShieldCheck />
                  <span>
                    <strong>Ready</strong>
                    <small>Safety inputs</small>
                  </span>
                </div>
                <div>
                  <Workflow />
                  <span>
                    <strong>{automations.filter((rule) => rule.enabled).length} active</strong>
                    <small>Automation rules</small>
                  </span>
                </div>
                <div>
                  <ClipboardList />
                  <span>
                    <strong>Logging</strong>
                    <small>Operator audit trail</small>
                  </span>
                </div>
              </section>
              <section className="summary-grid">
                <article className="summary-card primary-summary">
                  <span>Total access points</span>
                  <strong>{totalGates}</strong>
                  <small>Across three controlled areas plus one perimeter force-gate</small>
                </article>
                <article className="summary-card">
                  <span>Open now</span>
                  <strong className="open-number">{positionMonitoring ? openCount : "—"}</strong>
                  <small>{positionMonitoring ? "Unlocked or held open" : "Position monitoring paused"}</small>
                </article>
                <article className="summary-card">
                  <span>Secured now</span>
                  <strong>{positionMonitoring ? closedCount : "—"}</strong>
                  <small>{positionMonitoring ? "Closed and access controlled" : "Position monitoring paused"}</small>
                </article>
                <article className="summary-card">
                  <span>System state</span>
                  <strong className={`mode-word ${systemMode}`}>
                    {systemMode === "normal"
                      ? "Normal"
                      : systemMode === "fire"
                        ? "Fire"
                        : "Lockdown"}
                  </strong>
                  <small>
                    {systemMode === "normal"
                      ? "Schedules and credentials active"
                      : "Priority command overrides active"}
                  </small>
                </article>
              </section>
              <section className="dashboard-panels">
                <article className="panel area-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Controlled areas</h2>
                      <small>Estate status</small>
                    </div>
                    <Button variant="ghost" onClick={() => setActiveView("gates")}>
                      View all gates <ChevronRight />
                    </Button>
                  </div>
                  <div className="area-list">
                    {groupSummary.map(({ group, total, open }) => {
                      const meta = groupConfig[group];
                      return (
                        <button key={group} onClick={() => { setActiveView("gates"); setGateGroup(group); }}>
                          <span className="area-icon">
                            <meta.icon />
                          </span>
                          <span>
                            <strong>{meta.name}</strong>
                            <small>{total} gates in this area</small>
                          </span>
                          <span className="area-state">
                            <strong>{open} open</strong>
                            <small>{total - open} secured</small>
                          </span>
                          <ChevronRight />
                        </button>
                      );
                    })}
                  </div>
                </article>
                <article className="panel next-schedule-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Schedule</h2>
                      <small>Today · operating plan</small>
                    </div>
                    <CalendarDays />
                  </div>
                  <div className="schedule-highlight">
                    <Clock3 />
                    <div>
                      <strong>07:00 — 18:00</strong>
                      <small>Weekday access window</small>
                      <span>Individual times can be set per gate</span>
                    </div>
                  </div>
                  <Button className="schedule-button" onClick={() => setActiveView("schedule")}>
                    Manage gate schedules <ChevronRight />
                  </Button>
                </article>
              </section>
              <section className="quick-gates-section">
                <div className="section-heading">
                  <div>
                    <h2>Gate controls</h2>
                    <small>Quick access</small>
                  </div>
                  <span>Select a gate to view its status and controls.</span>
                </div>
                {renderGateCards(gates.slice(0, 6))}
              </section>
              <section className="dashboard-response-grid">
                <DetectionAlertPanel
                  detections={detectionEvents}
                  operatorName={user.displayName}
                  activeMode={systemMode}
                  onDecision={reviewDetection}
                  onSimulateDetection={queueDetectionAlert}
                />
                <article className="panel fire-review-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Fire-mode routing</h2>
                      <small>Advisory workflow</small>
                    </div>
                    <Map />
                  </div>
                  <div className="fire-review-copy">
                    <strong>
                      {systemMode === "fire"
                        ? "Suggested routes ready for human review"
                        : "Routing standby"}
                    </strong>
                    <p>
                      sg-pro-sentinel synthetic routing is calculated for {incidentLocation} and only
                      shown after operator review.
                    </p>
                    <Button onClick={() => setActiveView("evacuation")}>
                      Open evacuation routing <ChevronRight />
                    </Button>
                  </div>
                </article>
              </section>
            </>
          )}

          {activeView === "gates" && (
            <section className="view-panel">
              <div className="view-panel-heading">
                <div>
                  <h2>All automated gates</h2>
                  <small>{filteredGates.length} of {totalGates} access points shown</small>
                </div>
                <div className="status-legend">
                  <span className="is-open">
                    <i /> Open / unlocked
                  </span>
                  <span className="is-closed">
                    <i /> Closed / secured
                  </span>
                </div>
              </div>
              {perimeterGate && (
                <article className="perimeter-control-panel">
                  <div>
                    <GateIcon
                      gate={perimeterGate}
                      position={getPosition(perimeterGate)}
                      perimeterState={perimeterStates[perimeterGate.id]}
                    />
                    <span>
                      <strong>{perimeterGate.name}</strong>
                      <small>
                        State machine · {perimeterStates[perimeterGate.id]} · {getPosition(perimeterGate)}
                      </small>
                    </span>
                  </div>
                  <div className="perimeter-control-actions">
                    <Button variant="outline" onClick={() => setPerimeterState("armed")}>
                      Arm
                    </Button>
                    <Button onClick={() => setPerimeterState("deployed")}>Deploy</Button>
                    <Button variant="outline" onClick={() => setPerimeterState("reset")}>
                      Reset
                    </Button>
                    <Button variant="outline" onClick={() => setPerimeterState("normal")}>
                      Normal
                    </Button>
                    <Button variant="outline" onClick={() => setGatePosition(perimeterGate, "open", "manual perimeter override")}>
                      Override open
                    </Button>
                    <Button variant="outline" onClick={() => setGatePosition(perimeterGate, "closed", "manual perimeter override")}>
                      Override closed
                    </Button>
                  </div>
                </article>
              )}
              <div className="gate-toolbar">
                <label className="gate-search">
                  <Search aria-hidden="true" />
                  <span className="sr-only">Search gates</span>
                  <Input
                    value={gateQuery}
                    onChange={(event) => setGateQuery(event.target.value)}
                    placeholder="Search by gate, area or asset ID"
                  />
                </label>
                <label>
                  <span className="sr-only">Filter gates by area</span>
                  <NativeSelect
                    value={gateGroup}
                    onChange={(event) => setGateGroup(event.target.value as "all" | GroupKey)}
                  >
                    <NativeSelectOption value="all">All controlled areas</NativeSelectOption>
                    {(Object.keys(groupConfig) as GroupKey[]).map((group) => (
                      <NativeSelectOption key={group} value={group}>
                        {groupConfig[group].name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              {filteredGates.length ? (
                renderGateCards(filteredGates)
              ) : (
                <div className="gate-empty">
                  <Search />
                  <h3>No gates match this search</h3>
                  <p>Clear the search or choose another controlled area.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGateQuery("");
                      setGateGroup("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </section>
          )}

          {activeView === "evacuation" && (
            <EvacuationRoutingPanel
              floorPlanName={floorPlan.name}
              incidentLocation={incidentLocation}
              routePlan={evacuationPlan}
              isFireMode={systemMode === "fire"}
              onIncidentLocationChange={handleIncidentLocationChange}
              onReviewRoutes={reviewEvacuationRoutes}
            />
          )}

          {activeView === "schedule" && (
            <section className="schedule-workspace">
              <div className="schedule-toolbar">
                <div>
                  <label htmlFor="schedule-gate">Select gate</label>
                  <NativeSelect
                    id="schedule-gate"
                    value={selectedScheduleGate.id}
                    onChange={(event) => {
                      setSelectedScheduleGateId(event.target.value);
                      setScheduleDirty(false);
                    }}
                    className="gate-select"
                  >
                    {gates.map((gate) => (
                      <NativeSelectOption key={gate.id} value={gate.id}>
                        {gate.name} · {gate.area}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="schedule-toolbar-actions">
                  <Button variant="outline" onClick={copyMondayToWeekdays}>
                    <Copy /> Copy Monday to weekdays
                  </Button>
                  <Button onClick={saveSchedule} disabled={!scheduleDirty}>
                    <Save /> {scheduleDirty ? "Save schedule" : "Schedule saved"}
                  </Button>
                </div>
              </div>
              <div className="schedule-context">
                <span>
                  <GateIcon
                    gate={selectedScheduleGate}
                    position={getPosition(selectedScheduleGate)}
                    perimeterState={perimeterStates[selectedScheduleGate.id]}
                  />
                </span>
                <div>
                  <h2>{selectedScheduleGate.name}</h2>
                  <small>
                    {selectedScheduleGate.area} · {selectedScheduleGate.id}
                  </small>
                  <p>{selectedScheduleGate.type}</p>
                </div>
                <div className="timezone-card">
                  <Clock3 />
                  <span>
                    <strong>Australia / Melbourne</strong>
                    <small>Schedule timezone</small>
                  </span>
                </div>
              </div>
              <div
                className="schedule-graph"
                aria-label={`${selectedScheduleGate.name} weekly schedule timeline`}
              >
                <div className="schedule-graph-heading">
                  <div>
                    <h3>Weekly operating timeline</h3>
                    <p>Scheduled open periods across a full 24-hour day</p>
                  </div>
                  <span className="timeline-legend">
                    <i /> Open and accessible
                  </span>
                </div>
                <div className="timeline-axis" aria-hidden="true">
                  <span>00:00</span>
                  <span>06:00</span>
                  <span>12:00</span>
                  <span>18:00</span>
                  <span>24:00</span>
                </div>
                <div className="timeline-days">
                  {days.map((day) => {
                    const plan = selectedWeek[day];
                    const width = Math.max(0, timeToPercent(plan.close) - timeToPercent(plan.open));
                    return (
                      <div className={`timeline-day ${plan.enabled ? "is-enabled" : ""}`} key={day}>
                        <strong>{day.slice(0, 3)}</strong>
                        <div className="timeline-track">
                          {plan.enabled ? (
                            <span
                              className="timeline-bar"
                              style={{
                                left: `${timeToPercent(plan.open)}%`,
                                width: `${width}%`,
                              }}
                            >
                              <em>
                                {plan.open}–{plan.close}
                              </em>
                            </span>
                          ) : (
                            <span className="timeline-closed">Secured all day</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="week-schedule" role="table" aria-label={`${selectedScheduleGate.name} weekly schedule`}>
                <div className="week-row week-head" role="row">
                  <span>Day</span>
                  <span>Automatic schedule</span>
                  <span>Open time</span>
                  <span>Close time</span>
                  <span>Daily result</span>
                </div>
                {days.map((day) => {
                  const plan = selectedWeek[day];
                  return (
                    <div className={`week-row ${plan.enabled ? "is-enabled" : ""}`} role="row" key={day}>
                      <strong>{day}</strong>
                      <label className="schedule-switch">
                        <Switch checked={plan.enabled} onCheckedChange={(enabled) => updateDay(day, { enabled })} />
                        <span>{plan.enabled ? "Enabled" : "Closed all day"}</span>
                      </label>
                      <label>
                        <span className="sr-only">{day} open time</span>
                        <Input
                          type="time"
                          value={plan.open}
                          disabled={!plan.enabled}
                          onChange={(event) => updateDay(day, { open: event.target.value })}
                        />
                      </label>
                      <label>
                        <span className="sr-only">{day} close time</span>
                        <Input
                          type="time"
                          value={plan.close}
                          disabled={!plan.enabled}
                          onChange={(event) => updateDay(day, { close: event.target.value })}
                        />
                      </label>
                      <span className="daily-result">
                        {plan.enabled ? (
                          <>
                            <CheckCircle2 /> Open {plan.open}–{plan.close}
                          </>
                        ) : (
                          <>
                            <LockKeyhole /> Remains secured
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="schedule-footnote">
                <AlertTriangle /> Emergency lockdown, fire / evacuation, and perimeter force-gate
                commands override every normal weekly schedule.
              </p>
            </section>
          )}

          {activeView === "automation" && (
            <section className="automation-workspace">
              <article className="automation-builder">
                <div className="panel-heading">
                  <div>
                    <h2>Build a rule</h2>
                    <small>Demonstration configuration</small>
                  </div>
                  <Zap />
                </div>
                <div className="automation-form">
                  <label>
                    <span>Rule name</span>
                    <Input
                      value={automationName}
                      onChange={(event) => setAutomationName(event.target.value)}
                      placeholder="e.g. Weekend sports access"
                      onKeyDown={(event) => event.key === "Enter" && addAutomation()}
                    />
                  </label>
                  <label>
                    <span>When this happens</span>
                    <NativeSelect
                      value={automationTrigger}
                      onChange={(event) => setAutomationTrigger(event.target.value)}
                    >
                      <NativeSelectOption value="At a scheduled time">
                        At a scheduled time
                      </NativeSelectOption>
                      <NativeSelectOption value="A gate remains open too long">
                        A gate remains open too long
                      </NativeSelectOption>
                      <NativeSelectOption value="A controller goes offline">
                        A controller goes offline
                      </NativeSelectOption>
                      <NativeSelectOption value="An approved safety input activates">
                        An approved safety input activates
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <span className="automation-flow" aria-hidden="true">
                    <Workflow />
                    <i />
                    <ChevronRight />
                  </span>
                  <label>
                    <span>Then perform</span>
                    <NativeSelect
                      value={automationAction}
                      onChange={(event) => setAutomationAction(event.target.value)}
                    >
                      <NativeSelectOption value="Notify authorised operators">
                        Notify authorised operators
                      </NativeSelectOption>
                      <NativeSelectOption value="Open scheduled gates">
                        Open scheduled gates
                      </NativeSelectOption>
                      <NativeSelectOption value="Close and secure all gates">
                        Close and secure all gates
                      </NativeSelectOption>
                      <NativeSelectOption value="Run the configured safety response">
                        Run the configured safety response
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <Button onClick={addAutomation}>
                    <Plus /> Add automation rule
                  </Button>
                </div>
                <p className="automation-note">
                  <ShieldCheck /> Emergency commands, detection verification, and perimeter
                  deployments always take priority over standard automation rules.
                </p>
              </article>

              <article className="automation-rules">
                <div className="view-panel-heading">
                  <div>
                    <h2>Active rules</h2>
                    <small>
                      {automations.filter((rule) => rule.enabled).length} enabled · {automations.length} configured
                    </small>
                  </div>
                  <Badge variant="outline">
                    <Workflow /> Rule engine
                  </Badge>
                </div>
                <div className="rule-list">
                  {automations.map((rule) => (
                    <div className={`rule-row ${rule.enabled ? "is-enabled" : ""}`} key={rule.id}>
                      <span className="rule-icon">
                        <Zap />
                      </span>
                      <div className="rule-copy">
                        <strong>{rule.name}</strong>
                        <span>
                          <em>IF</em> {rule.trigger}
                        </span>
                        <span>
                          <em>THEN</em> {rule.action}
                        </span>
                      </div>
                      <div className="rule-state">
                        <small>{rule.enabled ? "Enabled" : "Paused"}</small>
                        <Switch checked={rule.enabled} onCheckedChange={(enabled) => toggleAutomation(rule.id, enabled)} />
                      </div>
                      <button
                        className="rule-delete"
                        aria-label={`Delete ${rule.name}`}
                        onClick={() => deleteAutomation(rule.id)}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          )}

          {activeView === "access" && (
            <section className="identity-layout">
              <article className="identity-card">
                <div className="identity-card-head">
                  <span>
                    <KeyRound />
                  </span>
                  <div>
                    <h2>Signed-in operator</h2>
                    <small>Magic Keys verified identity</small>
                  </div>
                </div>
                <div className="identity-profile">
                  <Avatar size="lg">
                    <AvatarImage
                      src="/operator-avatar.webp"
                      alt="Professional operator avatar placeholder"
                    />
                    <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
                    <AvatarBadge />
                  </Avatar>
                  <div>
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                  <Badge>
                    <ShieldCheck /> Authenticated
                  </Badge>
                </div>
                <div className="identity-rows">
                  <div>
                    <span>Access role</span>
                    <strong>Authorised operator</strong>
                  </div>
                  <div>
                    <span>Managed site</span>
                    <strong>Balwyn High School</strong>
                  </div>
                  <div>
                    <span>Identity provider</span>
                    <strong>Verified ChatGPT account</strong>
                  </div>
                  <div>
                    <span>Profile image</span>
                    <strong>Professional placeholder</strong>
                  </div>
                  <div>
                    <span>Session security</span>
                    <strong>Encrypted and signed in</strong>
                  </div>
                </div>
              </article>
              <article className="permissions-card">
                <div className="panel-heading">
                  <div>
                    <h2>Operator permissions</h2>
                    <small>Current session</small>
                  </div>
                  <ShieldCheck />
                </div>
                <div className="permission-list">
                  <span>
                    <CheckCircle2 /> View every gate state
                  </span>
                  <span>
                    <CheckCircle2 /> Operate authorised gate controls
                  </span>
                  <span>
                    <CheckCircle2 /> Manage weekly schedules
                  </span>
                  <span>
                    <CheckCircle2 /> Activate emergency commands
                  </span>
                  <span>
                    <CheckCircle2 /> Review AI detections and evacuation routes
                  </span>
                </div>
                <p>Final roles and gate-specific permissions would be agreed with the school during commissioning.</p>
              </article>
            </section>
          )}

          {activeView === "activity" && (
            <section className="activity-panel">
              <div className="view-panel-heading">
                <div>
                  <h2>Current session activity</h2>
                  <small>Authenticated audit trail</small>
                </div>
                <div className="activity-heading-actions">
                  <Badge variant="outline">
                    <UserRound /> {user.displayName}
                  </Badge>
                  <Button variant="outline" disabled={!activity.length} onClick={exportActivity}>
                    <Download /> Export CSV
                  </Button>
                </div>
              </div>
              {activity.length === 0 ? (
                <div className="activity-empty">
                  <Activity />
                  <h3>No commands recorded yet</h3>
                  <p>
                    Emergency commands, manual gate changes, detection reviews, routing approvals and
                    schedule saves completed during this signed-in session will appear here.
                  </p>
                </div>
              ) : (
                <div className="activity-list">
                  {activity.map((record) => (
                    <article key={record.id}>
                      <span className="activity-record-icon">
                        <Activity />
                      </span>
                      <div>
                        <strong>{record.action}</strong>
                        <p>{record.detail}</p>
                      </div>
                      <time>{record.time}</time>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeView === "settings" && (
            <>
              <section className="settings-layout">
                <article className="settings-card">
                  <div className="panel-heading">
                    <div>
                      <h2>Monitoring</h2>
                      <small>System behaviour</small>
                    </div>
                    <Gauge />
                  </div>
                  <label>
                    <span>
                      <strong>Gate-position monitoring</strong>
                      <small>Display live open and closed states</small>
                    </span>
                    <Switch checked={positionMonitoring} onCheckedChange={setPositionMonitoring} />
                  </label>
                  <label>
                    <span>
                      <strong>Fault and offline alerts</strong>
                      <small>Notify authorised administrators</small>
                    </span>
                    <Switch checked={faultAlerts} onCheckedChange={setFaultAlerts} />
                  </label>
                  <label>
                    <span>
                      <strong>Australian male gate voice</strong>
                      <small>Speak once for manual commands; emergency warnings repeat until all-clear</small>
                    </span>
                    <Switch checked={voiceAnnouncements} onCheckedChange={setVoiceAnnouncements} />
                  </label>
                </article>
                <article className="settings-card">
                  <div className="panel-heading">
                    <div>
                      <h2>Magic Keys</h2>
                      <small>System information</small>
                    </div>
                    <Power />
                  </div>
                  <div className="setting-info">
                    <div>
                      <span>Managed site</span>
                      <strong>Balwyn High School</strong>
                    </div>
                    <div>
                      <span>Proposed access points</span>
                      <strong>{totalGates}</strong>
                    </div>
                    <div>
                      <span>Connection</span>
                      <strong className="online-text">
                        <i /> Secure terminal online
                      </strong>
                    </div>
                    <div>
                      <span>Voice profile</span>
                      <strong>Australian male · Repeating emergency warning</strong>
                    </div>
                    <div>
                      <span>Detection policy</span>
                      <strong>Human verification before action</strong>
                    </div>
                    <div>
                      <span>Emergency integration</span>
                      <strong>D1 audit trail + advisory routing</strong>
                    </div>
                  </div>
                </article>
              </section>
              <section className="module-marketplace">
                <div className="module-heading">
                  <div>
                    <h2>Platform modules</h2>
                    <p>Add capabilities as the school’s operational requirements expand.</p>
                  </div>
                  <Badge variant="outline">
                    {enabledModules.size} of {platformModules.length} configured
                  </Badge>
                </div>
                <div className="module-list">
                  {platformModules.map((module) => {
                    const Icon = module.icon;
                    const enabled = enabledModules.has(module.key);
                    return (
                      <article className={`module-row ${enabled ? "is-enabled" : ""}`} key={module.key}>
                        <span className="module-icon">
                          <Icon />
                        </span>
                        <div>
                          <strong>{module.name}</strong>
                          <p>{module.description}</p>
                        </div>
                        <span className="module-status">
                          <i />
                          {module.core ? "Core service" : enabled ? "Added to concept" : "Available"}
                        </span>
                        <Button
                          variant={enabled ? "outline" : "default"}
                          disabled={module.core}
                          onClick={() => toggleModule(module)}
                        >
                          {module.core ? "Active" : enabled ? "Remove" : "Add module"}
                        </Button>
                      </article>
                    );
                  })}
                </div>
                <p className="module-disclaimer">
                  Modules shown are concept options. Final integrations, licensing and hardware compatibility are confirmed during detailed design.
                </p>
              </section>
            </>
          )}
        </div>
      </SidebarInset>

      <Sheet open={Boolean(selectedGate)} onOpenChange={(open) => !open && setSelectedGate(null)}>
        <SheetContent className="gate-sheet sm:max-w-[500px]">
          {selectedGate && (
            <>
              <SheetHeader className="gate-sheet-header">
                <SheetTitle>{selectedGate.name}</SheetTitle>
                <SheetDescription>{selectedGate.type}</SheetDescription>
                <span className="sheet-overline">
                  {selectedGate.area} · {selectedGate.id}
                </span>
              </SheetHeader>
              <Tabs defaultValue="control" className="gate-tabs">
                <TabsList variant="line" className="gate-tabs-list">
                  <TabsTrigger value="control">Control</TabsTrigger>
                  <TabsTrigger value="schedule">Schedule</TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                </TabsList>
                <TabsContent value="control" className="sheet-tab-content">
                  <div className="sheet-gate-visual">
                    <GateIcon
                      gate={selectedGate}
                      position={getPosition(selectedGate)}
                      perimeterState={perimeterStates[selectedGate.id]}
                    />
                    <strong>
                      {positionMonitoring
                        ? getPosition(selectedGate) === "open"
                          ? "Open / unlocked"
                          : "Closed / secured"
                        : "Position monitoring paused"}
                    </strong>
                    <span>
                      {selectedGate.forceGate
                        ? `Perimeter state machine · ${perimeterStates[selectedGate.id]}`
                        : systemMode === "normal"
                          ? "Normal operating control"
                          : "Emergency priority mode overrides manual controls"}
                    </span>
                  </div>
                  <div className="sheet-actions">
                    <Button
                      className="open-gate-command"
                      onClick={() =>
                        setGatePosition(
                          selectedGate,
                          "open",
                          selectedGate.forceGate ? "manual perimeter override" : "manual simulation command",
                        )
                      }
                      disabled={systemMode !== "normal" && !selectedGate.forceGate}
                    >
                      <UnlockKeyhole /> Open gate
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setGatePosition(
                          selectedGate,
                          "closed",
                          selectedGate.forceGate ? "manual perimeter override" : "manual simulation command",
                        )
                      }
                      disabled={systemMode !== "normal" && !selectedGate.forceGate}
                    >
                      <LockKeyhole /> Close gate
                    </Button>
                  </div>
                  {selectedGate.forceGate && (
                    <div className="sheet-perimeter-actions">
                      <Button variant="outline" onClick={() => setPerimeterState("armed")}>
                        Arm
                      </Button>
                      <Button onClick={() => setPerimeterState("deployed")}>Deploy</Button>
                      <Button variant="outline" onClick={() => setPerimeterState("reset")}>
                        Reset
                      </Button>
                      <Button variant="outline" onClick={() => setPerimeterState("normal")}>
                        Normal
                      </Button>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="schedule" className="sheet-tab-content">
                  <div className="sheet-schedule-summary">
                    <CalendarDays />
                    <h3>Weekly operating schedule</h3>
                    <p>
                      {Object.values(schedules[selectedGate.id] ?? makeWeekPlan(selectedGate)).filter((plan) => plan.enabled).length} scheduled days are enabled for this gate.
                    </p>
                    <Button
                      onClick={() => {
                        setSelectedScheduleGateId(selectedGate.id);
                        setSelectedGate(null);
                        setActiveView("schedule");
                      }}
                    >
                      Edit full schedule <ChevronRight />
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="details" className="sheet-tab-content">
                  <div className="identity-rows">
                    <div>
                      <span>Asset ID</span>
                      <strong>{selectedGate.id}</strong>
                    </div>
                    <div>
                      <span>Controlled area</span>
                      <strong>{selectedGate.area}</strong>
                    </div>
                    <div>
                      <span>Gate type</span>
                      <strong>{selectedGate.type}</strong>
                    </div>
                    {selectedGate.forceGate && (
                      <div>
                        <span>Perimeter state</span>
                        <strong>{perimeterStates[selectedGate.id]}</strong>
                      </div>
                    )}
                    <div>
                      <span>Position monitoring</span>
                      <strong>{positionMonitoring ? "Enabled" : "Disabled"}</strong>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Toaster position="top-right" richColors />
    </SidebarProvider>
  );
}
