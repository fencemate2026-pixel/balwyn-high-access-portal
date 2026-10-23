// Shared with the interface; the API is the authority for every mutation.
export const PROTECTED_SETTINGS_ACTIONS = new Set([
  "add_automation", "toggle_automation", "delete_automation",
  "update_settings", "provision_controller", "reset_auth_lockouts",
  "record_service",
  // save_schedule is NOT here (24 Oct 2026, Jarrod: setting a schedule is a
  // standard task). It still needs a signed-in administrator; the settings
  // password added on 10 Oct 2026 is no longer asked for.
]);
// Staff sign-in account changes (app/api/accounts) also need the settings
// password from 10 Oct 2026 (Jarrod), replacing the 26 Sep 2026 direction.
