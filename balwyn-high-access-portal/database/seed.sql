INSERT INTO balwyn_portal.system_state (id, mode, lockdown_active, fire_alarm_active, muster_point, updated_by)
VALUES (1, 'normal', FALSE, FALSE, 'Western oval assembly', 'seed')
ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = NOW();

INSERT INTO balwyn_portal.gate_states (gate_id, name, zone, status, automation_mode, relay_channel, open_percent, issue, camera_online)
VALUES
  ('gate-north', 'North Entry Vehicle Gate', 'North Entry', 'open', 'scheduled', 1, 100, NULL, TRUE),
  ('gate-admin', 'Admin Forecourt Bollards', 'Admin Forecourt', 'locked', 'ai-assisted', 2, 0, NULL, TRUE),
  ('gate-sports', 'Sports Precinct Roller Gate', 'Sports Precinct', 'moving', 'scheduled', 3, 46, NULL, TRUE),
  ('gate-service', 'Service Lane Access Gate', 'Service Lane', 'issue', 'manual', 4, 8, 'Photo-eye obstruction detected', FALSE)
ON CONFLICT (gate_id) DO NOTHING;

INSERT INTO balwyn_portal.access_rules (id, name, zone, credential_group, schedule, threat_level_limit, enabled, notes)
VALUES
  ('rule-admin', 'Staff daylight access', 'Admin Forecourt', 'Teaching + Admin', 'Mon-Fri 06:30-18:30', 'Normal', TRUE, 'Auto-open when credential and ANPR match.'),
  ('rule-hire', 'After-hours hire perimeter', 'Sports Precinct', 'Facility Hire Hosts', 'Bookings only', 'Elevated', TRUE, 'Requires escort notification after 21:00.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO balwyn_portal.automation_rules (id, name, gate_id, opens_at, closes_at, days, action, enabled, source)
VALUES
  ('sched-1', 'Morning ingress', 'gate-north', '06:45', '08:45', ARRAY['Mon','Tue','Wed','Thu','Fri'], 'open', TRUE, 'scheduled'),
  ('sched-2', 'Evening sports hire lock', 'gate-sports', '21:10', '21:20', ARRAY['Mon','Wed','Fri'], 'lock', TRUE, 'ai-assisted')
ON CONFLICT (id) DO NOTHING;

INSERT INTO balwyn_portal.hire_requests (id, organisation, contact_name, location, start_iso, end_iso, expected_attendance, status)
VALUES
  ('hire-1', 'Balwyn Netball Association', 'Renee Jackson', 'Sports Precinct', NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 120, 'approved')
ON CONFLICT (id) DO NOTHING;
