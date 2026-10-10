import type { Metadata } from "next";
import LegalPage from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Magic Keys",
  description: "How the Magic Keys Balwyn High School operations portal handles personal information.",
};

/*
 * Updated 10 Oct 2026 to match the portal as built (hosting regions checked
 * against the Render and Supabase projects; help-chat logging and RJL alert
 * forwarding; stadium hire client details; gate service data; retention).
 * Prepared for Jarrod Alebakis (RJL) and flagged for review by an Australian
 * solicitor; not legal advice.
 */
export default function PrivacyPage() {
  return <LegalPage
    eyebrow="Privacy and data handling"
    title="Privacy Policy"
    updated="10 October 2026"
    summary="This policy explains how the Magic Keys Balwyn High School operations portal collects, uses, stores and discloses personal information needed to sign staff in, operate the school's access-control equipment, manage stadium hire bookings, provide in-portal help and keep an accountable activity record."
    sections={[
      {
        title: "Who operates this portal",
        content: <><p>The portal is provided and managed by RJL Commercial Fencing and Gates (VIC) Pty Ltd (ABN 37 652 237 431), trading as RJL Commercial Group and Magic Keys (“RJL”, “we”), for authorised Balwyn High School operations. We handle personal information in line with the Australian Privacy Principles in the Privacy Act 1988 (Cth).</p><p>Privacy enquiries, access or correction requests and complaints can be sent to <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>.</p></>,
      },
      {
        title: "What we collect",
        content: <ul>
          <li><strong>Sign-in and account details:</strong> name, email address, account identifiers from Google or Microsoft, portal role, account status, last sign-in time, password hashes and encrypted authenticator set-up secrets for email/password accounts.</li>
          <li><strong>Profile details you choose to add:</strong> display name, portal username, contact email, phone number, job title and profile photo.</li>
          <li><strong>Operational records:</strong> gate commands and remote-open requests (with the requesting person’s name and role), controller acknowledgements, schedules, automation rules, settings changes, settings unlocks, emergency actions, gate service records and the activity log.</li>
          <li><strong>Stadium hire bookings:</strong> the hirer’s name, email address, phone number, booking date, time and space, deposit details, comments entered by staff, and the staff member who made the booking.</li>
          <li><strong>Help-chat questions:</strong> the text of questions asked in the Ask Magic Keys help chat, the page and the asker’s role (see “Help chat” below).</li>
          <li><strong>Security records:</strong> short-lived sign-in and request-limit records. Network (IP) addresses used for sign-in protection are stored only as one-way keyed codes, not as readable addresses.</li>
        </ul>,
      },
      {
        title: "Google account data",
        content: <><p>When an approved person chooses “Sign in with Google”, Google supplies their name, email address, Google account identifier, profile image if available, and confirmation that the email address is verified. The portal requests only the standard <code>openid</code>, <code>email</code> and <code>profile</code> sign-in permissions.</p><p>We do not request or access Google Drive, Contacts, Calendar, Gmail, Photos or other Google account content. We do not collect Google passwords and do not request or store Google refresh tokens. Google account data is used only to authenticate the person, check the verified email address against the approved-user list, display the signed-in identity, assign the correct role, secure the session and attribute actions to the responsible account. It is not sold, and not used for advertising, profiling, marketing or automated decisions about students.</p></>,
      },
      {
        title: "Microsoft and email/password sign-in",
        content: <><p>When Microsoft sign-in is enabled, the portal receives the account identifier, tenant identifier, name and available email information needed to identify an approved person. It requests only standard sign-in permissions and does not request mailbox content or refresh tokens.</p><p>Email/password accounts are created by a school portal administrator, who sends the person a one-time set-up link. Passwords are stored only as salted hashes. Operators and administrators also use an authenticator code; authenticator set-up secrets are stored encrypted.</p></>,
      },
      {
        title: "How we use personal information",
        content: <ul>
          <li>To sign people in, apply the right role and keep sessions secure.</li>
          <li>To send, confirm and record gate commands, schedules and emergency actions, and to keep an accountable activity record.</li>
          <li>To manage stadium hire bookings and open the booked gates at the booked times.</li>
          <li>To track gate use and servicing, and to alert RJL when a gate is due for service or reports a fault.</li>
          <li>To answer help-chat questions and improve the help.</li>
          <li>To detect and respond to misuse, security testing and safety risks, investigate incidents and diagnose faults.</li>
          <li>To administer and support the service and meet legal obligations.</li>
        </ul>,
      },
      {
        title: "Help chat (Ask Magic Keys)",
        content: <><p>Questions asked in the Ask Magic Keys help chat are recorded to improve the help. The stored record contains the question, the page and the asker’s role, but not the asker’s email address; email addresses, passwords, codes and token-like text typed into a question are masked before it is stored.</p><p>Questions that appear to test security, seek restricted or personal information, are abusive or are unrelated to the portal may be sent to RJL with the asker’s name and email address for review.</p><p>When the help chat uses an AI service, the question, up to six recent messages in the same chat, the page name, the asker’s role and plan, and matching sections of the staff guide are sent to that provider to produce an answer. Account email addresses, profiles, activity records, booking details and passwords are not sent. Please do not type personal or confidential information into the chat.</p></>,
      },
      {
        title: "Profiles and photographs",
        content: <p>Approved staff can see profile names and photos. Administrators who have entered the administrator settings password can manage other people’s profile details. People can correct their own details and remove their photo from Access &amp; users.</p>,
      },
      {
        title: "Gate service and fault data",
        content: <p>The portal counts gate openings sent through Magic Keys and records service dates for each gate. These records are about equipment, not people; service records show the name of the administrator who recorded the service. RJL is emailed when a gate approaches or reaches its service limit, or when a commissioned gate reports a fault.</p>,
      },
      {
        title: "Where information is stored",
        content: <><p>The portal database and profile photos are stored with Supabase in its Sydney, Australia region. The portal application runs on Render in the United States (Oregon region) and processes information there while handling requests. Render's network provider, Cloudflare, carries and protects traffic to the portal and may process it in its global network.</p><p>Other service providers used for specific functions: the AI provider configured for the help chat (Anthropic, OpenAI or Microsoft; these providers may process data in the United States or other countries) and Resend (United States), which delivers RJL’s internal alert emails. Google and Microsoft process sign-in information under their own terms.</p><p>Where information is processed outside Australia, we take reasonable steps, including relying on these providers’ contractual and security commitments, to protect it consistently with the Australian Privacy Principles.</p></>,
      },
      {
        title: "Cookies and security",
        content: <><p>After sign-in, the portal sets a signed, HTTP-only session cookie that keeps the person signed in for at most eight hours; the portal also signs people out when they close or reload the page. A separate short-lived cookie records an administrator settings unlock for ten minutes. These cookies are required for the service and are not used for advertising or cross-site tracking.</p><p>Access is restricted to approved accounts and roles, important actions are logged, the activity log cannot be edited or deleted by the application, and connections are encrypted. We use reasonable administrative and technical safeguards to protect information from misuse, interference, loss and unauthorised access, modification or disclosure.</p></>,
      },
      {
        title: "Sharing and disclosure",
        content: <><p>Personal information is not sold or rented. It may be accessed by authorised Balwyn High School staff according to their portal role, by RJL personnel who support and maintain the service, and by the service providers listed above where they need it to provide their services.</p><p>We may also disclose information where required or authorised by law, or where reasonably necessary to lessen or prevent a serious threat to safety or to investigate a security incident.</p></>,
      },
      {
        title: "Retention and deletion",
        content: <><p>Sessions expire after at most eight hours. Help-chat question records and RJL alert records are deleted after 12 months. Request-limit records are kept only for their short time window. The activity log, gate service records and stadium hire records are kept for as long as reasonably required for safety, security, audit, contractual record-keeping or legal obligations, and are then deleted or de-identified where practicable.</p><p>A person may ask for their portal account information to be deleted by emailing <a href="mailto:info@rjlcommercialgroup.com">info@rjlcommercialgroup.com</a>. Activity-log entries that must be kept for legitimate safety, security, contractual or legal reasons may be retained. Google access can also be revoked from the person’s Google Account permissions page; this prevents future Google sign-in but does not remove records that must be kept.</p></>,
      },
      {
        title: "Access, correction and complaints",
        content: <><p>You may ask to access or correct personal information we hold about you, or make a privacy complaint, by emailing the address above. We may need to verify your identity before acting. We will respond within a reasonable time, usually within 30 days. If you are not satisfied with our response, you can contact the Office of the Australian Information Commissioner (<a href="https://www.oaic.gov.au">oaic.gov.au</a>).</p><p>Hirers whose details were entered for a stadium booking can make the same requests.</p></>,
      },
      {
        title: "Children’s privacy",
        content: <p>This portal is an operational tool for authorised adult staff and is not directed to students or children. Students cannot have portal accounts. The portal does not store student records, CCTV footage or biometric information.</p>,
      },
      {
        title: "Updates",
        content: <p>We may update this policy when the portal, its service providers or legal obligations change. The “last updated” date above identifies the current version.</p>,
      },
    ]}
  />;
}
