-- 24 Oct 2026 (Jarrod): show the gate Pi's CPU temperature in the gate panel.
-- The controller sends it with every poll; NULL when the Pi could not read it.
-- It is the Pi processor's temperature, not the enclosure air temperature.
ALTER TABLE balwyn_portal.gate_states ADD COLUMN IF NOT EXISTS cpu_temp_c double precision;
