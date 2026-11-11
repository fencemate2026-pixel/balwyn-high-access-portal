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
  title: "Magic Keys",
  description: "Secure Magic Keys operations portal.",
  icons: {
    icon: "/magic-keys-mark-2026.png",
    shortcut: "/magic-keys-mark-2026.png",
    apple: "/magic-keys-mark-2026.png",
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
