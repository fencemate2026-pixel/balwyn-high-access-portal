import type { Metadata } from "next";
import DemoLogin from "../demo-login";

export const metadata: Metadata = {
  title: "Operator Sign In | Magic Keys",
  description: "Sign in to the Magic Keys Balwyn High School portal with an approved Google, Microsoft or operator email account.",
  // AUDIT_SEO P3 (18 Oct 2026): robots.txt disallow alone doesn't stop the URL
  // itself appearing in results if it's ever discovered via an internal link
  // or backlink. Matches the pattern already used on app/setup/page.tsx.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <DemoLogin />;
}
