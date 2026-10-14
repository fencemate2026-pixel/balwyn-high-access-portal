import type { CommandState, GatePosition, ReportedPosition } from "./portal-model";

export type ControllerCompletionState = "acknowledged" | "failed" | "blocked";

export function heartbeatCompletesCommissioning(position: ReportedPosition, safetyOk: boolean): boolean {
  return safetyOk && (position === "open" || position === "closed");
}

export function commandIsInFlight(state: CommandState): boolean {
  return state === "queued" || state === "dispatched";
}

export function validateControllerAcknowledgement(input: {
  expected: GatePosition;
  state: ControllerCompletionState;
  position: ReportedPosition;
  safetyOk: boolean;
  detail: string | null;
}): { state: ControllerCompletionState; detail: string | null } {
  if (input.state !== "acknowledged") return { state: input.state, detail: input.detail };
  // A CLOSE only releases a hold, so it does not need a healthy safety circuit to be believed; an OPEN does.
  const safetyNeeded = input.expected === "open";
  if ((input.safetyOk || !safetyNeeded) && input.position === input.expected) return { state: "acknowledged", detail: input.detail };
  return {
    state: "failed",
    detail: `Controller acknowledgement rejected: expected ${input.expected} with a healthy safety input; received ${input.position} with safety ${input.safetyOk ? "healthy" : "not healthy"}.`,
  };
}
