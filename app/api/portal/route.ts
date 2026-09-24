import { assertSameOrigin, getAdminSettingsAccess, requireOperator } from "@/lib/portal-auth";
import { resolveEmergencyCommand } from "@/lib/emergency-policy";
import { PROTECTED_SETTINGS_ACTIONS } from "@/lib/protected-settings";
import {
  addAutomationRule,
  clearAuthenticationLockouts,
  clearEmergencyPriority,
  getPortalSnapshot,
  issueControllerToken,
  queueGateCommands,
  removeAutomationRule,
  saveGateSchedule,
  setAutomationRuleState,
  updatePortalSettings,
} from "@/lib/portal-store";
import { ACTIVE_GATES, GATES, type GatePosition, type ModuleKey, type WeekPlan } from "@/lib/portal-model";
import { commandIsInFlight } from "@/lib/controller-safety";
import { PlanUpgradeRequiredError } from "@/lib/portal-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  try {
    return Response.json({ snapshot: await getPortalSnapshot(auth.user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("portal snapshot failed", error);
    return Response.json({ error: "The live operations record is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const auth = await requireOperator(request, "operator");
  if (!auth.user) return auth.response;

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (PROTECTED_SETTINGS_ACTIONS.has(action) && !await getAdminSettingsAccess(request)) {
      return Response.json({ error: "Enter an administrator password to change system or relay settings.", code: "admin_password_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    if (action === "gate_command") {
      const gateId = String(body.gateId ?? "");
      const position = String(body.position ?? "") as GatePosition;
      const gate = GATES.find((candidate) => candidate.id === gateId);
      if (!gate || !["open", "closed"].includes(position)) throw new Error("Invalid gate command.");
      if (!gate.active) return Response.json({ error: "This gate is inactive. Controls are unavailable until activation." }, { status: 403 });
      const current = await getPortalSnapshot(auth.user);
      if (current.systemMode !== "normal") throw new Error("Manual commands are blocked while an emergency mode is active.");
      const runtime = current.gates.find((candidate) => candidate.gateId === gateId);
      if (!runtime?.commissioned) throw new Error("This gate controller has not been commissioned.");
      if (runtime.controllerState !== "online") throw new Error("This gate controller is offline. Use the approved local gate control and investigate the connection.");
      if (runtime.safetyOk !== true) throw new Error("The local safety circuit is not healthy. The relay command was blocked.");
      if (commandIsInFlight(runtime.lastCommandState)) throw new Error("A command packet is already awaiting completion for this gate.");
      await queueGateCommands([gateId], position, auth.user, {
        activityAction: `${gate.name} command queued`,
        activityDetail: `${auth.user.displayName} requested ${position}. The portal is waiting for the controller and physical position feedback.`,
      });
    } else if (action === "emergency") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required for an emergency command.");
      // Server-side policy: fire only, lockdown refused (see lib/emergency-policy.ts).
      const { mode, position } = resolveEmergencyCommand(body.mode);
      await queueGateCommands(ACTIVE_GATES.map((gate) => gate.id), position, auth.user, {
        mode,
        activityAction: "Fire / evacuation gate response issued",
        activityDetail: `${auth.user.displayName} issued ${position} commands to ${ACTIVE_GATES.length} active gate controllers. Completion requires controller acknowledgement and physical position feedback.`,
      });
    } else if (action === "clear_emergency") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to clear emergency priority.");
      // Clearing is idempotent: cancel queued packets immediately rather than
      // loading the full dashboard before the write. Return confirmed state below.
      await clearEmergencyPriority(auth.user);
    } else if (action === "save_schedule") {
      if (!body.week || typeof body.week !== "object") throw new Error("Invalid schedule.");
      await saveGateSchedule(String(body.gateId ?? ""), body.week as WeekPlan, auth.user);
    } else if (action === "add_automation") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to add automation rules.");
      await addAutomationRule({ name: String(body.name ?? ""), trigger: String(body.trigger ?? ""), action: String(body.ruleAction ?? "") }, auth.user);
    } else if (action === "toggle_automation") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to change automation rules.");
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0 || typeof body.enabled !== "boolean") throw new Error("Invalid automation rule.");
      await setAutomationRuleState(id, body.enabled, auth.user);
    } else if (action === "delete_automation") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to remove automation rules.");
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid automation rule.");
      await removeAutomationRule(id, auth.user);
    } else if (action === "update_settings") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to change system settings.");
      const patch = body.patch as Partial<{ positionMonitoring: boolean; faultAlerts: boolean; voiceAnnouncements: boolean; enabledModules: ModuleKey[] }>;
      await updatePortalSettings(patch ?? {}, auth.user);
    } else if (action === "provision_controller") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to provision a controller.");
      const gateId = String(body.gateId ?? "");
      const token = await issueControllerToken(gateId, auth.user);
      return Response.json({ snapshot: await getPortalSnapshot(auth.user), controllerCredential: { gateId, token } }, { headers: { "Cache-Control": "no-store" } });
    } else if (action === "reset_auth_lockouts") {
      if (auth.user.role !== "administrator") throw new Error("Administrator approval is required to reset authentication lockouts.");
      await clearAuthenticationLockouts(auth.user);
    } else {
      return Response.json({ error: "Unsupported portal action." }, { status: 400 });
    }

    return Response.json({ snapshot: await getPortalSnapshot(auth.user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PlanUpgradeRequiredError) {
      return Response.json({ error: error.message, code: "plan_upgrade_required" }, { status: 402, headers: { "Cache-Control": "no-store" } });
    }
    const message = error instanceof Error ? error.message : "The operation could not be completed.";
    console.error("portal operation failed", error);
    const status = message.startsWith("Administrator approval")
      ? 403
      : message.includes("already awaiting")
        ? 409
        : /invalid|unknown|required|blocked|before|not found|not commissioned|not active|offline|safety circuit/i.test(message)
          ? 400
          : 503;
    return Response.json({ error: message }, { status });
  }
}
