import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import BrandLogo from "./brand-logo";

type Section = { title: string; content: ReactNode };

export default function LegalPage({ eyebrow, title, summary, sections, updated = "6 September 2026" }: { eyebrow: string; title: string; summary: string; sections: Section[]; updated?: string }) {
  return (
    <main className="legal-shell">
      <header className="legal-topbar">
        <Link href="/" className="legal-brand" aria-label="Return to Magic Keys sign in">
          <BrandLogo tone="dark" />
          <span><small>Magic Keys</small><strong>Secure operations portal</strong></span>
        </Link>
        <Link href="/" className="legal-back"><ArrowLeft /> Sign in</Link>
      </header>

      <article className="legal-card">
        <div className="legal-heading">
          <span className="legal-shield"><ShieldCheck /></span>
          <div><p>{eyebrow}</p><h1>{title}</h1></div>
        </div>
        <p className="legal-summary">{summary}</p>
        <p className="legal-updated">Last updated {updated}</p>

        <div className="legal-content">
          {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><div>{section.content}</div></section>)}
        </div>

        <footer className="legal-footer">
          <span>RJL Commercial Fencing and Gates (VIC) Pty Ltd</span>
          <nav aria-label="Legal pages"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
        </footer>
      </article>
    </main>
  );
}
