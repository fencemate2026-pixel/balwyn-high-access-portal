/**
 * 337–339 Settlement Road, Thomastown (plan 819859Q).
 * One site, two gates. Each gate keeps its own device id, dial-in number and caller list.
 * Macquarie Drive (thomastown-swing) is a different site and is not in this group.
 * Safe to import from client components: no account emails.
 */
import { SETTLEMENT_DEVICE_ID, SLIDING_DEVICE_ID, type GdSiteId } from "@/lib/gd-swing-model";

export const SETTLEMENT_SITE_ID = "settlement-road";
export const SETTLEMENT_SITE_TITLE = "337 - 339 SETTLEMENT ROAD, THOMASTOWN";
export const SETTLEMENT_PLAN_NUMBER = "819859Q";

export const SETTLEMENT_GATES: readonly { device: GdSiteId; label: string }[] = [
  { device: SETTLEMENT_DEVICE_ID, label: "Swing gate" },
  { device: SLIDING_DEVICE_ID, label: "Sliding gate" },
];
