import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Magic Keys",
  description: "How the Magic Keys Balwyn High School operations portal handles personal information.",
};

export default function PrivacyPage() {
  return <LegalPage
    eyebrow="Privacy and data handling"
    title="Privacy Policy"
    effectiveDate="19 September 2026"
    summary="This policy explains how the Magic Keys Balwyn High School operations portal handles the limited personal information needed to authenticate operators, operate access-control equipment and maintain an accountable activity record."
    sections={[
      {
        title: "Who operates this portal",
        content: <><p>The portal is powered and managed by RJL Commercial Fencing and Gates (VIC) Pty Ltd, trading as RJL Commercial Group and Magic Keys, for authorised Balwyn High School gate operations.</p><p>Privacy enquiries, access or correction requests, and complaints can be sent to <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>.</p></>,
      },
      {
        title: "Google account data we collect",
        content: <><p>When an approved operator chooses “Sign in with Google”, Google supplies the operator’s name, email address, Google account identifier, profile image if available, and confirmation that the email address is verified. The portal requests only the standard <code>openid</code>, <code>email</code> and <code>profile</code> sign-in permissions.</p><p>We do not request or access Google Drive, Contacts, Calendar, Gmail, Photos or other Google account content. We do not collect Google passwords and do not request or store Google refresh tokens.</p></>,
      },
      {
        title: "How Google data is used",
        content: <p>Google account data is used only to authenticate the operator, compare the verified email address with the portal’s approved-user list, display the signed-in operator’s identity, assign the correct access role, secure the session and attribute operational actions to the responsible account. It is not used for advertising, profiling, marketing or automated decisions about students.</p>,
      },
      {
        title: "Microsoft and operator email sign-in",
        content: <><p>When Microsoft sign-in is enabled, the portal receives the account identifier, tenant identifier, name and available email information needed to identify an approved operator. Microsoft email addresses are used for display; access approval uses the account and tenant identifiers. The portal requests only standard sign-in permissions and does not request mailbox content or refresh tokens.</p><p>Email/password accounts use a separately configured portal password and an authenticator code. Password verification uses stored password hashes, and authenticator setup secrets are encrypted. Sign-in attempts and administrator password checks are recorded for access protection.</p></>,
      },
      {
        title: "User profiles and photographs",
        content: <p>Operators may save a display name, portal username, contact email, phone number, job title and profile photo. These details are used to display and manage portal profiles. Approved operators can see profile photos; administrators who verify their password can manage other users’ profile details. Profile details are stored in the portal database and photos in its cloud object storage. Operators can correct their details and remove their photo from the User access page.</p>,
      },
      {
        title: "Other portal information",
        content: <><p>The portal records operational information such as gate commands, schedules, controller acknowledgements, connection status, operator roles, settings and activity logs. This information is used to provide role-appropriate controls, send and confirm gate commands, diagnose faults, investigate incidents, maintain safety and security records, and administer the service.</p><p>The current portal does not store CCTV footage, biometric information or student records. The earlier software help and AI assistance panel is not part of this reverted build, so this portal no longer sends operator questions or guide excerpts to an external AI provider.</p></>,
      },
      {
        title: "Cookies, storage and security",
        content: <><p>After successful authentication, the portal creates a signed, HTTP-only session cookie. This cookie is required to keep the operator securely signed in and is not used for advertising or cross-site tracking.</p><p>Portal data is stored in the cloud infrastructure used to host the Magic Keys service. Access is restricted to approved accounts. Google identity responses are verified on the server, active sessions have a limited lifetime, and operational actions are logged. We use reasonable administrative and technical safeguards designed to protect information from misuse, interference, loss and unauthorised access, modification or disclosure.</p></>,
      },
      {
        title: "Sharing and disclosure",
        content: <><p>Google account data is not sold, rented or used by third parties for advertising. It may be accessible only to authorised Balwyn High School personnel, RJL Commercial Group personnel, and service providers that support authentication, cloud hosting, security or maintenance and need the information to perform those services.</p><p>Information may also be disclosed where required or authorised by law, or where reasonably necessary to address a serious safety or security incident. Cloud and identity providers may process information outside Australia under their applicable contractual and privacy safeguards.</p></>,
      },
      {
        title: "Retention and deletion",
        content: <><p>Active portal sessions expire after a limited period. Google identity information and operational records are retained only for as long as reasonably required for authorised access, security, support, audit, contractual record-keeping or legal obligations. Information that is no longer required is deleted or de-identified where practicable.</p><p>An operator may request deletion of their portal account information by emailing <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>. Access can also be revoked from the operator’s Google Account permissions page. Revoking Google access prevents future Google sign-in but does not automatically remove operational records that must be retained for legitimate security, contractual or legal reasons.</p></>,
      },
      {
        title: "Access, correction and complaints",
        content: <><p>You may ask to access, correct or delete personal information we hold about you, or raise a privacy concern, by emailing the address above. We may need to verify your identity before acting on a request. We will acknowledge and assess complaints and explain the outcome.</p><p>If you do not want Google identity information used for this portal, do not sign in and contact the portal administrator about your access requirements.</p></>,
      },
      {
        title: "Children’s privacy",
        content: <p>This portal is an operational tool for authorised adult personnel and is not directed to students or children. Students are not permitted to create portal accounts. The Google sign-in process is not intended to collect personal information directly from children.</p>,
      },
      {
        title: "Updates",
        content: <p>We may update this policy when the portal, its integrations or legal obligations change. The effective date above identifies the current version.</p>,
      },
    ]}
  />;
}
