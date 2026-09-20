import { env } from "@/lib/server-env";
import type { ModuleKey, PortalPlan, PortalUser } from "./portal-model";

// Entitlements are managed by RJL in hosted configuration. Verified owner access
// is account-specific; it does not upgrade the school or other operators.
// Browser preferences and administrator module switches cannot grant a plan.
export function getPortalPlan(user?: PortalUser): PortalPlan {
  const ownerAccess = user?.isOwner === true && user.role === "administrator";
  const advanced = ownerAccess || env.PORTAL_PLAN === "advanced";
  return {
    tier: advanced ? "advanced" : "core",
    name: ownerAccess ? "Magic Keys Owner" : advanced ? "Magic Keys Advanced" : "Gate Operations",
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

export function assertPlanAllowsModules(modules: ModuleKey[], user?: PortalUser): void {
  const plan = getPortalPlan(user);
  if (modules.some((module) => !planAllowsModule(module, plan))) throw new PlanUpgradeRequiredError();
}
