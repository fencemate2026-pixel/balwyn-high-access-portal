import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./gate-led.css";
import "./site-polish.css";
import EmergencyVoiceGuard from "./emergency-voice-guard";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b2942" };

export const metadata: Metadata = {
  title: "Magic Keys – Balwyn High School",
  description:
    "Secure Magic Keys operations portal for monitored relay control, scheduling and auditable management of nine Balwyn High School access points, with two active gates.",
  icons: {
    icon: "/magic-keys-school-logo.png",
    shortcut: "/magic-keys-school-logo.png",
    apple: "/magic-keys-school-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>
        <EmergencyVoiceGuard />
        <svg className="logo-filter-definitions" aria-hidden="true" focusable="false">
          <defs>
            <filter id="logo-clear-background" colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 0 2.85" result="background-mask" />
              <feComposite in="SourceGraphic" in2="background-mask" operator="in" />
            </filter>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
