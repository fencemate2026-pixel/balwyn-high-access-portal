import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BrandArtwork from "./brand-artwork";

export default function PublicAppHome() {
  return (
    <main className="magic-entry">
      <div className="magic-entry-artwork">
        <BrandArtwork />
      </div>

      <section className="magic-entry-access" aria-labelledby="magic-entry-title">
        <div className="magic-entry-copy">
          <span className="magic-entry-kicker">Balwyn High access operations</span>
          <h1 id="magic-entry-title">Magic Keys – Balwyn High School</h1>
          <p>Gate controls, schedules, safety-aware workflows and activity records for authorised school and RJL personnel.</p>
          <div className="magic-entry-highlights" aria-label="Portal highlights">
            <span>Status-first dashboard</span>
            <span>Readable analytics panels</span>
            <span>Commissioning-aware simulation cues</span>
          </div>
        </div>
        <div className="magic-entry-actions">
          <Link href="/login" className="magic-entry-signin">Operator sign in <ArrowRight aria-hidden="true" /></Link>
          <p>Designed for clear scanning on desktop, tablet and mobile without implying live emergency authority where integrations remain a demonstration.</p>
        </div>
      </section>

      <footer className="magic-entry-footer">
        <img src="/rjl-commercial-logo.png" alt="RJL Commercial Group" width={150} height={50} />
        <nav aria-label="Policies and support">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
          <a href="mailto:info@rjlcommercialgroup.com">Support</a>
        </nav>
      </footer>
    </main>
  );
}
