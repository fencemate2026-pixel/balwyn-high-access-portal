# Security Policy

Security Policy Balwyn High School Operations Portal Last updated: 3 November 2026

Purpose This Security Policy sets out how the Magic Keys Balwyn High School operations portal protects the confidentiality, integrity and availability of staff access, operational records, gate control data, profile information and related systems used by the School and authorised service providers.
This portal is used to support authorised staff sign-in, access control operations, gate monitoring, reporting, help requests, profile management and operational administration. It is not a public website and is intended only for approved school staff, administrators and authorised support personnel.

Scope This policy applies to:
The web portal and related application interfaces
Admin and staff account access
Gate access command and status workflows
Data stored in the portal database and profile storage
Third-party infrastructure used to host or support the portal
Staff and contractor access to related operational records
Any onsite hardware integrations, including door/gate controllers and relay systems
Roles and responsibilities School users
Must only access the portal using their own account and approved credentials.
Must not share passwords, session access, or admin credentials.
Must use the portal only for authorised school operations and business purposes.
Must report any suspected unauthorised access, suspicious activity, or incidents immediately.
Administrators

Are responsible for approving and maintaining authorised users.
Must restrict access to functions according to role and operational need.
Must ensure that profile information, access permissions and operational settings are reviewed and updated when personnel change.
RJL Commercial Fencing and Gates (VIC) Pty Ltd

Provides hosting support, maintenance, configuration and technical support for the portal.
Must only access authorised data required to maintain the service.
Must apply security controls consistent with this policy and relevant Australian privacy and information handling obligations.
Authentication and access control The portal uses role-based access and secure sign-in controls.
Users sign in using approved Google, Microsoft or local portal account methods where configured.
Authentication relies on secure identity verification and approved user records.
Only authorised users are granted access to operational functions.
Administrative functions are limited to approved administrators and separated from standard user access.
System access is reviewed and restricted according to job role and operational need.
Session and browser security

User sessions are protected by signed, HTTP-only session cookies.
Default session expiry is limited to a defined period and sessions are ended when users sign out or when inactivity limits are reached.
The portal does not store sensitive credentials in browser-accessible storage.
Secrets and service credentials are not exposed to the browser or embedded in client-side source files.
Authorisation and least privilege Access to features and data is limited according to the principle of least privilege. Examples include:
Standard staff users may access approved operational functions relevant to their role.
Administrators may manage user profiles, access configuration and operational settings.
Gate commands and remote actions require permission checks before execution.
Operational actions are restricted by role, current system status, request origin and configured access policies.
Any operation that affects physical access, emergency status, safety controls or gate activation must be subject to appropriate controls and logs.

Data collection and protection The portal collects and stores only the information needed to support approved school operations, security, access control and service administration. This may include:
Account and profile information
Sign-in metadata and account identifiers
Operational and gate event data
Booking and facility-use information
Help-chat requests
Security and request-limit records
Service and fault records for gate systems
Sensitive data is protected in transit and at rest using secure service configuration, access restrictions and infrastructure-level controls.

Secure system architecture The portal is hosted in a secure application environment and uses a combination of:
Protected application hosting
Server-side processing for operational actions
Restricted database access
Role-based permission checks before sensitive actions are performed
Infrastructure logging and monitoring
The portal application runs in an approved hosting environment and the database and media storage are held in controlled hosting services. The system is designed so that operational commands are processed through server-side logic rather than direct browser execution.

Gate control and physical access security The portal may integrate with programmable control hardware and relay systems used for access, gate, or door operations. These systems are treated as high-risk operational infrastructure.
Security controls include:

Server-side validation before any gate command is sent
Verification of request origin and user permissions
Restricted relay token or service credential handling
Logging of command requests and acknowledgements
Separation between normal user access and hardware control actions
Rejection of incomplete or invalid service configuration
Protection of service credentials from client exposure
The site does not treat gate commands as unrestricted browser actions. Commands are authorised and checked before execution, and control systems are expected to follow site-approved wiring, safety and operational rules.

Data storage and hosting The platform stores operational data and profile information in controlled systems operated by approved hosting providers.
Storage is limited to what is necessary for the portal’s operational purpose.
Access to stored data is restricted to authorised personnel and approved support staff.
Data is kept in Australian-hosted or approved regional infrastructure where required.
Storage arrangements are reviewed to align with the School’s operational and privacy obligations.
Cookies, sessions and browser security The portal uses secure session handling to minimise unauthorised access.
Session cookies are protected and restricted to authenticated application use.
Cookies are not used for unrestricted or unnecessary tracking.
Session expiry and sign-out controls are enforced.
Sensitive operational data is not placed in browser storage when server-side storage is available.
Logging, monitoring and audit trails The portal records operational activity to support accountability, diagnostics and investigation. Logs may include:
User sign-in activity
Role and permission changes
Gate commands and remote-open requests
System acknowledgements and errors
Operational and service records
Security-related request blocks or failed access attempts
Logs are used to support operational accountability and to investigate misuse, faults or incidents. They are retained only for the period required for operational and compliance purposes.

Security measures against misuse The portal is designed to reduce risk from both accidental and malicious behaviour. This includes:
Multi-layer access controls
Role checks before sensitive actions
Signed server-side session management
Protection of service tokens and hardware credentials
Request validation and origin checks where applicable
Automated rejection of invalid or incomplete configuration
Limiting the exposure of personal and operational data
Help chat and user support data Support features and help-chat functions may record user questions, page context and operational role information to improve assistance and support. These records are:
Access-controlled
Kept only as long as necessary for support and service improvement
Reviewed for misuse or inappropriate content
Not used for unrelated purposes outside the portal’s operation
Personal information and privacy integration This security policy works alongside the portal’s privacy policy. Personal information is handled using the principle that only necessary operational and administrative data is stored, accessed and used.
Access to personal information is restricted to approved individuals.
Sensitive personal details are not disclosed to unauthorised parties.
Data is limited to approved operational support and administration needs.
Any disclosure of personal information must be authorised and carried out under the portal’s role and privacy controls.
Incident response If a security incident, suspected misuse, unauthorised access, data exposure, or operational compromise is identified, the following steps apply:
The incident must be reported to the appropriate administrator or service contact immediately.
Access may be suspended or restricted pending investigation.
The affected system and any relevant logs should be reviewed.
The source and extent of the issue should be assessed.
Corrective action should be taken to address the issue and prevent recurrence.
Any required notification to the School, regulator or affected parties should be carried out as required.
Vulnerability management and maintenance The portal and related services are reviewed and maintained to reduce security risk. This includes:
Keeping the application, framework and dependencies current
Reviewing access controls and role assignments
Testing configuration and operational workflows
Reviewing logs and anomalies
Applying security hardening where required
Maintaining clear separation between user-facing and server-side functionality
Third-party services The portal may rely on approved third-party services for hosting, identity verification, storage, or operational support. These providers are used only where required for the service and are subject to contractual and procedural controls. Third-party providers must not be used to bypass the portal’s access controls or to expose system data beyond approved operational needs.

Retention and disposal Operational and security data is retained only for as long as needed for:

business operations
security and audit purposes
legal and regulatory obligations
service continuity and support
user access and profile management
When data is no longer required, it should be securely deleted or disposed of in a controlled manner.

User obligations Users must:
Protect accounts and credentials
Avoid sharing access or credentials
Use the portal only for authorised functions
Report suspicious behaviour or abnormal activity
Follow any instructions issued by administrators or service providers
Enforcement Failure to comply with this policy may result in:
Restricted access
Removal of permissions
Notification to the relevant administrator or service contact
Escalation to the School or service provider
Other disciplinary or corrective action as required
Policy updates This policy will be reviewed and updated when there are material changes to:
the portal’s functionality
user access arrangements
system architecture
storage, hosting or provider arrangements
privacy or legal obligations
security requirements or incident findings
