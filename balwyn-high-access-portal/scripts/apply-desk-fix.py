#!/usr/bin/env python3
"""Patch the live Magic Keys dashboard-client.tsx in place. Run from repo root."""
from pathlib import Path

p = Path("app/dashboard-client.tsx")
if not p.exists():
    raise SystemExit(f"missing {p} — run this from the repo root")

text = p.read_text(encoding="utf-8")
if "LOCKDOWN · CLOSE ACTIVE" not in text:
    if "START LOCKDOWN" in text and "No emergency active" in text:
        print("already patched")
        raise SystemExit(0)
    raise SystemExit("unexpected dashboard-client.tsx — stop")

if 'import GateTile from "./gate-tile";' not in text:
    text = text.replace(
        'import OperationsRoomConcept from "./operations-room-concept";',
        'import OperationsRoomConcept from "./operations-room-concept";\nimport GateTile from "./gate-tile";',
        1,
    )

old_icon = """function GateIcon({ gate, position }: { gate: Gate; position: GateVisualState }) {
  const light = <span className="gate-indicator-light" />;
  if (gate.kind === "single-swing") {
    const open = position === "open";
    return (
      <span className={`access-icon single-gate-visual is-${position}`} aria-hidden="true">
        <img
          key={`${gate.id}-${position}`}
          className="single-gate-image"
          src={open ? "/single-gate-open-transparent.png" : "/single-gate-closed-transparent.png"}
          alt=""
        />
        {light}
      </span>
    );
  }
  if (gate.kind === "double-swing") {
    return (
      <span className={`access-icon double-gate-visual is-${position}`} aria-hidden="true">
        <img className="double-gate-image" src="/double-gate-icon.png" alt="" />
        {light}
        <span className="gate-indicator-light secondary" />
      </span>
    );
  }
  return (
    <span className={`access-icon boom-gate-visual is-${position}`} aria-hidden="true">
      <span className="boom-gate-base"><i /></span>
      <span className="boom-gate-arm"><i /></span>
      <span className="boom-gate-rest" />
    </span>
  );
}"""
new_icon = """function GateIcon({ gate, position }: { gate: Gate; position: GateVisualState }) {
  return <GateTile gate={gate} position={position} />;
}"""
if old_icon not in text:
    raise SystemExit("GateIcon block not found")
text = text.replace(old_icon, new_icon, 1)

old_label = """        <strong>{lockdown ? "LOCKDOWN · CLOSE ACTIVE" : "FIRE / EVACUATION · OPEN ACTIVE"}</strong>
        <em>{!authorised ? "Administrator approval required" : active ? "Priority active · review or reissue packets" : `Review ${lockdown ? "CLOSE" : "OPEN"} commands for ${activeGates.length} active gates`}</em>"""
new_label = """        <strong>{active ? (lockdown ? "LOCKDOWN · ACTIVE" : "FIRE / EVACUATION · ACTIVE") : (lockdown ? "START LOCKDOWN" : "START FIRE / EVACUATION")}</strong>
        <em>{!authorised ? "Administrator approval required" : active ? "Priority active · confirmation required to reissue" : lockdown ? "Queues CLOSE commands · confirmation required" : "Queues OPEN commands · confirmation required"}</em>"""
if old_label not in text:
    raise SystemExit("SafetyCommand labels not found")
text = text.replace(old_label, new_label, 1)

text = text.replace(
    "      className={`safety-command ${mode}`}",
    '      className={`safety-command ${mode}${active ? " is-live" : ""}`}',
    1,
)

old_role = """  const canOperate = user.role === "operator" || user.role === "administrator";
  const isAdministrator = user.role === "administrator";"""
new_role = """  const canOperate = user.role === "operator" || user.role === "administrator";
  const isAdministrator = user.role === "administrator";
  const roleLabel = isAdministrator ? "System administrator" : canOperate ? "Authorised operator" : "View-only operator";"""
if old_role not in text:
    raise SystemExit("role block not found")
text = text.replace(old_role, new_role, 1)

text = text.replace(
    '<small>{userProfile?.jobTitle || (userProfile?.username ? `@${userProfile.username}` : "Verified Magic Keys operator")}</small>',
    "<small>{roleLabel}</small>",
    1,
)
text = text.replace(
    '<small>{isAdministrator ? "System administrator" : canOperate ? "Authorised operator" : "View-only operator"}</small>',
    "<small>{roleLabel}</small>",
    1,
)

old_bar = """          <div className="safety-bar-label"><ShieldAlert /><span><strong>Emergency operations</strong><small>Priority controls</small></span></div>"""
new_bar = """          <div className={`safety-bar-status${systemMode === "normal" ? "" : " is-alert"}`}>
            <i className="status-dot" />
            <span><small>System state</small><strong>{systemMode === "normal" ? "No emergency active" : systemMode === "lockdown" ? "Lockdown active" : "Fire / evacuation active"}</strong></span>
          </div>"""
if old_bar not in text:
    raise SystemExit("safety-bar label not found")
text = text.replace(old_bar, new_bar, 1)

text = text.replace(
    '{navItem("gates", DoorOpen, String(gates.length))}',
    '{navItem("gates", DoorOpen, String(activeGates.length))}',
    1,
)

old_title = """<Badge variant="outline" className="concept-badge"><ShieldCheck /> {operationalReady ? "All controllers ready" : "Commissioning / attention required"}</Badge></div></div>

          {activeView === "dashboard" && ("""
new_title = """<Badge variant="outline" className="concept-badge"><ShieldCheck /> {operationalReady ? "All controllers ready" : "Commissioning / attention required"}</Badge></div></div>
          {activeView === "dashboard" && (
            <div className="desk-service-row">
              <button type="button" onClick={() => { setActiveView("activity"); toast.message("Fault report", { description: "Use the activity log to record the gate, time and fault. Controllers stay amber until a verified heartbeat exists." }); }}>Report a fault</button>
              <span className="service-chip">Next scheduled service<small>Countdown starts after commissioning</small></span>
            </div>
          )}

          {activeView === "dashboard" && ("""
if old_title not in text:
    raise SystemExit("title-row anchor not found")
text = text.replace(old_title, new_title, 1)

if "LOCKDOWN · CLOSE ACTIVE" in text:
    raise SystemExit("CLOSE ACTIVE still present — abort write")
if "START LOCKDOWN" not in text or "No emergency active" not in text:
    raise SystemExit("expected strings missing — abort write")

p.write_text(text, encoding="utf-8", newline="\n")
print("START LOCKDOWN", text.count("START LOCKDOWN"))
print("No emergency active", text.count("No emergency active"))
print("roleLabel", text.count("roleLabel"))
print("GateTile", text.count("GateTile"))
print("CLOSE ACTIVE", text.count("CLOSE ACTIVE"))
print("bytes", p.stat().st_size)
print("ok")
