import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Use | Magic Keys",
  description: "Terms governing authorised use of the Magic Keys Balwyn High School operations portal.",
};

export default function TermsPage() {
  return <LegalPage
    eyebrow="Authorised operator use"
    title="Terms of Use"
    summary="These terms govern access to the Magic Keys Balwyn High School operations portal. By signing in or using the portal, you agree to use it only for authorised school access-control operations."
    sections={[
      {
        title: "Authorised access",
        content: <p>You may use the portal only if Balwyn High School or RJL Commercial Group has approved your account and assigned you an operator role. Access is personal to you. Do not share access, allow another person to use your signed-in session or attempt to bypass security controls.</p>,
      },
      {
        title: "Operator responsibilities",
        content: <><p>Use gate controls only for legitimate operational purposes and in accordance with school procedures, training, signage and applicable safety requirements. Before operating a gate, confirm that the movement area is clear and that the requested action is appropriate.</p><p>Do not use the portal to disable, bypass or interfere with physical safety devices, controller safeguards, Compass controls, networks or other connected systems.</p></>,
      },
      {
        title: "Operational limitations",
        content: <p>The portal is an operational aid and must not be treated as the sole emergency, life-safety or security system. Network connections, cloud services, controllers and relay interfaces can be delayed or unavailable. Follow the school’s approved emergency procedures and use physical or local controls where required.</p>,
      },
      {
        title: "Compass and relay integration",
        content: <p>Where commissioned, Magic Keys may send authorised commands through agreed relay outputs or interfaces associated with the existing Compass control system. Available functions depend on the installed hardware, completed testing and permissions approved by the school. A feature shown in the portal is not evidence that field commissioning is complete.</p>,
      },
      {
        title: "Monitoring and records",
        content: <p>Sign-ins, commands, acknowledgements, settings changes and other activity may be recorded for security, safety, troubleshooting, audit and accountability. Use of personal information is described in the <a href="/privacy">Privacy Policy</a>.</p>,
      },
      {
        title: "Availability and changes",
        content: <p>We may maintain, restrict, suspend or change portal access to protect people, property, systems or data, or to carry out support and commissioning. Report suspected unauthorised access, incorrect gate state or unsafe behaviour immediately.</p>,
      },
      {
        title: "Ownership and acceptable use",
        content: <p>Portal software, branding and content remain the property of their respective owners. You must not copy, reverse engineer, probe, overload, misuse or introduce malicious code into the service except where expressly permitted by law and written authorisation.</p>,
      },
      {
        title: "Contact and governing law",
        content: <p>Questions about these terms can be sent to <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>. These terms are governed by the laws of Victoria, Australia, subject to any rights that cannot lawfully be excluded.</p>,
      },
    ]}
  />;
}
