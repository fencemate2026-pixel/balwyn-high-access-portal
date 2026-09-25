import type { Metadata } from "next";
import SetupPasswordForm from "./setup-password-form";

export const metadata: Metadata = {
  title: "Set your password – Magic Keys, Balwyn High School",
  robots: { index: false, follow: false },
};

export default function SetupPasswordPage() {
  return <SetupPasswordForm />;
}
