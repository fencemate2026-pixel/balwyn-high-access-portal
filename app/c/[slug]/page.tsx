import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClientWelcome from "../../client-welcome";
import MacquarieClient from "../../macquarie/macquarie-client";
import "../../macquarie/macquarie.css";
import { clientAppKind } from "@/lib/client-portal";
import { OwnerSiteInputError } from "@/lib/owner-sites-model";
import { OwnerSitesUnavailableError, publicClientCard } from "@/lib/owner-sites-store";
import ClientSite from "./client-site";
import "./client-site.css";

export const dynamic = "force-dynamic";

const MACQUARIE_NAME = "Macquarie Drive, Thomastown";
const robots = { index: false, follow: false };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const kind = clientAppKind(slug);
  if (kind === "macquarie") {
    return { title: `${MACQUARIE_NAME} · Magic Keys`, description: "Resident access for the Macquarie Drive Thomastown sliding gate.", robots };
  }
  if (kind !== "site") return { title: "Magic Keys", robots };
  try {
    const card = await publicClientCard(slug);
    return { title: `${card.name} · Magic Keys`, description: `Client page for ${card.name}.`, robots };
  } catch {
    return { title: "Magic Keys", robots };
  }
}

export default async function ClientPortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kind = clientAppKind(slug);
  if (kind === "invalid") notFound();
  if (kind === "macquarie") {
    return (
      <ClientWelcome siteName={MACQUARIE_NAME}>
        <MacquarieClient />
      </ClientWelcome>
    );
  }
  try {
    const card = await publicClientCard(slug);
    return (
      <ClientWelcome siteName={card.name}>
        <ClientSite name={card.name} state="waiting" slug={slug} />
      </ClientWelcome>
    );
  } catch (error) {
    if (error instanceof OwnerSiteInputError) notFound();
    if (!(error instanceof OwnerSitesUnavailableError)) console.warn("client_portal_page_failed");
    return (
      <ClientWelcome siteName="Magic Keys">
        <ClientSite name="Magic Keys" state="unavailable" slug={slug} />
      </ClientWelcome>
    );
  }
}
