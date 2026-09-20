import { CarFront, DoorOpen, Fence } from "lucide-react";

import type {
  AutomationRule,
  DayKey,
  Gate,
  GatePosition,
  GroupKey,
  WeekPlan,
} from "@/lib/portal-types";

export const groupConfig = {
  sports: { name: "Tom Frizza Sports Area", short: "Sports area", icon: Fence },
  staff: { name: "Staff Car Park", short: "Staff car park", icon: CarFront },
  front: { name: "Front of Property", short: "Front boundary", icon: DoorOpen },
} satisfies Record<GroupKey, { name: string; short: string; icon: typeof Fence }>;

export const perimeterForceGateId = "FRONT-PFG01";

export const gates: Gate[] = [
  {
    id: "TF-ENTRY",
    name: "Sports Entry Gate",
    area: "Tom Frizza Sports Area",
    type: "Automated sliding entry gate",
    group: "sports",
    defaultPosition: "open",
  },
  {
    id: "TF-EXIT",
    name: "Sports Exit Gate",
    area: "Tom Frizza Sports Area",
    type: "Automated sliding exit gate",
    group: "sports",
    defaultPosition: "open",
  },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `SCP-B${String(index + 1).padStart(2, "0")}`,
    name: `Staff Boom Gate ${String(index + 1).padStart(2, "0")}`,
    area: "Staff Car Park",
    type: "Automated boom gate",
    group: "staff" as const,
    defaultPosition: index < 4 ? ("open" as const) : ("closed" as const),
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    id: `FRONT-DG${String(index + 1).padStart(2, "0")}`,
    name: `Front Double Gates ${String(index + 1).padStart(2, "0")}`,
    area: "Front of Property",
    type: "Automated double-gate set",
    group: "front" as const,
    defaultPosition: "closed" as const,
  })),
  {
    id: perimeterForceGateId,
    name: "Perimeter Force-Gate",
    area: "Front of Property",
    type: "Reinforced incident-response perimeter force-gate",
    group: "front",
    defaultPosition: "closed",
    forceGate: true,
  },
];

export const days: DayKey[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const totalGates = gates.length;

export function makeWeekPlan(gate: Gate): WeekPlan {
  if (gate.forceGate) {
    return Object.fromEntries(
      days.map((day) => [
        day,
        { enabled: false, open: "00:00", close: "23:59" },
      ]),
    ) as WeekPlan;
  }

  return Object.fromEntries(
    days.map((day) => {
      const weekday = !["Saturday", "Sunday"].includes(day);
      const saturdaySports = day === "Saturday" && gate.group === "sports";
      return [
        day,
        {
          enabled: weekday || saturdaySports,
          open: saturdaySports ? "08:00" : "07:00",
          close:
            saturdaySports ? "18:00" : gate.group === "front" ? "17:00" : "18:00",
        },
      ];
    }),
  ) as WeekPlan;
}

export function makeSchedules() {
  return Object.fromEntries(gates.map((gate) => [gate.id, makeWeekPlan(gate)])) as Record<
    string,
    WeekPlan
  >;
}

export function makeGatePositions() {
  return Object.fromEntries(
    gates.map((gate) => [gate.id, gate.defaultPosition]),
  ) as Record<string, GatePosition>;
}

export const initialAutomations: AutomationRule[] = [
  {
    id: 1,
    name: "School-day opening",
    trigger: "Weekdays at 07:00",
    action: "Open scheduled staff and sports gates",
    enabled: true,
  },
  {
    id: 2,
    name: "After-hours secure",
    trigger: "Daily at 18:05",
    action: "Close and secure all access points",
    enabled: true,
  },
  {
    id: 3,
    name: "Extended-open alert",
    trigger: "Gate open for more than 15 minutes",
    action: "Notify authorised operators",
    enabled: true,
  },
];
