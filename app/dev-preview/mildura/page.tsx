// DEV-ONLY preview of the Mildura view with fake fixture data, inside the dashboard
// shell, so it can be screenshotted without an owner login. 404 unless
// PORTAL_DEV_FIXTURES=1 is set on the server at runtime (never set in production).
import { notFound } from "next/navigation";
import PreviewShell from "./preview-shell";
import { milduraFixture } from "@/lib/mildura-fixture";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default function MilduraPreview() {
  if (process.env.PORTAL_DEV_FIXTURES !== "1") notFound();
  return <PreviewShell fixture={milduraFixture()} />;
}
