import type { Metadata } from "next";
import DemoLogin from "../demo-login";

export const metadata: Metadata = {
  title: "Operator Sign In | Magic Keys",
  description: "Sign in to the Magic Keys portal with an approved Google, Microsoft or operator email account.",
};

export default function LoginPage() {
  return <DemoLogin />;
}
