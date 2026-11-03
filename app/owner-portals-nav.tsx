"use client";
// Owner sidebar: every RJL portal in one list (Balwyn, Thomastown, Mildura), 3 Nov 2026.
// Picking one opens that portal's settings in the main area; nothing leaves this portal.
// Shown only to the verified owner. The list comes from GET /api/owner/sites, which
// re-checks ownership on every request, so hiding this component is presentation, not security.
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { siteHealth } from "@/lib/owner-sites-model";
import type { OwnerSiteLink } from "@/lib/owner-sites-links";

type SiteRow = {
  id: string; slug: string; name: string; config_version: number;
  gd_units: { id: string; last_seen: string | null; applied_version: number; enabled: boolean; lockdown: boolean }[];
};

/** What the sidebar can select: this portal's own dashboard, or an owner site by id (gd_* slug or link id). */
export type OwnerPortalChoice = { kind: "balwyn" } | { kind: "site"; id: string };

const REFRESH_MS = 30_000;

export default function OwnerPortalsNav({ choice, onChoose }: { choice: OwnerPortalChoice | null; onChoose: (next: OwnerPortalChoice) => void }) {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [links, setLinks] = useState<OwnerSiteLink[]>([]);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/owner/sites", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { sites: SiteRow[]; links?: OwnerSiteLink[]; serverTime?: string };
        if (cancelled) return;
        setSites(data.sites); setLinks(data.links ?? []); setFailed(false);
        setNow(Date.parse(data.serverTime ?? "") || Date.now());
      } catch { if (!cancelled) setFailed(true); }
    };
    const kick = setTimeout(load, 0);
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(timer); };
  }, []);

  const externals = links.filter((l): l is Extract<OwnerSiteLink, { kind: "external" }> => l.kind === "external");
  const dotClass = (state: string) => `owner-portal-dot${state ? ` is-${state}` : ""}`;

  return (
    <SidebarMenu aria-label="RJL portals">
      {/* This portal. Active whenever the owner is looking at the normal campus dashboard. */}
      <SidebarMenuItem>
        <SidebarMenuButton className="portal-nav-button" isActive={choice === null || choice.kind === "balwyn"} tooltip="Balwyn High School" onClick={() => onChoose({ kind: "balwyn" })}>
          <Building2 /><span>Balwyn High School</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {(sites ?? []).map((site) => (
        <SidebarMenuItem key={site.id}>
          <SidebarMenuButton className="portal-nav-button" isActive={choice?.kind === "site" && choice.id === site.slug} tooltip={site.name} onClick={() => onChoose({ kind: "site", id: site.slug })}>
            <span className={dotClass(siteHealth(site, now))} aria-hidden="true" /><span>{site.name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {externals.map((link) => (
        <SidebarMenuItem key={link.id}>
          {/* No live status: this site does not report to the portal yet. */}
          <SidebarMenuButton className="portal-nav-button" isActive={choice?.kind === "site" && choice.id === link.id} tooltip={`${link.name} · not linked yet`} onClick={() => onChoose({ kind: "site", id: link.id })}>
            <span className={dotClass("")} aria-hidden="true" /><span>{link.name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {failed && <li className="owner-portal-note" role="status">Other portals are not available right now.</li>}
      <style>{`
        .owner-portal-dot{width:9px;height:9px;border-radius:50%;background:#9aa3b2;flex-shrink:0;display:inline-block}
        .owner-portal-dot.is-ok{background:#0f9d58}.owner-portal-dot.is-warn{background:#f4b400}.owner-portal-dot.is-bad{background:#d93025}
        .owner-portal-note{list-style:none;padding:4px 10px;font-size:12px;opacity:.7}
      `}</style>
    </SidebarMenu>
  );
}
