# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary user (inferred from the current brief and interface): authorised Balwyn High School operations staff responsible for daily access control.
- Secondary user (inferred): authorised security or facilities staff responding to incidents and reviewing gate activity.

## Product Purpose

Magic Keys gives authorised operators one secure place to see, schedule and control Balwyn High School's configured automated access points. Success means the operator can understand every gate's reported state at a glance, act on one gate quickly and issue school-wide emergency command packets without ambiguity.

## Positioning

The product combines gate-specific controls, weekly schedules, authenticated operator identity and school-wide emergency actions in one RJL-managed operations console.

## Operating Context

- The operations portal opens with a branded, server-verified operator login for Paul Sutton, then keeps his name and session role visible throughout the dashboard.
- Credentials are verified server-side using a slow password derivation function; the browser receives only a signed, HTTP-only session cookie. Failed attempts are rate-limited and recorded without storing raw network addresses.
- The main workspace covers nine registered access points across Tony Frizza Stadium, Side Entry, Staff Car Park and the Office. Only Tony Frizza Stadium Entry and Side Entry are active; the other seven remain visible and inactive.
- Daily work includes checking reported positions, requesting individual gate movements, managing approved weekly schedules and reviewing the permanent activity record.
- Fire evacuation is the only supported emergency command. It queues OPEN on `ACTIVE_GATES` only; `resolveEmergencyCommand("lockdown")` throws. Completion is never claimed without controller acknowledgement and independent position feedback.

## Capabilities and Constraints

- Existing stack: Next.js, TypeScript, React, Tailwind CSS and the project's installed accessible UI primitives.
- Preserve the left navigation, dashboard, live-gate controls, schedules, access identity, activity log and settings.
- Active alarms must use a compact top-right operator panel so the dashboard and all gate movements stay visible.
- Preserve responsive desktop and mobile operation.
- The portal uses durable server-side state, a permanent audit trail and a secure per-controller command queue. It never treats a browser click as physical movement.
- A confirmed operator request creates a real server-side command packet. The assigned authenticated controller retrieves it over HTTPS, performs the local safety checks, pulses the dedicated relay and reports the independently confirmed result.
- Every access point remains visibly uncommissioned or offline until its real controller reports position and safety state. A gate is described as open or closed only when an independent physical input confirms it.
- Manual commands are blocked unless the assigned controller is online and its local safety circuit reports healthy.
- Each controller receives a separate rotatable credential. The onsite bridge supports dedicated OPEN and CLOSE dry-contact inputs only; toggle/PP operation is deliberately rejected because direction cannot be proven remotely.
- The onsite agent journals a packet before energising a relay. After a process or power interruption it keeps relays off, accepts success only from confirmed physical position feedback and never automatically repeats the interrupted pulse.
- Local beams, safety edges, emergency stops, force limits, physical stops, approved fire/security interfaces and manual-release procedures remain authoritative. The web system must never bypass them or replace the school's Emergency Management Plan.
- Emergency commands require a second confirmation and expose confirmed, pending and failed counts. Sirens, horns, projectors and alarms are never shown as active unless a real commissioned interface acknowledges them.
- Reissuing an active emergency is a deliberate administrator action; the portal never silently retries a blocked or failed physical movement. Clearing priority cancels uncollected emergency packets but clearly warns that already-collected packets cannot be recalled.
- Every normal gate movement also requires a second confirmation that identifies the exact gate and direction. The portal records success only after independent physical position feedback.
- Issuing a controller credential does not commission a gate. Commissioning is recorded only after the assigned controller authenticates and supplies real safety and position inputs.
- Audible action confirmations use an available Australian English browser voice. If no suitable browser voice is present, the portal does not claim that an announcement was delivered.
- Fire requests set emergency priority, queue OPEN commands for active gates and repeat the fire warning until an authorised all-clear clears portal priority. No lockdown control or lockdown-close voice is supported. Physical gate states remain separately reported.
- Gate visuals distinguish single sliding, double-swing and boom-gate hardware. Confirmed closed and open states use red and green; unknown, moving, pending and uncommissioned states remain neutral and explicitly labelled.
- First-run schedules and automations are blank. Only a real operator-approved configuration is stored or displayed as configured.

## Brand Commitments

- Product name: Magic Keys.
- Site identity: Balwyn High School gate automation.
- Managed by RJL Commercial.
- Use the same official blue Balwyn High School emblem for the centred watermark, in-app school badges and browser icon, while preserving the RJL/Magic Keys identity.
- Present school and RJL branding without visible white image boxes; the RJL mark is deliberately larger on the operator login screen.
- Confirmed visual direction: professional, premium, slightly darker school-blue interface with the school emblem centred in the background.
- Confirmed typography direction: Zing Sans Rust across the interface when a licensed webfont file is supplied. Until then, use a deliberate condensed sans fallback without falsely claiming the commercial font is embedded.
- Confirmed weight direction: avoid bold text throughout; create hierarchy through scale, spacing, colour and layout.

## Evidence on Hand

- School logo assets in `public/`, including `balwyn-high-school-logo.webp` and `balwyn-watermark.png`.
- Magic Keys cover artwork in `public/magic-keys-cover.png`.
- Supplied red and green single-gate animation assets and posters in `public/`.
- Existing product copy and workflows in `app/page.tsx` and `app/dashboard-client.tsx`.
- No live gate telemetry, production incident feed or hardware API evidence is present in the current project. Future work must not fabricate a live connection.

## Product Principles

1. Emergency actions are unmistakable, immediate and never hide the gate dashboard.
2. Gate state is understandable before the operator reads supporting text.
3. Daily controls stay fast, calm and consistent across desktop and mobile.
4. Authenticated identity and every requested or completed action remain visible and accountable.
5. Commanded state, controller acknowledgement and independent physical position are separate facts and must never be conflated.
6. Visual polish must never reduce operational clarity.

## Accessibility & Inclusion

- Maintain keyboard access, visible focus treatment, semantic controls and readable contrast.
- Critical state must use text and iconography in addition to red or green colour.
- Motion must respect reduced-motion preferences.
