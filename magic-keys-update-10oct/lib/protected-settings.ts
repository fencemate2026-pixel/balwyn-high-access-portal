// Shared with the interface; the API is the authority for every mutation.
export const PROTECTED_SETTINGS_ACTIONS = new Set([
  "add_automation", "toggle_automation", "delete_automation",
  "update_settings", "provision_controller", "reset_auth_lockouts",
  "record_service",
  // 10 Oct 2026 (Jarrod): gate schedules decide when school gates stand open,
  // so they need an administrator plus the settings password, like automation.
  "save_schedule",
]);
// Staff sign-in account changes (app/api/accounts) also need the settings
// password from 10 Oct 2026 (Jarrod), replacing the 26 Sep 2026 direction.
