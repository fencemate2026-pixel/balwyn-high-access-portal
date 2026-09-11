import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Keys | Balwyn High School Gate Control",
  description:
    "Secure Magic Keys operator dashboard for monitoring, scheduling and controlling 17 proposed automated access points at Balwyn High School.",
  icons: {
    icon: "/balwyn-watermark.png",
    shortcut: "/balwyn-watermark.png",
    apple: "/balwyn-watermark.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
