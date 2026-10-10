/**
 * Gate fault alerts (System settings > "Fault alerts"), 10 Oct 2026.
 *
 * When a COMMISSIONED gate controller's heartbeat changes from healthy to a
 * reported fault or a blocked safety input, and the Fault alerts setting is on,
 * RJL is emailed: at most one email per gate every 6 hours. The portal already
 * blocks remote commands to that gate until it reports healthy again
 * (app/api/portal/route.ts gate_command checks), so this is a notification,
 * not a control path.
 *
 * Offline detection (a controller that stops reporting at all) needs a
 * scheduled check and is added when the controllers are commissioned.
 *
 * Never throws and is not awaited by the heartbeat, so it can never slow or
 * break a controller's poll.
 */
import { getSql } from "@/db";
import { takeActionSlot } from "@/lib/action-rate-limit";
import { sendRjlAlert } from "@/lib/rjl-alerts";
import { GATES } from "@/lib/portal-model";

const melbourneTime = (date: Date) => new Intl.DateTimeFormat("en-AU", {
  dateStyle: "full", timeStyle: "medium", timeZone: "Australia/Melbourne",
}).format(date);

async function faultAlertsEnabled() {
  const row = await getSql().prepare("SELECT fault_alerts FROM portal_settings WHERE id = 1").first<{ fault_alerts: unknown }>();
  if (!row) return true; // matches the portal default (on)
  return row.fault_alerts === true || Number(row.fault_alerts) === 1;
}

export async function reportGateFault(input: { gateId: string; faultText: string; safetyOk: boolean; now?: Date; fetcher?: typeof fetch }) {
  try {
    if (!await faultAlertsEnabled()) return "disabled";
    if (!await takeActionSlot(`gate-fault:gate:${input.gateId}`, 1, 6 * 3_600_000)) return "throttled";
    const gate = GATES.find((candidate) => candidate.id === input.gateId);
    const name = gate?.name ?? input.gateId;
    const problem = input.faultText || (!input.safetyOk ? "Local safety circuit is not healthy." : "Fault reported.");
    return await sendRjlAlert({
      kind: "gate_fault",
      subject: `Magic Keys: ${name} reported a fault`,
      body: [
        `${name} (${input.gateId}) reported a problem through its gate controller.`,
        "",
        `When: ${melbourneTime(input.now ?? new Date())}`,
        `Reported: ${problem.slice(0, 500)}`,
        `Safety input: ${input.safetyOk ? "healthy" : "NOT healthy (blocked or open circuit)"}`,
        "",
        "Remote commands to this gate are blocked in the portal until the controller reports healthy again.",
        "Check the gate on site. Further fault emails for this gate are held for 6 hours.",
      ].join("\n"),
    }, { fetcher: input.fetcher });
  } catch {
    console.warn("gate_fault_alert_failed", JSON.stringify({ gateId: input.gateId }));
    return "failed";
  }
}
