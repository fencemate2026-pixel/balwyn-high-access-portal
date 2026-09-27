"use client";
// Access & users → Staff sign-in accounts.
// Administrators create per-person email accounts, issue one-time setup links,
// change roles and disable accounts. All calls go to /api/accounts, which
// re-checks the administrator role on the server and writes every change to the
// activity log. No settings password is needed (client direction, 26 Sep 2026). This component holds no
// authority of its own: hiding a button here is presentation, not security.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, LoaderCircle, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Role = "viewer" | "operator" | "administrator";
type Account = {
  id: string; email: string; display_name: string; role: Role; active: boolean;
  password_set: boolean; last_sign_in_at: string | null; setup_expires_at: string | null;
};
type IssuedLink = { email: string; link: string; expiresAt: string };

const ROLE_TEXT: Record<Role, string> = {
  viewer: "View only (password)",
  operator: "Operator (password + authenticator)",
  administrator: "Administrator (password + authenticator)",
};
const when = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" }).format(new Date(value))
  : "Never";

async function call(body?: Record<string, unknown>) {
  const response = await fetch("/api/accounts", body
    ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }
    : { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The request could not be completed.");
  return result;
}

export default function PortalAccountsManager() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [busy, setBusy] = useState<string>("");
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const result = await call();
      setAccounts(Array.isArray(result.accounts) ? result.accounts as Account[] : []);
      setLoadedAt(Date.now());
    } catch (reason) {
      setAccounts(null);
      setLoadError(reason instanceof Error ? reason.message : "Accounts could not be loaded.");
    }
  }, []);

  useEffect(() => {
    // Loading the list is an external read; results arrive asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function run(key: string, body: Record<string, unknown>, success: string) {
    setBusy(key);
    try {
      const result = await call(body);
      if (typeof result.setupLink === "string") {
        const target = body.action === "create" ? String(body.email) : accounts?.find((a) => a.id === body.id)?.email ?? "";
        setIssued({ email: target, link: result.setupLink, expiresAt: String(result.expiresAt ?? "") });
      }
      toast.success(success);
      await load();
      return true;
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The change could not be saved.");
      return false;
    } finally { setBusy(""); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("create", { action: "create", email, displayName: name, role }, "Account created")) {
      setEmail(""); setName(""); setRole("viewer");
    }
  }

  async function copyLink() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.link); toast.success("Setup link copied"); }
    catch { toast.error("Copy failed. Select the link and copy it manually."); }
  }

  return (
    <section className="accounts-manager view-panel" aria-labelledby="accounts-title">
      <div className="view-panel-heading">
        <div><h2 id="accounts-title">Staff sign-in accounts</h2><small>Email and password accounts for staff without Google. Each person sets their own password from a one-time link.</small></div>
        <Button variant="outline" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw /> Refresh</Button>
      </div>

      <>
        {issued && <div className="credential-issued accounts-link" role="status">
          <KeyRound aria-hidden="true" />
          <span><strong>Setup link for {issued.email}</strong><small>Give this to the person directly (not by group email). It works once and expires {when(issued.expiresAt)}. It is not shown again.</small><code>{issued.link}</code></span>
          <Button onClick={() => void copyLink()}><Copy /> Copy link</Button>
          <Button variant="ghost" onClick={() => setIssued(null)}>Close</Button>
        </div>}

        <form className="accounts-create" onSubmit={create}>
          <label><span>Full name</span><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Sam Lee" /></label>
          <label><span>School email</span><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required placeholder="name@balwynhs.vic.edu.au" /></label>
          <label><span>Role</span><NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_TEXT) as Role[]).map((value) => <NativeSelectOption key={value} value={value}>{ROLE_TEXT[value]}</NativeSelectOption>)}</NativeSelect></label>
          <Button type="submit" disabled={busy === "create"}>{busy === "create" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <UserPlus />} Create account</Button>
        </form>

        {loadError ? <p className="accounts-error" role="alert">{loadError}</p>
          : accounts === null ? <p className="accounts-empty" role="status"><LoaderCircle className="animate-spin motion-reduce:animate-none" /> Loading accounts…</p>
          : accounts.length === 0 ? <p className="accounts-empty">No staff accounts yet. Create the first one above.</p>
          : <div className="accounts-table-wrap"><table className="accounts-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{accounts.map((account) => <tr key={account.id} className={account.active ? "" : "is-disabled"}>
              <td><strong>{account.display_name}</strong><small>{account.email}</small></td>
              <td><NativeSelect aria-label={`Role for ${account.display_name}`} value={account.role} disabled={Boolean(busy)} onChange={(e) => void run(`role-${account.id}`, { action: "update", id: account.id, role: e.target.value }, "Role changed. That person must sign in again.")}>{(Object.keys(ROLE_TEXT) as Role[]).map((value) => <NativeSelectOption key={value} value={value}>{ROLE_TEXT[value]}</NativeSelectOption>)}</NativeSelect></td>
              <td>{!account.active ? "Disabled" : account.password_set ? "Active" : account.setup_expires_at && Date.parse(account.setup_expires_at) > loadedAt ? "Waiting for password" : "Setup link expired"}</td>
              <td>{when(account.last_sign_in_at)}</td>
              <td className="accounts-actions">
                <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run(`reset-${account.id}`, { action: "reset", id: account.id }, "New setup link issued. The old password no longer works.")}><KeyRound /> New setup link</Button>
                <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run(`active-${account.id}`, { action: "update", id: account.id, active: !account.active }, account.active ? "Account disabled and signed out" : "Account enabled")}>{account.active ? "Disable" : "Enable"}</Button>
              </td>
            </tr>)}</tbody>
          </table></div>}
      </>
    </section>
  );
}
