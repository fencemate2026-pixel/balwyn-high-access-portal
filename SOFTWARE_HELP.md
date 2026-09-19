# Current portal guide

## Source and hosting
The live portal is the OpenAI-hosted balwyn-gate-automation project, with a Cloudflare Worker backend, D1 database binding DB and R2 object storage binding BUCKET. The GitHub branch real-source-from-chatgpt contains a source copy. A GitHub change does not publish the live portal. PR #10 was already merged and closed on 19 September 2026 before this update began.

## Opening a gate and six-second pulses
Use the gate's Remote open control for the Compass ACB-004 Pi integration. The gateway waits up to 15 seconds and accepts pulse acknowledgements from 300 to 10,000 milliseconds. The browser waits up to 20 seconds. Six-second acknowledgements are supported. There is exactly one request and no automatic retry. A pulse acknowledgement confirms the trigger only, not that the gate physically opened. Independent sensors are needed to confirm position. If a request times out, inspect the gate before retrying.

## Active gates
Tony Frizza Stadium Entry and Side Entry are the two active single swing gates. The remaining seven registered gates remain inactive, including the office double gates, staff car park gates and boom gates. Channel assignment does not activate an inactive gate.

## Equipment settings
Open System settings and unlock with the administrator settings password. Equipment configuration includes remote-open enablement, four Compass channel assignments, dashboard refresh from 5 to 60 seconds, announcement speed and volume. Save equipment settings applies the portal changes. The Pi address and secret are server-side DOOR_SERVICE_URL and DOOR_SERVICE_TOKEN; an optional DOOR_GATE_MAP supplies default channel assignments. No hardware connection is inferred from a saved mapping. The settings panel reports whether address and credential are configured.

## Pi configuration export
Pi pulse duration (300–10,000 ms), four BCM GPIO pins, polarity, GPIO chip and mock/dry-run/hardware mode are saved for export only. Download Pi configuration exports a file for reviewed local installation. Saving the portal does not update the Pi. Existing Pi tokens and journal paths are preserved, not exported. The included Pi service supports this duration range with a default of 500 ms. Older onsite service versions may require updating before a longer pulse setting can be used.

## Login and administrator password
Normal sign-in and the administrator settings unlock are separate. Only an administrator can unlock configuration for ten minutes. Lock settings ends the unlock early. The login page has a password-reset request link. It requests administrator assistance rather than automatically issuing a reset email. Google, Microsoft and email sign-in availability depends on runtime configuration. Never paste passwords or service tokens into the helper.

## Profiles and access
Use the user profile editor for display name, username, contact details and photo. Photos use the R2 storage binding. Roles remain enforced on the server: viewers can read, operators can issue permitted commands, administrators can change protected configuration after unlocking. Controller credentials are issued separately and are not login passwords.

## Schedules, automation and controllers
Schedules and automation have dedicated pages and require the administrator unlock to change. Schedule data alone is not proof that a physical gate follows it. The sensor-equipped controller workflow uses polling, heartbeats, a command queue and acknowledgements. Offline, uncommissioned or unsafe controllers cannot be treated as working live devices. Compass one-way relay open is a separate workflow without position feedback.

## Roger controller and magnetic lock
The existing Roger F70/IPU36 motor configuration, force, travel limits, safety circuits, local auto-close and maglock release sequence are set at the installed controller. These parameters are not remotely rewritten by this portal. Consult the project's Compass wiring reference and the installed equipment documentation. The helper has no ability to actuate equipment or change safety settings.

## School site layer and meeting points
The uploaded balwyn_site.json file is sentinel-layout/2 and contains 22 marked outdoor exits, two meeting points (School oval and Eastern meeting point), and a central shared path called PINCH. These are exit-reference IDs, not the nine gate-control IDs. Routes are advisory, unverified against the approved emergency plan, with distances approximately ±10%. No building interiors, accessible-route distinction or refuges are included. The interactive site reference shows recorded connections and distances, not actual path geometry. Previewing PINCH unavailable excludes routes through that shared path. If there is no recorded alternative, the display says so. The map is not a live evacuation instruction and does not operate gates, doors or projectors.

## CCTV, guidance and emergencies
CCTV, PTZ tracking and projector guidance require the relevant plan and actual commissioned equipment. No camera feed, fire detection, projector broadcast or safe route is inferred from a demonstration. Fire and lockdown command results require controller confirmation. Follow the school's approved emergency plan and authorised staff instructions. The helper cannot select live evacuation routes or initiate emergency actions.

## Knowledge helper
The software helper searches the bundled project guides and can use an AI provider to explain matching excerpts. Source excerpts remain available when no AI key is configured. Answers cannot operate gates or edit settings. If the guides do not establish an answer, the helper must say so. For Claude, set AI_PROVIDER=anthropic, store ANTHROPIC_API_KEY as a server secret and optionally set ANTHROPIC_MODEL. For OpenAI, select AI_PROVIDER=openai with OPENAI_API_KEY and optionally OPENAI_MODEL. Deploy after changing server configuration. Never paste keys into the help chat. A configured key is not proof of a successful provider response; the panel says AI connected only after an answer succeeds. Questions, recent conversation, matching guide passages and limited non-secret context are sent to that provider only when configured. No account credentials, user profiles, footage or activity records are automatically included.

## Classroom projection screen
The classroom concept preview uses the new GuidanceProjection component. Its example is the uploaded site layer's Exit 12 → central crossing (70.9 m) → School oval (17.2 m), approximately 88.1 m in total. The first instruction is to leave by Exit 12; the screen also says to stay clear of the internal driveway. This is an outdoor recorded connection, not a verified route from a named classroom. The displayed demonstration label remains visible. No live incident, connected projector or safe route is claimed.

## Pi deployment status and commissioning
At the owner's update on 19 September 2026 no Pi is deployed. There is no existing service URL, issued token or decided relay mapping to recover. School IT must first establish an approved route from the cloud portal to a genuine reachable HTTPS origin. The origin must have a valid certificate, no embedded credentials, no extra path, query or fragment. Generate a private printable service token of at least 32 characters during deployment, and configure the same value as Pi DOOR_API_TOKEN and portal DOOR_SERVICE_TOKEN without placing it in chat or Git. Decide and verify the channel assignment against the actual wiring. Software tests and a published pulse fix do not prove physical gate operation. A witnessed six-second open command returning a valid 200 acknowledgement, plus onsite checks, is still required. The independent sensor-controller agent has its own controller credentials when that workflow is used.

## Shared-path inspection note
The recorded shared path to the oval is 17.2 m. Many recorded routes converge there. Inspect the physical opening on site: the route data does not establish its width, whether it is a single fence opening, or its capacity. Do not infer a confirmed bottleneck or a hardware remedy from distance alone.

## Dashboard and navigation
Use the left navigation to open Dashboard, Gates & booms, CCTV & zones, Emergency guidance, Gate schedules, Automation, Safety protocol, Access & users, Activity log, or System settings. On a phone use the menu button to reveal navigation. The dashboard shows the two active gates. The Magic Keys AI-head background is branding, not an indicator that an AI controller is connected. The help button remains available across the signed-in workspace.

## Gate lights, offline status and position
A green gate light represents confirmed open position and red represents confirmed closed position only when independent position feedback is current. Inactive gates are grey. Unknown, uncommissioned, offline, pending or failed controller states must not be read as open or closed. Controller feedback older than 90 seconds is stale. The ACB-004 open-only pulse has no position sensors; a successful trigger does not turn its physical position into a verified fact.

## Activity log and CSV export
Open Activity log to review operator requests, settings changes and controller acknowledgements. Use Export CSV to download the displayed activity records; the button is unavailable when the list is empty. An entry saying requested or queued is not a completed operation. Read the acknowledgement or failure and its time when investigating a fault. The helper does not read or send the activity records to the AI provider.

## Editing a profile photo or name
Open Access & users and use the profile editor to change your own display name, portal username, contact information, job title or profile photo. Save the profile after editing. Use the photo controls to upload or remove your image. Changing a display name does not grant a different access role or change the sign-in password. Managing another person's profile requires administrator authority and the settings unlock.

## Plan upgrades and locked features
Gate Operations is the core plan. Camera and advanced emergency-guidance features require Magic Keys Advanced. A module switch, relay assignment or administrator password does not grant a plan upgrade. Use the upgrade enquiry in the locked feature or contact RJL. Upgrading the plan does not connect cameras or commission hardware automatically; those are separate installation tasks. The outdoor site reference remains an advisory reference.

## CCTV and camera connections
Open CCTV & zones for the camera workspace or feature preview. Camera event verification is a module in System settings. No live footage is connected merely because this switch is enabled. Camera feeds and authorised endpoints need separate commissioning. The multi-screen scenes and sample cameras explain the concept; they are not live surveillance. The helper cannot see camera footage, identify people or detect incidents.

## Gate schedules and automation rules
Open Gate schedules, unlock administrator settings, select the gate and edit its weekly operating times before saving. Open Automation for operating rules. Both changes need administrator authority and the settings password. A saved timetable or enabled rule is stored configuration, not evidence that the Pi or controller has executed it. Check the commissioned controller workflow and activity acknowledgement. Do not assume an overnight hold or an automatic release is supported without confirming the installed controller behaviour.

## Remote-open troubleshooting
If Remote open says not configured, the HTTPS service endpoint, shared secret and relay assignment have not all been installed. If configuration is incomplete, have the administrator review the endpoint format, token and map without posting them into chat. If no verified pulse acknowledgement is received, the trigger may already have occurred: inspect locally before another request. Do not repeatedly press Open. A dry-run response is a simulation. Inactive gates are blocked; emergency priority can also block manual remote open. Viewer accounts cannot operate gates.

## Administrator unlock and access troubleshooting
Sign in as an administrator, open System settings, then enter the separate administrator settings password. A normal portal sign-in does not unlock relay settings. The unlock lasts ten minutes and can be ended with Lock settings. If controls relock, unlock again. If access is denied, confirm the approved account and role with RJL; changing profile details cannot bypass approval. Forgot password on the login page requests administrator assistance and does not itself reset the password.

## Voice announcements and refresh interval
Administrator equipment settings include dashboard refresh from 5 to 60 seconds, announcement speed from 0.5 to 1.5 and volume from 0 to 1. Monitoring settings include Australian English announcements. Device volume, browser speech support and available voices affect playback. Muting voice does not change a gate. Refreshing the dashboard polls portal data and does not prove the physical controller is connected.

## Controller credentials and relay commissioning
Access & users contains Separate controller commissioning for the sensor-equipped OPEN/CLOSE agent. An administrator can issue or rotate a credential and download its setup file once. That credential is not the portal login or Pi DOOR_API_TOKEN. Transfer it securely to the intended controller and verify heartbeats, safety and position inputs. Issued credentials alone do not mean a controller is online. Compass ACB-004 remote open is a separate integration; do not mix its token or status with this workflow.

## Project files, backups and deployment
The complete project export includes the app frontend, server API routes, database schema and migrations, controller agent, Pi service, tests, guides and deployment package. Runtime secret values, live D1 records and R2 uploads are not included in a source export. Store secrets separately. Applying a GitHub change alone does not publish the OpenAI-hosted site. The bundled help index is rebuilt with the hosted build so guide updates ship with the matching version.

## Help chat, sources and privacy
The Magic Keys help panel supports questions, follow-ups, current-page context, suggested questions, guide search and source passages. New chat clears the conversation in this browser tab. Reloading the page clears it too; conversations are not saved to the portal database or browser storage. When AI is configured, the current question, up to six recent messages, matching guides, page name, account role, plan and a non-secret configuration summary are sent to the configured provider, Anthropic (Claude) or OpenAI, named in the help panel. The account email, profile, activity log, footage, passwords and secret configuration values are not automatically sent. OpenAI requests use store:false. Claude uses the Anthropic Messages API. Provider handling and retention follow the applicable provider data policy; neither setting guarantees zero retention. Never type secrets or personal records into chat. Without a connection, the helper displays matching guide text clearly labelled as a guide excerpt. It cannot repair or operate hardware, change settings or reset passwords.

## Per-account roles and existing accounts
Each approved account can be assigned viewer, operator or administrator. Google approval entries accept email|role; Microsoft entries accept tenant-id:object-id|role. Password accounts use PORTAL_ROLE and PORTAL_SECONDARY_ROLE. Existing unannotated accounts retain administrator access for compatibility; this does not mean that school staff have already been assigned lower-privilege roles. RJL must explicitly configure those assignments. Invalid or duplicate role entries fail closed. Changing or removing an assignment invalidates the affected signed-in session and pending password verification; sign in again. Viewer access can read, operator access can issue permitted gate commands, and administrator access can manage protected settings after password verification. The helper cannot assign a role.

## Controller reporting versus field commissioning
Controller reporting indicates current received heartbeat data. The internal legacy commissioned flag records that an initial healthy heartbeat with a known position was received; it is not a field commissioning record. No gate movement is required to set that flag. Reserve field commissioning for witnessed open-and-auto-close and the required onsite checks and sign-off. Neither a heartbeat nor the dashboard counts certify that this has happened.

## Detection trial and false-alarm performance
Site-specific detection and false-alarm performance established at the paid trial stage. The portal does not publish a validated detection accuracy or false-alarm rate for the school. Concept demonstrations do not establish real-camera performance and must not be described as a tested live detection service.

## Missing recorded alternatives are not blocked physical exits
When the shared path is excluded, 17 of the 22 exits have no recorded alternative in the supplied outdoor layer. This is a limitation of the traced data, not evidence that those exits are physically stranded or that no other route exists. The layer contains the routes drawn in the supplied overlay. Inspect and measure the opening and have the school verify routes before presenting any bottleneck finding or proposing a hardware remedy.

## Owner access and restricted school accounts
A server-configured owner account has administrator permissions and access to advanced software sections. Owner access is established from verified Google sign-in or the configured password account, not from profile edits or browser claims. Other accounts retain their assigned roles and the school's plan. The deployment can restrict all sign-in paths to an explicit email list; removing an email rejects its existing sessions too. School operator accounts can use permitted controls for the two active gates and read status, but cannot unlock administrator settings, manage other users, issue controller credentials or issue emergency commands. The settings password, authenticator and physical safety checks still apply to owner actions. Owner access does not make unconfigured equipment or AI services live.

## How the helper learns the app
The helper reads relevant passages from the bundled project guides each time you ask a question. It uses your current page, account role and plan to explain the documented controls. It does not retrain itself, permanently remember conversations or accept file uploads in the help panel. To update its knowledge, update the project guides and publish the site; the help index is rebuilt during each hosted build. It can explain documented settings but cannot apply changes or operate equipment.
