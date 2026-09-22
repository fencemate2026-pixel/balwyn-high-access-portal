"use client";

import DashboardClient from "../dashboard-client";
import { ACTIVE_GATES, makeSchedules } from "@/lib/portal-model";

export default function QaPreviewPage() {
  const now = new Date(Date.now() - 60_000).toISOString();
  const snapshot = {
    systemMode: "normal" as const,
    gates: ACTIVE_GATES.map((gate, index) => ({
      gateId: gate.id,
      commandedPosition: gate.defaultPosition,
      reportedPosition: (index === 0 ? "open" : "closed") as "open" | "closed",
      controllerState: "online" as const,
      safetyOk: true,
      lastSeen: now,
      lastCommandState: "acknowledged" as const,
      lastCommandId: index + 1,
      lastError: null,
      credentialIssued: true,
      commissioned: true,
    })),
    schedules: makeSchedules(),
    activity: [],
    automations: [],
    settings: { positionMonitoring: true, faultAlerts: true, voiceAnnouncements: false, enabledModules: ["mobile"] as const },
    plan: { tier: "core" as const, name: "Gate Operations", advancedFeatures: false },
    user: { displayName: "Jarrod Alebakis", email: "info@jlcommercialgroup.com", role: "administrator" as const },
    serverTime: now,
  };

  return <DashboardClient user={snapshot.user} initialData={snapshot} />;
}
