import type { Metadata } from "next";
import DemoLogin from "../demo-login";

export const metadata: Metadata = {
  title: "Operator Sign In | Magic Keys",
  description: "Sign in to your Magic Keys workspace with an approved Google, Microsoft or assigned email account.",
};

export default function LoginPage() {
  return <DemoLogin generalClient />;
}
