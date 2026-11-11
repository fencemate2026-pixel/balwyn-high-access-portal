import type { Metadata } from "next";
import DemoLogin from "../demo-login";

export const metadata: Metadata = {
  title: "Client Login | MagicKeys",
  description: "Sign in to your secure MagicKeys workspace with your approved email, username or Google account.",
  robots: { index: false, follow: false },
  icons: { icon: "/magic-keys-mark-2026.png", shortcut: "/magic-keys-mark-2026.png", apple: "/magic-keys-mark-2026.png" },
};

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  const params = await searchParams;
  return <DemoLogin generalClient preferredProvider={params.method === "google" ? "google" : undefined} />;
}
