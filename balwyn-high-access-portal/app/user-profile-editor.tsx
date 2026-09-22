"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Camera, LockKeyhole, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { UserProfile } from "@/lib/profile-model";

export default function UserProfileEditor({ ownProfile, adminUnlocked, isAdministrator, onUnlock, onSaved }: {
  ownProfile: UserProfile | null; adminUnlocked: boolean; isAdministrator: boolean;
  onUnlock: () => void; onSaved: (profile: UserProfile) => void;
}) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [draft, setDraft] = useState<UserProfile | null>(ownProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void fetch(`/api/profile${adminUnlocked ? "?scope=all" : ""}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { profile?: UserProfile; profiles?: UserProfile[]; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || "Profiles could not be loaded.");
      if (!active) return;
      setProfiles(result.profiles ?? [result.profile]); setDraft(result.profile); setRemovePhoto(false); onSaved(result.profile);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Profiles could not be loaded."); });
    return () => { active = false; };
  // onSaved is an event callback; changing it must not discard an editing draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUnlocked, reload]);

  function saved(profile: UserProfile) {
    setProfiles((values) => values.map((value) => value.id === profile.id ? profile : value));
    onSaved(profile);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, removePhoto }) });
      const result = await response.json() as { profile?: UserProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || "Profile could not be saved.");
      setDraft(result.profile); setRemovePhoto(false); saved(result.profile); toast.success("Profile updated");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Profile could not be saved."); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    if (!draft || busy) return;
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 3 * 1024 * 1024) { setError("Choose a PNG, JPEG or WebP photo under 3 MB."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/profile/photo?id=${encodeURIComponent(draft.id)}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const result = await response.json() as { profile?: UserProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || "Photo could not be saved.");
      setDraft((value) => value ? { ...value, avatarUrl: result.profile!.avatarUrl } : value); setRemovePhoto(false); saved(result.profile); toast.success("Profile photo updated");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Photo could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className="profile-editor settings-card">
    <div className="panel-heading"><div><h2>{adminUnlocked ? "User profiles" : "Your profile"}</h2><small>Names, contact details and profile photos</small></div><UserRound /></div>
    {isAdministrator && !adminUnlocked && <div className="profile-admin-note"><span>Unlock administrator settings to edit other users.</span><Button variant="outline" onClick={onUnlock}><LockKeyhole /> Manage users</Button></div>}
    {adminUnlocked && profiles.length > 0 && <label className="profile-user-select">Select user<NativeSelect value={draft?.id ?? ""} onChange={(event) => { setDraft(profiles.find((value) => value.id === event.target.value) ?? null); setRemovePhoto(false); setError(""); }} disabled={busy}>{profiles.map((value) => <NativeSelectOption key={value.id} value={value.id}>{value.displayName}{value.id === ownProfile?.id ? " (you)" : ""}</NativeSelectOption>)}</NativeSelect><small>Users appear after their first sign-in.</small></label>}
    {error && <p className="profile-editor-error" role="alert">{error}</p>}
    {!draft ? <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Load profile</Button> : <form onSubmit={save} aria-busy={busy}>
      <div className="profile-photo-row"><div className="profile-photo-preview">{draft.avatarUrl && !removePhoto ? <img src={draft.avatarUrl} alt={`${draft.displayName} profile`} /> : <UserRound aria-hidden="true" />}</div><div><label className="profile-photo-upload"><Camera /> Change photo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label><small>PNG, JPEG or WebP · up to 3 MB</small>{draft.avatarUrl && !removePhoto && <button type="button" className="profile-remove-photo" disabled={busy} onClick={() => setRemovePhoto(true)}>Remove photo</button>}</div></div>
      <fieldset disabled={busy} className="profile-fields">
        <label>Display name<Input value={draft.displayName} maxLength={100} required onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
        <label>Portal username<Input value={draft.username} minLength={3} maxLength={40} autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
        <label>Contact email<Input type="email" value={draft.contactEmail} maxLength={254} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} /></label>
        <label>Phone<Input type="tel" value={draft.phone} maxLength={40} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        <label>Role / job title<Input value={draft.jobTitle} maxLength={100} placeholder="e.g. Facilities manager" onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })} /></label>
      </fieldset>
      <p className="profile-account-note">Contact details do not change account permissions or your connected Google or Microsoft identity.</p>
      <Button type="submit" disabled={busy}><Save />{busy ? "Saving…" : "Save profile"}</Button>
    </form>}
  </section>;
}
