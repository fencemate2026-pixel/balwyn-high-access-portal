"use client";

import { useState, type FormEvent } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminSettingsUnlock({ onUnlocked }: { onUnlocked: (expiresAt: number) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/admin", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000),
      });
      const body = await response.json() as { unlocked?: boolean; expiresAt?: number; error?: string };
      if (!response.ok || !body.unlocked || !body.expiresAt) throw new Error(body.error || "Settings could not be unlocked.");
      setPassword("");
      onUnlocked(body.expiresAt);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be unlocked."); }
    finally { setBusy(false); }
  }
  return <form className="admin-unlock-form" onSubmit={unlock} aria-busy={busy}>
    <label htmlFor="admin-settings-password">Administrator password</label>
    <Input id="admin-settings-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={1024} required autoFocus />
    {error && <p role="alert">{error}</p>}
    <Button type="submit" disabled={busy || !password}><LockKeyhole />{busy ? "Verifying…" : "Unlock settings"}</Button>
    <small><ShieldCheck /> Settings lock again after 10 minutes. Changes are recorded.</small>
  </form>;
}
