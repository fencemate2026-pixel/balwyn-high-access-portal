import Link from "next/link";
import { ArrowRight, Clock3, MapPin, Radio, ShieldCheck } from "lucide-react";
import BrandArtwork from "./brand-artwork";

export default function PublicAppHome() {
  const entryFacts = [
    { label: "Campus", value: "Balwyn High School", icon: MapPin },
    { label: "Operations", value: "Authorised staff and RJL support", icon: ShieldCheck },
    { label: "Controller context", value: "Heartbeat and audit aware", icon: Radio },
  ] as const;

  const overviewCards = [
    {
      title: "Operational overview",
      body: "Review gate status, recent controller contact, operator activity and scheduled access without implying live safety-system control.",
    },
    {
      title: "Verified sign-in",
      body: "Google, Microsoft and managed operator credentials keep school access scoped to approved accounts and auditable sessions.",
    },
    {
      title: "Campus-ready presentation",
      body: "A restrained control-room visual language keeps the demonstration clear, credible and easy to review on desktop, tablet and mobile.",
    },
  ] as const;

  return (
    <main className="magic-entry">
      <div className="magic-entry-artwork">
        <BrandArtwork />
      </div>

      <section className="magic-entry-shell" aria-labelledby="magic-entry-title">
        <section className="magic-entry-access">
          <div className="magic-entry-copy">
            <p className="magic-entry-kicker">Balwyn High School access-control demonstration</p>
            <h1 id="magic-entry-title">Professional access operations for gates, schedules and controller health.</h1>
            <p>
              Magic Keys presents a realistic campus operations portal for authorised school and RJL personnel. Review
              gate status, commissioning context, activity history and daily operating information from one trusted
              interface.
            </p>
            <div className="magic-entry-actions">
              <Link href="/login" className="magic-entry-signin">
                Operator sign in <ArrowRight aria-hidden="true" />
              </Link>
              <span className="magic-entry-note">
                <Clock3 aria-hidden="true" />
                Demonstration portal · Australia/Melbourne
              </span>
            </div>
          </div>

          <aside className="magic-entry-brief" aria-label="Portal overview">
            <img src="/gates/double-swing-blue.webp" className="entry-hardware-concept" alt="Blue double swing gate illustration" /><small className="entry-hardware-label">Single swing · double swing · boom gates</small>
            <div className="magic-entry-status-card">
              <strong>Live operational context</strong>
              <p>Designed for real-world campus review with clear status semantics, controller heartbeat context and audit-aware actions.</p>
            </div>
            <ul className="magic-entry-facts">
              {entryFacts.map(({ label, value, icon: Icon }) => (
                <li key={label}>
                  <span className="magic-entry-fact-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section className="magic-entry-overview" aria-label="Portal capabilities">
          {overviewCards.map((card) => (
            <article key={card.title}>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </section>
      </section>

      <footer className="magic-entry-footer">
        <img src="/rjl-commercial-logo-2026.png" alt="RJL Commercial Group" width={150} height={35} />
        <nav aria-label="Policies and support">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
          <a href="mailto:info@rjlcommercialgroup.com">Support</a>
        </nav>
      </footer>
    </main>
  );
}
