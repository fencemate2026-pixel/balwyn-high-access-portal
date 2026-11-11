/**
 * Who may open 337–339 Settlement Road, and only that site.
 * Server-only. Do not import this from a client component.
 * These people are not the portal owner. A password setup link is sent only
 * after the site is live and the owner says to send it.
 */
import type { GdSiteId } from "@/lib/gd-swing-model";
import { SETTLEMENT_GATES } from "@/lib/settlement-site";

const SETTLEMENT_ACCESS_EMAILS = ["joshua.rapa@cva.melbourne", "tracey@aquabaci.com.au"] as const;

export function isSettlementMember(email: string): boolean {
  const value = email.trim().toLowerCase();
  return (SETTLEMENT_ACCESS_EMAILS as readonly string[]).includes(value);
}

export function isSettlementDevice(site: GdSiteId): boolean {
  return SETTLEMENT_GATES.some((gate) => gate.device === site);
}
