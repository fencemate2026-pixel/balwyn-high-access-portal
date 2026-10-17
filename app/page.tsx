import type { Metadata } from "next";
import PublicAppHome from "./public-app-home";

// AUDIT_SEO P2/P3 (18 Oct 2026): /brand was a byte-identical, unlinked
// duplicate of this page with no self-canonical here to settle which URL
// search engines should prefer. /brand has been removed; this is now the
// one public, indexable URL and declares itself as canonical.
export const metadata: Metadata = {
  alternates: { canonical: "https://magickeys-balwyn-portal.com/" },
};

export default function Home() {
  return <PublicAppHome />;
}
