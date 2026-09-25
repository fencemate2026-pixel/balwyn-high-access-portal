import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./login-fix.css";
import "./facility-hire.css";
import "./control-room.css";
// Last: the Bright Glass layer (tokens, sign-in stage, glass panels). Keep this import at the end.
import "./bright-glass.css";
import EmergencyVoiceGuard from "./emergency-voice-guard";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b131e" };

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
    <html lang="en-AU" className="dark">
      <body>
        <EmergencyVoiceGuard />
        {children}
      </body>
    </html>
  );
}
