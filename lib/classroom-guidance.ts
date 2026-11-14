import type { GuidanceRoute } from "@/app/guidance-projection";

/**
 * The one instruction every classroom screen shows during a fire evacuation.
 * The repo's measured assembly point is the school oval, and the recorded
 * central path is the one to stay off. Distances that belong to a single
 * outdoor example are not copied onto every room.
 */
export const SCHOOL_FIRE_ROUTE: GuidanceRoute = {
  status: "ok",
  origin: "Whole school",
  headline: "Go to the school oval",
  steps: [
    { text: "Leave by the nearest safe exit" },
    { text: "Stay off the central path" },
    { text: "Go to the school oval" },
  ],
  destinationLabel: "Assemble at",
  destination: "School oval",
  avoid: "Do not use the central path",
};

export function classroomDisplay(mode: string | null | undefined): { showing: boolean; route: GuidanceRoute | null } {
  if (mode === "fire") return { showing: true, route: SCHOOL_FIRE_ROUTE };
  return { showing: false, route: null };
}

/** Public classroom payload. Fire includes the route. Every other mode is standby, with no other fields. */
export function classroomPayload(mode: string | null | undefined, updatedAt: string | null) {
  const display = classroomDisplay(mode);
  if (!display.showing || !display.route) return { showing: false as const };
  return { showing: true as const, route: display.route, updatedAt };
}
