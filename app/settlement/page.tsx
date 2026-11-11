import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import SettlementSiteView from "../settlement-site-view";
import { getSessionUser } from "@/lib/portal-auth";
import { isSettlementMember } from "@/lib/settlement-access";
import { SETTLEMENT_PLAN_NUMBER, SETTLEMENT_SITE_TITLE } from "@/lib/settlement-site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${SETTLEMENT_SITE_TITLE} · Magic Keys`,
  description: `Plan ${SETTLEMENT_PLAN_NUMBER}. Swing gate and sliding gate.`,
  robots: { index: false, follow: false },
};

export default async function SettlementPage() {
  const jar = await cookies();
  const header = jar.getAll().map((item) => `${item.name}=${item.value}`).join("; ");
  const user = await getSessionUser(new Request("https://magickeys-balwyn-portal.com/settlement", { headers: { cookie: header } }));
  if (!user) redirect("/login");
  if (user.isOwner !== true && !isSettlementMember(user.email)) notFound();
  return (
    <main className="min-h-screen bg-[#071018] p-4 text-[#F5FBFF] md:p-8">
      <SettlementSiteView />
    </main>
  );
}
