import { env } from "cloudflare:workers";
import type { ModuleKey, PortalPlan } from "./portal-model";

// Entitlements are managed by RJL in the hosted configuration after an upgrade.
// Browser preferences and administrator module switches cannot grant a plan.
export function getPortalPlan(): PortalPlan {
  const advanced = env.PORTAL_PLAN === "advanced";
  return {
    tier: advanced ? "advanced" : "core",
    name: advanced ? "Magic Keys Advanced" : "Gate Operations",
    advancedFeatures: advanced,
  };
}

export class PlanUpgradeRequiredError extends Error {
  constructor() {
    super("Camera and advanced emergency-guidance features require a plan upgrade. Contact RJL to upgrade your plan.");
    this.name = "PlanUpgradeRequiredError";
  }
}

export function planAllowsModule(module: ModuleKey, plan = getPortalPlan()): boolean {
  return module !== "video" || plan.advancedFeatures;
}

export function assertPlanAllowsModules(modules: ModuleKey[]): void {
  const plan = getPortalPlan();
  if (modules.some((module) => !planAllowsModule(module, plan))) throw new PlanUpgradeRequiredError();
}
