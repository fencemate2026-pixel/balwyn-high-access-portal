import type { Metadata } from "next";
import MacquarieClient from "./macquarie-client";
import "./macquarie.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Macquarie Drive Thomastown · Magic Keys",
  description: "Resident access for the Macquarie Drive Thomastown sliding gate.",
  robots: { index: false, follow: false },
};

export default function MacquariePage() {
  return <MacquarieClient />;
}
