/** Spoken emergency scripts. Repeat only after the utterance ends. */
export function emergencyVoiceScript(mode: "lockdown" | "fire") {
  if (mode === "lockdown") {
    return "Warning. Lockdown. Close commands have been issued. Check every gate confirmation. Move inside, secure the area and await an authorised all-clear.";
  }
  return "Warning. Fire evacuation. Open commands have been issued. Check every gate confirmation. Evacuate by the nearest safe exit and follow the school emergency plan.";
}
