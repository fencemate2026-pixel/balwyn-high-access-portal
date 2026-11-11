"use client";
// DEV-ONLY: the dashboard's own shell (SidebarProvider.control-portal, control-sidebar,
// portal-workspace, workspace-header, workspace-content) around the Mildura view so a
// screenshot compares like-for-like with the real dashboard. Static fixture data; actions only show a "preview only" note.
import { Building2, ClipboardList, LayoutDashboard, Settings2, Users } from "lucide-react";
import BrandLogo from "../../brand-logo";
import MilduraSiteView, { type MirrorDetail } from "../../mildura-site-view";
import type { ControlState } from "../../mildura-controls";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator,
} from "@/components/ui/sidebar";

const item = (label: string, Icon: typeof Users, active = false) => (
  <SidebarMenuItem key={label}><SidebarMenuButton className="portal-nav-button" isActive={active}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>
);

export default function PreviewShell({ fixture, controlFixture }: { fixture: MirrorDetail; controlFixture?: ControlState }) {
  return (
    <SidebarProvider className="control-portal mode-normal" style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas" className="control-sidebar">
        <SidebarHeader className="portal-sidebar-header"><div className="magic-sidebar-brand"><BrandLogo tone="dark" /></div></SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup><SidebarGroupLabel>Operations</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{item("Campus overview", LayoutDashboard)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <SidebarGroup><SidebarGroupLabel>Administration</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{item("Access & users", Users)}{item("Activity log", ClipboardList)}{item("System settings", Settings2)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
          <SidebarGroup><SidebarGroupLabel>RJL portals</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{item("Operations portal", Building2)}{item("Mildura Working Men's Club", Building2, true)}{item("Thomastown Body Corp", Building2)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="portal-workspace">
        <header className="workspace-header">
          <div className="workspace-location"><strong>DEV PREVIEW · fixture data</strong></div>
          <div className="workspace-header-right"><span className="connection-pill"><i /> Encrypted connection</span></div>
        </header>
        <div className="workspace-content" data-view="sites">
          <div className="workspace-title-row"><div><h1>RJL portals</h1><span>Owner console · every RJL portal, one login</span></div></div>
          <MilduraSiteView fixture={fixture} controlFixture={controlFixture} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
