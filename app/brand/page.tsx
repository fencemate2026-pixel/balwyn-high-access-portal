import type { Metadata } from "next";
import PublicAppHome from "../public-app-home";

export const metadata: Metadata = {
  title: "Magic Keys – Balwyn High School",
  description:
    "Magic Keys – Balwyn High School is a gate-operations application for authorised school and RJL Commercial Group personnel, with Google sign-in, access controls, schedules and activity records.",
  alternates: { canonical: "https://magickeys-balwyn-portal.com/brand" },
  robots: { index: true, follow: true },
};

export default function BrandPage() {
  return <PublicAppHome />;
}
