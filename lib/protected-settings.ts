// Shared with the interface; the API is the authority for every mutation.
export const PROTECTED_SETTINGS_ACTIONS = new Set([
  "save_schedule", "add_automation", "toggle_automation", "delete_automation",
  "update_settings", "provision_controller", "reset_auth_lockouts",
]);
