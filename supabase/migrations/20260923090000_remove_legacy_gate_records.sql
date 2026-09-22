DELETE FROM balwyn_portal.gate_schedules
WHERE gate_id IN (
  'SCP-B01', 'SCP-B02', 'SCP-B03', 'SCP-B04', 'SCP-B05', 'SCP-B06',
  'SCP-B07', 'SCP-B08', 'SCP-B09', 'SCP-B10', 'SCP-B11', 'SCP-B12',
  'FRONT-DG01', 'FRONT-DG02', 'FRONT-DG03'
);

DELETE FROM balwyn_portal.command_queue
WHERE gate_id IN (
  'SCP-B01', 'SCP-B02', 'SCP-B03', 'SCP-B04', 'SCP-B05', 'SCP-B06',
  'SCP-B07', 'SCP-B08', 'SCP-B09', 'SCP-B10', 'SCP-B11', 'SCP-B12',
  'FRONT-DG01', 'FRONT-DG02', 'FRONT-DG03'
);

DELETE FROM balwyn_portal.gate_states
WHERE gate_id IN (
  'SCP-B01', 'SCP-B02', 'SCP-B03', 'SCP-B04', 'SCP-B05', 'SCP-B06',
  'SCP-B07', 'SCP-B08', 'SCP-B09', 'SCP-B10', 'SCP-B11', 'SCP-B12',
  'FRONT-DG01', 'FRONT-DG02', 'FRONT-DG03'
);
