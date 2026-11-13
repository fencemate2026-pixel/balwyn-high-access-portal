# Magic Keys staff guide

<!--
This guide is the only source the in-portal help assistant ("Ask Magic Keys") uses. It is written for school staff. It describes what is on screen and how to use it. Keep it free of technical, hosting, security or configuration detail: that belongs in docs/INTERNAL_TECHNICAL_HELP_NOTES.md. The help index build refuses to publish this file if it contains internal details.
Edit with care: every sentence here can be shown to any signed-in staff member.
-->

## What Magic Keys is
Magic Keys is the school's gate-operations portal for approved staff. It shows the live status of the school's installed gates, lets authorised staff open or close them with a confirmation step, keeps the gate schedules and stadium hire bookings, and records every important action in a permanent activity log. The two active gates are Tony Frizza Stadium Entry and Side Entry. Other gates on the site are listed for future activation and cannot be operated yet. Magic Keys is supplied and supported by RJL Commercial Group.

## Finding your way around
The left menu holds every page: Campus overview (the dashboard), Gate schedules, Stadium hire, CCTV & zones, Emergency guidance, Automation, Safety protocol, Access & users, Activity log and System settings. On a phone, tap the menu button to show the menu. The header across the top shows the fire / evacuation button, the system state, controller status and the alerts bell. The week calendar and local weather appear above each page. The Ask Magic Keys button in the corner opens this help chat on every page.

## Roles: viewer, operator and administrator
Every account has one role, shown on screen as View-only operator, Authorised operator or System administrator.
- Viewer: can see gate status, schedules, bookings and the activity log. Cannot operate gates or change anything.
- Operator: everything a viewer can do, plus open and close the active gates and add stadium hire bookings (without automatic gate opening).
- Administrator: everything an operator can do, plus the fire / evacuation button, gate schedules, automation rules, staff accounts, system settings, recording gate services and editing other people's profiles.
Some administrator changes also need the administrator settings password (see Unlocking administrator settings). Changing your name or photo never changes your role. Only an administrator can change a role.

## Signing in
On the sign-in page you can use your school email and password, Sign in with Google, or Sign in with Microsoft (when your school uses it). Only approved accounts can sign in. Operators and administrators who sign in with email and password also enter a six-digit code from an authenticator app. The first time, the portal shows how to set up the authenticator. If Google or Microsoft says your account is not approved, ask your school's portal administrator.

## Forgotten password or new account setup
Select Forgot password? on the sign-in page. Your school's portal administrator can send you a new setup link from Access & users. The link lets you choose a new password (at least 12 characters), works once and expires after 72 hours. Choosing a new password stops the old one working. Google and Microsoft passwords are managed by Google and Microsoft, not by Magic Keys. Never type a password into the help chat.

## Signing out and session length
Use the sign-out icon at the bottom of the left menu. For security, Magic Keys also signs you out when you close the tab, leave the site or reload the page, and a sign-in lasts at most 8 hours. If you are signed out unexpectedly, simply sign in again.

## Campus overview (dashboard)
Campus overview is the home page. Each active gate has its own card showing a 3D view of the gate, its current state, a health badge, OPEN and CLOSE buttons, temperature, heartbeat, safety input and the gate cycle counter. Below the gate cards are the Gate service panel and three gauges: Controller connection, Gate commissioning and Safety feedback. Select Gate controls on a card for that gate's full control panel.

## Gate card health badges and readings
The health badge on each gate card means:
- Controller online: the gate controller has reported in recently and its safety input is healthy.
- Awaiting feedback: the controller is reporting but the gate position or safety input is not confirmed yet.
- Attention required: the controller reported a fault, the safety input is blocked, or the last command failed or was blocked.
- Controller offline: nothing has been heard from the controller for more than 90 seconds.
- Not commissioned: the controller has not been set up and checked on site yet.
Heartbeat shows how many seconds ago the controller last reported. Temperature shows No sensor fitted when the gate has no temperature sensor. Safety input shows Healthy, Blocked or Pending. On the 3D view you can drag to rotate, use the mouse wheel to zoom, right-drag to move and double-click to reset.

## Opening or closing a gate
1. Sign in as an operator or administrator. Viewers cannot operate gates.
2. On Campus overview, find the gate card and press OPEN or CLOSE. You can also select Gate controls, then Review open command or Review close command.
3. Read the confirmation, make sure the gate area is supervised and clear, then press Queue OPEN command (or Queue CLOSE command).
4. The gate controller collects the command and reports back. The activity log shows the request and the controller's acknowledgement.
The buttons are greyed out when the controller is offline, the safety input is not healthy, a command is already waiting, or a fire / evacuation is active. The gate's own safety equipment can still stop a command. If something looks wrong, check the gate in person before trying again.

## Remote open
Some gates also have a Remote open section in Gate controls (Control tab) when your school has this connection set up. Press Review remote open, check the confirmation, then press Send open pulse. If the screen asks for a remote-open code, use the one supplied to your school and never share it in chat. A success message means the open signal was accepted; it does not prove the gate was seen opening, so look at the gate if it matters. If there is no confirmation, check the gate in person before trying again, and do not press repeatedly. To protect the gates, the portal refuses repeat requests for the same gate within a few seconds, and limits how many requests one person can make in a minute. Every remote-open request is recorded in the activity log with your name.

## Gate controls panel
Select Gate controls on a gate card to open the panel for that gate. Control tab: the command steps, the last command and the open and close buttons (and Remote open when available). If controls are blocked, the panel explains why, for example a view-only role or an active emergency. Schedule tab: that gate's weekly operating schedule, with Edit full schedule. Details tab: asset ID, controlled area, gate type, controller, safety input, last contact and last command.

## Gate cycle counter
Each gate card shows Gate cycles since service: how many times the gate has been opened through Magic Keys since its last recorded service, out of the service limit (normally 4,000), with a progress bar, the total count and the next service date. The state shows Within service limits, Service soon (from 90 % of the limit), Service due, or Service due: limit reached. The counter only counts openings sent through Magic Keys and confirmed (portal open commands and remote opens). Fob, keypad, exit-button and school-system openings are not counted until gate position sensors are fitted, so real use can be higher. If the card says Not active yet, cycle counting has not been switched on for your site.

## Gate service schedule
Gates are due for service every 6 months or after 4,000 gate cycles, whichever comes first. The Gate service panel on Campus overview shows the next scheduled service date and which gate it is for, and warns when any gate is near or past its limit. RJL is alerted automatically when a gate reaches the cycle limit before its scheduled date, so a service can be booked early. To book or ask about a service, contact RJL.

## Recording a completed service
After a gate has been serviced, an administrator records it so the counter starts again:
1. On Campus overview, find the Gate service panel and press Record service.
2. If asked, enter the administrator settings password.
3. Choose the gate and the date the service was completed (not a future date), then press Record service.
The gate's cycles-since-service count resets to 0, the next scheduled service is set 6 months after the service date, and the activity log records who did it. The total count is kept.

## Gate schedules
Open Gate schedules from the left menu. Choose the gate in Select gate, then set the Open time and Close time for each day and switch Automatic schedule on or off for that day. Copy Monday to weekdays copies Monday's times to Tuesday to Friday. Press Save schedule when done; the button says No unsaved changes when everything is saved. Changing schedules needs an administrator with the administrator settings password (the portal asks for it when you save). Operators and viewers can look but not change them. A fire / evacuation overrides schedules. A saved schedule is a plan for the controller; the activity log shows what the gate actually did.

## Stadium hire bookings
Open Stadium hire from the left menu, or New booking on the week calendar. The week board shows each day's bookings by space. Use the arrows and Today to move between weeks, and Calendar for the month view. To add a booking (operators and administrators):
1. Press New booking.
2. Fill in the client's Full name, Email and Phone, the Space, Date, Start and End time, and whether a deposit was received (and the amount).
3. Optional, administrators only: under Gates opened automatically for this booking, tick the gates to open and set how many minutes before the start to open and after the end to close (0 to 120, normally 15). No settings password is needed. Operators save bookings without gates.
4. Add any comments and press Save client and booking.
A booking that overlaps another booking in the same space is refused. Viewers can see bookings but not the client's email or phone. Bookings cannot be edited or cancelled in the portal yet: contact your portal administrator or RJL to change one.

## Week calendar and weather
The week calendar above each page shows bookings and gate open times for the week. Select a day to see its bookings and gate open windows, labelled Weekly schedule, Stadium hire or Automation. Use the arrows and Today to change week. The weather panel shows the local temperature, wind, rain and humidity for Balwyn with a 7-day forecast. The forecast comes from a public weather service and is for information only.

## Automation rules
Automation is for extra operating rules, such as holding a gate open for an event. It needs an administrator who has unlocked settings. Under Build a rule enter a Rule name, choose the Gate, choose Repeat (every week on chosen days, or once on a date), and set Hold open from and Release at, then press Add automation rule. Configured rules lists every rule with a switch to pause or enable it and a button to delete it. Rules are plans for the gate controller; the activity log shows what happened.

## Unlocking administrator settings
Some administrator changes need the separate administrator settings password, as well as an administrator sign-in. This covers automation rules, staff sign-in accounts, system settings, gate controller set-up, recording a gate service and editing other people's profiles. Enter the password when the portal asks (for example on Automation or System settings) and press Unlock settings. The unlock lasts 10 minutes and is recorded in the activity log. Press Lock settings to end it early. Operator and viewer accounts cannot unlock settings. If you do not know the password, ask your school's portal administrator or RJL.

## Access & users: your profile
Open Access & users and use Your profile to change your Display name, Portal username, Contact email, Phone and Role / job title. Use Change photo to upload a PNG, JPEG or WebP image up to 3 MB, or Remove photo. Press Save profile when done. Contact details do not change your access or role. Administrators who have unlocked settings can use Manage users to edit another person's profile.

## Access & users: staff sign-in accounts
Administrators manage staff accounts in Staff sign-in accounts on Access & users. Every change needs the administrator settings password; the portal asks for it if settings are locked.
- To add someone: enter their Full name, School email and Role, then press Create account. Copy the setup link shown and send it to them; it works once, expires after 72 hours and is not shown again.
- To change a role: choose the new role. The person must sign in again.
- New setup link: use when someone forgot their password or their link expired. Their old password stops working.
- Disable: signs the person out and stops them signing in. Enable lets them back in.
Status shows Active, Waiting for password, Setup link expired or Disabled. Google or Microsoft sign-in for a new person must be approved by RJL.

## Activity log
Activity log is the permanent record of gate commands, remote opens, controller acknowledgements, schedule and settings changes, settings unlocks, gate services and emergency actions, with the time and the person's name. Entries cannot be edited or deleted. Press Export CSV to download the list as a spreadsheet file. An entry that says requested or queued is not proof that a gate moved: look for the controller's acknowledgement or failure entry after it.

## System settings
System settings is for administrators who have unlocked settings. It shows the Current plan, shortcuts to relay controllers, schedules and automation, and the Monitoring switches: Gate-position monitoring (shows or pauses position feedback on screen), Fault alerts (emails RJL when a commissioned gate reports a fault; alerts for a controller that stops reporting are added at commissioning), and Australian English announcements (spoken gate and fire messages). Platform modules switch optional features on or off for your plan. Press Lock settings when finished.

## Fire / evacuation button
The fire / evacuation button is always at the top of the screen. Only administrators can use it; for everyone else it shows Administrator approval required.
1. Press START FIRE / EVACUATION.
2. Read the confirmation and press Issue OPEN commands.
3. The portal sends an OPEN command to every active gate and shows the Gates & booms page with each gate's status, plus a Triple Zero (000) call link. If voice announcements are on, a spoken warning repeats.
Always follow the school's emergency management plan and staff instructions first. The gates' own safety equipment still applies. Lockdown is not available on this site.

## Clearing a fire / evacuation
An administrator presses Clear emergency priority, then Clear priority. This only clears the emergency mode in the portal. It does not close any gate and does not declare the site safe. Gates opened by the fire command can stay open: check each gate and press CLOSE where needed, following the school's all-clear procedure.

## CCTV & zones and Emergency guidance (Magic Keys Advanced)
CCTV & zones (AI camera verification and site zones) and Emergency guidance (evacuation directions for staff and classroom screens) are part of the Magic Keys Advanced package. If your school does not have this package, these pages show example screens and the message: Contact the team for more information on how to unlock this package. Use Book a walkthrough, Book a demo or Talk to Jarrod on those pages to arrange a demonstration. The example screens are illustrations, not live cameras or live evacuation routes.

Camera privacy: Magic Keys Sentinel (the AI cameras in the Advanced package) is trained to look only for fire, smoke and weapons such as knives, guns and bats. It does not look for people unless they are linked to a threat. In normal operation it does not record or keep any footage or files of students or staff. Recording starts only when it detects a fire or a threat; if a person is linked to that threat, they are included in the recording so staff and emergency services can respond. Where the school has permission from parents, carers and staff, it can also record like the CCTV systems already in schools, but its job stays the same: finding fires and threats. The Magic Keys portal itself does not store CCTV footage.

## Fire and smoke reference pictures
Ask Magic Keys can explain a labelled set of still photos kept for fire and smoke work that is still in development. The set has 2,700 training photos and 300 test photos. Training has 900 fire, 900 smoke and 900 ordinary scenes. The test group has 100 of each. Every photo is a JPEG. Nothing in the set draws a box around the flame or the smoke. The only label is the folder the photo is in: fire, smoke, or an ordinary scene.

These are photographs people chose to take of a fire or of smoke. They are close, bright and centred. They are not pictures of this school's grounds, gates or corridors, and they are not recordings of students or staff. One frame of a far-off smouldering bin, a red vest, a sunset or a sunlit car roof can look alike. The set answers staff questions about what the reference pictures contain. The set's author reports about 85 percent correct on those 300 test pictures with a ResNet50 picture network. That figure has not been checked here. In the author's own examples one smoke picture was only about 0.45 sure, while another was almost certain. It is not a certified fire detector. It has not been scored on this school's cameras. A likeness to one of these photos does not start evacuation, open a gate or close a gate. Use the fire / evacuation button only when an authorised person has decided to, and follow the school's emergency plan and the fire indicator panel.

## Camera research on fire, smoke and weapons
Ask Magic Keys can also explain two external research projects. Neither is installed as this school's fire system. Neither may open a gate, close a gate, start evacuation or clear an emergency. A camera result is something a person looks at. The fire indicator panel, the school's incident controller and Triple Zero stay in charge.

The first project looks at a still photo, a video or a live camera for fire and smoke only. It draws a box and shows how sure it is. It can brighten a dim or hazy picture before it looks. On a live camera it can send one email with a snapshot, then wait 60 seconds before another email, so one continuing event does not fill an inbox. That email is a notice to a person. It is not an input to the fire panel, and it does not move a gate.

The second project is one watcher for 21 kinds of thing in the same view: a short gun, a long gun, a knife, fire, smoke, a phone, and ordinary objects such as a person, a car, a bag or an umbrella. On the author's own held-out test of 2,470 pictures and 6,780 marked objects, using a strict cutoff, the author reports recall and precision of: short gun 0.81 and 0.96, long gun 0.71 and 0.97, phone 0.80 and 0.98, knife 0.58 and 0.90, fire 0.58 and 0.96, smoke 0.50 and 0.95. Overall precision on that test was 0.91. That means few false alarms on the author's test. It does not mean the same result on this school's cameras. Those figures are the author's report. They have not been repeated here.

That project learned mostly from clear, close, staged pictures. On a blurred, wide or compressed camera view it misses more often, especially small objects. A broom, a pen, fog and steam were not in the pictures it learned from, so those mistakes are not measured. Magic Keys does not call a student, a staff member or a visitor armed or a threat because a camera said so. Recording rules stay as written under CCTV and zones.

## Colour alarm, fighting and incident notes
Ask Magic Keys can explain three further research projects. None of them is installed. None of them may open a gate, close a gate, start evacuation or clear an emergency.

One project does not learn from photos. It turns a picture into hue, saturation and lightness, keeps only the pixels in a fire-like colour range, and can play an alarm sound. A sunset, a red vest, a brake light or a stage light can fall in that same range. Colour alone is not a fire.

A larger research description lists fire, smoke, weapons, people, vehicles and someone entering a marked area. It saves a screenshot and a time, then a language model drafts an incident note. The sample note in that description, about smoke at a warehouse entrance, is an illustration. It is not an event at this school. Magic Keys does not recognise faces or number plates.

Another research screen looks at an uploaded video or a camera link for guns, knives, fire, smoke and fighting. It can keep a list of alerts with the time, the kind of alert and how sure it was. Magic Keys does not decide that a person is violent, armed or a threat from a camera. A person, the fire indicator panel and Triple Zero stay in charge.

## Pistol, knife and gun-action references
Ask Magic Keys can explain four further reference collections used while weapon detection is still in development. None of them is installed. None of them may open a gate, close a gate, or clear an emergency. Magic Keys does not call a student, a staff member or a visitor armed or a threat because a picture matched one of these collections.

One public-domain collection has 2,973 still pictures for finding a pistol in a photo. Each picture was stretched to a square of 416 by 416, and no extra altered copies were added. It has not been scored on this school's cameras. The pictures are not stored in the portal.

A video collection kept on the project workstation has 398 clips: 141 labelled handgun, 139 labelled machine gun, and 118 with no gun. A clip can include a frame-by-frame label. The clips are staged research actions from 2023, not recordings of this school. The licence does not allow commercial reuse, so the clips are not published from this portal.

Another description offers about 51,000 pictures with boxes drawn on guns, and about 51,000 more for sorting gun from not-gun. Many come from a movie firearms catalogue and were checked by a person. A couple of thousand come from cameras in a private office. The owner does not allow the pictures to be passed on. They are not in this portal.

A further collection, shared so others may reuse it if they give credit and share alike, has separate picture sets for a pistol and for a knife. Some sets only sort whether a weapon is present. Some draw a box. One set places weapons next to ordinary handled objects that can look similar. Those pictures are not this school's cameras.

## Safety protocol
Safety protocol is the school emergency safety protocol for the portal. Magic Keys supports trained staff; it does not replace the school's Emergency Management Plan, the fire indicator panel, emergency services, onsite judgement or physical emergency controls. Its six principles are: 01 Named human authority (only the school's authorised incident controller activates, changes or clears an emergency mode; staff call Triple Zero when required); 02 Independent manual fallback (physical alarms, keys, releases and local controls still work if the portal, power, internet, cameras or a controller is unavailable); 03 No camera-only decisions; 04 Movement is locally protected (safety beams, edges, loops and obstruction sensing have the final say, and a fault blocks the command); 05 Only approved guidance (screens show routes from the school-approved emergency plan only); 06 Test, record and review. The Stop rule: if information conflicts, a safety input is unhealthy, confirmation is missing or the real situation is uncertain, stop automation, use the approved manual procedure and follow authorised staff and emergency services. On the core plan this page shows Please contact RJL for access.

## Plans and upgrades
Gate Operations is the core plan. Magic Keys Advanced adds CCTV & zones, Emergency guidance and related modules. An administrator can press Upgrade plan in System settings or Discuss your school's upgrade on Campus overview to contact RJL. Upgrading does not connect cameras or other equipment by itself; installation is arranged with RJL.

## Alerts bell, system state and controller status
The header shows System state (No emergency active, or the emergency in progress), Controller status (All systems ready, or Commissioning while gates are still being set up) and the alerts bell. If a gate shows Attention required or Controller offline for more than a few minutes, check the gate and contact RJL.

## Reporting a fault or getting support
For gate faults, damage, a gate that will not open or close, the portal not loading or showing an error, or anything that looks unsafe: make the area safe first, then contact RJL Commercial Group at info@rjlcommercialgroup.com. Include the gate name, the time and what happened. The activity log time stamps help RJL find the problem quickly. For account or password problems, ask your school's portal administrator first.

## Using the help chat
Ask Magic Keys answers questions about using the portal: where things are, what a screen means and the steps to follow. It cannot press buttons, open gates, change settings, reset passwords or see cameras. It does not know live gate positions. Questions are recorded (without your email address) so RJL can improve the help, and may be reviewed by RJL; see the privacy policy. Do not type passwords, codes or personal details into the chat. For anything the chat cannot answer, contact your portal administrator or RJL.

## Privacy, cookies and security
The Privacy policy and Terms of use are linked at the bottom of the sign-in page. They explain what information Magic Keys keeps (such as account details, the activity log, stadium hire bookings and help questions), why, where it is stored and who to contact with a privacy question. Your browser needs cookies enabled: Magic Keys uses a secure sign-in cookie to keep you signed in, and connections to the portal are encrypted. The cookies are not used for advertising or tracking. Never share your password or authenticator codes with anyone, including in this chat.
