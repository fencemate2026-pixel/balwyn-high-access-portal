import type { Metadata } from "next";
import DemoLogin from "./demo-login";

export const metadata: Metadata = {
  title: "Operator Sign In | Magic Keys",
  description: "Sign in to your Magic Keys workspace with an approved Google, Microsoft or assigned email account.",
  alternates: { canonical: "https://magickeys-balwyn-portal.com/" },
};

// The sign-in screen is the site entry point. DemoLogin restores an existing
// session and shows the dashboard for signed-in operators, as on /login.
export default function Home() {
  return <DemoLogin generalClient />;
}
