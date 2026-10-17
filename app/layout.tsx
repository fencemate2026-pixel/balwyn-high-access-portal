import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./login-fix.css";
import "./facility-hire.css";
import "./control-room.css";
// Last: the Bright Glass layer (tokens, sign-in stage, glass panels). Keep this import at the end.
import "./bright-glass.css";
// Very last: corporate workspace layer (white cards, one tab style, one spacing grid).
import "./corporate.css";
import "./login-wordmark.css";
// Sign-in AI face sizing and animation, then the locked-module showcase. Keep these last.
import "./login-ai-face.css";
import "./advanced-showcase.css";
import "./gate-service.css";
import EmergencyVoiceGuard from "./emergency-voice-guard";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b131e" };

export const metadata: Metadata = {
  // AUDIT_SEO P3/P4 (18 Oct 2026): metadataBase lets relative OG/Twitter image
  // paths below resolve correctly; openGraph/twitter cover sharing a link to
  // the public home/privacy/terms pages (the signed-in dashboard itself is
  // never part of any page's SSR HTML, so this carries no private data).
  // favicon.svg existed unreferenced in public/ — wired in as the modern
  // `icon` entry alongside the existing PNG fallback for older browsers.
  metadataBase: new URL("https://magickeys-balwyn-portal.com"),
  title: "Magic Keys – Balwyn High School",
  description: "Secure Magic Keys operations portal for Balwyn High School access points.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/magic-keys-school-logo.png" },
    ],
    shortcut: "/magic-keys-school-logo.png",
    apple: "/magic-keys-school-logo.png",
  },
  openGraph: {
    title: "Magic Keys – Balwyn High School",
    description: "Secure Magic Keys operations portal for Balwyn High School access points.",
    url: "/",
    siteName: "Magic Keys",
    images: ["/magic-keys-cover.png"],
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Magic Keys – Balwyn High School",
    description: "Secure Magic Keys operations portal for Balwyn High School access points.",
    images: ["/magic-keys-cover.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className="dark">
      <body>
        <EmergencyVoiceGuard />
        {children}
      </body>
    </html>
  );
}
