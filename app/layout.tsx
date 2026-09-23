import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./fonts.css";
import "./gate-led.css";
import "./site-polish.css";
import "./hardware-look.css";
import "./weather-strip.css";
import "./desk-fix.css";
import "./gate-preview.css";
import "./login-fix.css";
import "./portal-look.css";
import EmergencyVoiceGuard from "./emergency-voice-guard";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b2942" };

export const metadata: Metadata = {
  title: "Magic Keys – Balwyn High School",
  description: "Secure Magic Keys operations portal for Balwyn High School access points.",
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
        {children}
      </body>
    </html>
  );
}
