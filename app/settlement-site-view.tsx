"use client";
// One site, two gates. Each ThomastownSwingView keeps its own device, dial-in number and caller list.
import { ShieldCheck } from "lucide-react";
import ThomastownSwingView from "./thomastown-swing-view";
import { SETTLEMENT_GATES, SETTLEMENT_PLAN_NUMBER, SETTLEMENT_SITE_TITLE } from "@/lib/settlement-site";

export default function SettlementSiteView() {
  return (
    <div>
      <section className="gate-condition mb-4" aria-label={SETTLEMENT_SITE_TITLE}>
        <h2 className="m-0 flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-[#FF7A00]" aria-hidden="true" /> {SETTLEMENT_SITE_TITLE}</h2>
        <p className="m-0 mt-2 text-sm text-[#B9CFE2]">Plan {SETTLEMENT_PLAN_NUMBER}. Two gates on this site. Each gate has its own dial-in number and its own caller list.</p>
      </section>
      {SETTLEMENT_GATES.map((gate) => <ThomastownSwingView key={gate.device} device={gate.device} title={gate.label} clientHref={null} />)}
    </div>
  );
}
