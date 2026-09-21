"use client";

import { useEffect, useRef, useState } from "react";
import { UnlockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { loadRemoteOpenConfig, requestRemoteOpen, type RemoteOpenConfig } from "@/lib/remote-open-client";

export default function RemoteOpenPanel({ endpoint, gateId, allowed = true, demo = false }: { endpoint: string; gateId: string; allowed?: boolean; demo?: boolean }) {
  const [config, setConfig] = useState<RemoteOpenConfig | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  useEffect(() => {
    let active = true;
    loadRemoteOpenConfig(endpoint).then((value) => { if (active) setConfig(value); }).catch(() => { if (active) setMessage("Remote open unavailable. Contact the administrator."); });
    return () => { active = false; };
  }, [endpoint]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMessage("");
      setConfirm(false);
      setOperatorToken("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [gateId]);
  if (config?.configured === false || (!config && !message)) return null;
  const door = config?.gateMap?.[gateId];

  async function open() {
    if (running.current || !door || !allowed) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    setConfirm(false);
    try {
      const result = await requestRemoteOpen(endpoint, gateId, operatorToken);
      setMessage(result.status === "dry_run" ? `Dry run recorded for door ${result.door}. No hardware was operated.` : `Door ${result.door}: ${result.pulseMs} ms relay pulse acknowledged. Physical position is unknown.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pulse outcome unknown. Inspect locally before retrying.");
    } finally {
      running.current = false;
      setBusy(false);
      setOperatorToken("");
    }
  }

  return <section className="remote-open-panel" aria-label="Compass ACB-004 remote open">
    <h3>Remote open · Compass ACB-004</h3>
    <p>{demo ? "The controls above are simulated. " : ""}This sends one open-only relay pulse to the existing board. It provides no position or safety feedback.</p>
    {door ? <>
      <small>{gateId} · Door {door} · Physical position unknown</small>
      {config?.operatorTokenRequired && <label>Remote-open operator token<Input type="password" autoComplete="off" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} placeholder="Enter your separate operator token" disabled={busy} /></label>}
      <Button className="open-gate-command" disabled={!allowed || busy || (!!config?.operatorTokenRequired && operatorToken.length < 32)} onClick={() => setConfirm(true)}><UnlockKeyhole /> {busy ? "Sending pulse…" : "Review remote open"}</Button>
      {!allowed && <p>Remote open is unavailable under the current operator permissions or emergency priority.</p>}
    </> : config?.configured && <p>No verified ACB-004 channel is assigned to this gate.</p>}
    {message && <p role="status">{message}</p>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Send open pulse to door {door}?</AlertDialogTitle><AlertDialogDescription>Confirm the gate area is supervised and clear. This is a one-way request through the existing Compass ACB-004. Local safety controls remain in charge. A relay acknowledgement cannot confirm that the door opened.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={!allowed || busy} onClick={() => void open()}>Send open pulse</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}
