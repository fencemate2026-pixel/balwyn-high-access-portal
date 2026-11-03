// DEV-ONLY preview of the Mildura view with fake fixture data, so it can be
// screenshotted without an owner login. 404 unless PORTAL_DEV_FIXTURES=1 is set
// on the server at runtime (never set in production). No real data is read.
import { notFound } from "next/navigation";
import MilduraSiteView from "../../mildura-site-view";
import { OWNER_SITES_CSS } from "../../owner-sites-css";
import { milduraFixture } from "@/lib/mildura-fixture";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default function MilduraPreview() {
  if (process.env.PORTAL_DEV_FIXTURES !== "1") notFound();
  return <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}><style>{OWNER_SITES_CSS}</style><MilduraSiteView fixture={milduraFixture()} /></main>;
}
