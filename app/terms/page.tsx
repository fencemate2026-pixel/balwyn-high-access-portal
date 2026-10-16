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
    updated="16 October 2026"
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
        title: "Roles and protected changes",
        content: <p>Each account has a role (viewer, operator or administrator) set by the school’s portal administrator or RJL. Some changes, including gate schedules, automation, staff accounts, system settings and service records, also need the separate administrator settings password. Only use the access your role gives you, keep passwords and authenticator codes private, and lock settings when you have finished.</p>,
      },
      {
        title: "Emergency functions",
        content: <p>The fire / evacuation function is available to administrators only. It queues open commands to active gates; it does not replace the school’s emergency management plan, fire indicator panel, emergency services or local controls, and gates’ own safety devices continue to apply. Clearing an emergency in the portal does not close gates or declare the site safe.</p>,
      },
      {
        title: "Help chat",
        content: <p>Ask Magic Keys explains how to use the portal from the staff guide. Its answers may be incomplete or wrong and are not safety, legal or emergency advice; follow school procedures and on-screen confirmations. It cannot operate gates or change settings. Do not enter passwords or personal information. Questions are recorded and may be reviewed by RJL as described in the <a href="/privacy">Privacy Policy</a>.</p>,
      },
      {
        title: "Stadium hire bookings",
        content: <p>Staff who enter a booking must have the hirer’s permission to record their contact details for the booking and must enter accurate times and spaces. Gates linked to a booking open and close automatically around the booked time, subject to controller availability and safety inputs; staff remain responsible for supervising the area.</p>,
      },
      {
        title: "Gate servicing",
        content: <p>The gate cycle counter counts openings sent through Magic Keys only; openings by fob, keypad, exit button or other systems are not counted until position sensors are fitted, so actual use may be higher. Service reminders are an aid and do not replace the maintenance schedule agreed with RJL or the manufacturer’s requirements.</p>,
      },
      {
        title: "Monitoring and records",
        content: <p>Sign-ins, commands, acknowledgements, settings changes and other activity may be recorded for security, safety, troubleshooting, audit and accountability. For signed-in staff accounts this includes how long the portal is open and in use during each visit, and the names of the buttons, links and tabs used. Typed text, passwords and field contents are not recorded. These records can be viewed by portal administrators and RJL, and are deleted after 12 months. Use of personal information is described in the <a href="/privacy">Privacy Policy</a>.</p>,
      },
      {
        title: "Availability and changes",
        content: <p>We may maintain, restrict, suspend or change portal access to protect people, property, systems or data, or to carry out support and commissioning. Report suspected unauthorised access, incorrect gate state or unsafe behaviour immediately.</p>,
      },
      {
        title: "Ownership and acceptable use",
        content: <p>Portal software, branding and content remain the property of their respective owners. You must not copy, reverse engineer, probe, scan, load-test, overload, misuse or introduce malicious code into the service. Security or penetration testing is permitted only with RJL’s prior written authorisation that sets out its scope and timing; please report suspected vulnerabilities to <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a> rather than testing them.</p>,
      },
      {
        title: "Contact and governing law",
        content: <p>Questions about these terms can be sent to <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>. These terms are governed by the laws of Victoria, Australia, subject to any rights that cannot lawfully be excluded.</p>,
      },
    ]}
  />;
}
