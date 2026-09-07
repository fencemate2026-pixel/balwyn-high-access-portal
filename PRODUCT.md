# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary user (inferred from the current brief and interface): authorised Balwyn High School operations staff responsible for daily access control.
- Secondary user (inferred): authorised security or facilities staff responding to incidents and reviewing gate activity.

## Product Purpose

Magic Keys gives authorised operators one secure place to see, schedule and control Balwyn High School's proposed automated gates. Success means the operator can understand every gate's state at a glance, act on one gate quickly and issue school-wide emergency commands without ambiguity.

## Positioning

The product combines gate-specific controls, weekly schedules, authenticated operator identity and school-wide emergency actions in one RJL-managed operations console.

## Operating Context

- The sales demonstration opens with a branded operator login for Paul Sutton, then keeps his name and session role visible throughout the dashboard.
- This client-side credential screen is presentation-only. Production deployment requires server-backed Magic Keys identity, secure password storage and auditable access control.
- The main workspace covers 17 proposed automated access points across the Tom Frizza Sports Area, Staff Car Park and front boundary.
- Daily work includes checking live positions, opening or closing individual gates, managing weekly schedules and reviewing the current session's activity.
- Emergency lockdown closes all automated access points. Fire and evacuation mode unlocks and opens all automated access points.

## Capabilities and Constraints

- Existing stack: Next.js, TypeScript, React, Tailwind CSS and the project's installed accessible UI primitives.
- Preserve the left navigation, dashboard, live-gate controls, schedules, access identity, activity log and settings.
- Active alarms must use a compact top-right operator panel so the dashboard and all gate movements stay visible.
- Preserve responsive desktop and mobile operation.
- The current product is a high-fidelity operational simulation and is not represented as a live hardware connection.
- Hosted Sites access remains separately protected by its owner-only access policy. Any external reviewer must be explicitly invited before reaching the demonstration login.
- Audible action confirmations preload and retain the same Australian English male browser voice for both commands, with matching recorded male files as the fixed fallback when that browser voice is unavailable.
- Lockdown and fire commands immediately override every gate state, open the all-gates dashboard so all 17 access cards visibly move together, and repeat the matching Australian male warning until an authorised all-clear stops the emergency mode.
- Gate visuals distinguish single sliding, double-swing and boom-gate hardware. Every gate shows red for closed and green for open.

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
4. Authenticated identity and every simulated action remain visible and accountable.
5. Visual polish must never reduce operational clarity.

## Accessibility & Inclusion

- Maintain keyboard access, visible focus treatment, semantic controls and readable contrast.
- Critical state must use text and iconography in addition to red or green colour.
- Motion must respect reduced-motion preferences.
