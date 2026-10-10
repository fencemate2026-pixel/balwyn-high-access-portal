"use client";

/**
 * Gate cycle counter (tally) and service tracking UI.
 *
 * GateServiceStrip: shown on each gate card. Operations since the last service
 *   against the service limit (default 4,000), with the next scheduled date.
 * GateServiceSummary: dashboard row. Earliest scheduled service, gates due, and
 *   the administrator "Record service" dialog (resets a gate's count).
 *
 * Data comes from the portal snapshot (lib/gate-service.ts → snapshot.service).
 * The count only includes openings Magic Keys triggered and confirmed, so the
 * UI always says so: it must never be read as a full mechanical cycle count.
 */
import { useState } from "react";
import { Gauge, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Gate, GateServiceInfo } from "@/lib/portal-model";

export const COUNTING_CAVEAT =
  "Counts openings sent through Magic Keys. Fob, keypad, exit-button and school-system openings are not counted until position sensors are fitted.";

const MELBOURNE = "Australia/Melbourne";
const number = (value: number) => value.toLocaleString("en-AU");

export function serviceDateLabel(iso: string | null) {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: MELBOURNE }).format(new Date(time));
}

/** Today's date in Melbourne as YYYY-MM-DD (the latest date a service can be recorded for). */
export function melbourneToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: MELBOURNE }).format(now);
}

export function serviceStateLabel(info: GateServiceInfo) {
  if (info.state === "due") return info.dueReason === "operations" ? "Service due: limit reached" : "Service due";
  if (info.state === "soon") return "Service soon";
  return "Within service limits";
}

/** Per-gate tally. `info` undefined/null means counting is not active yet. */
export function GateServiceStrip({ gateName, info }: { gateName: string; info: GateServiceInfo | null | undefined }) {
  if (!info) {
    return <div className="gate-service-strip state-idle" title={COUNTING_CAVEAT}>
      <div className="gate-service-head"><span><Gauge aria-hidden="true" /> Gate cycles since service</span><em>Not active yet</em></div>
      <strong>—</strong>
      <p>The cycle counter starts once service tracking is switched on for this site.</p>
    </div>;
  }
  const ratio = info.operationLimit > 0 ? info.operationsSinceService / info.operationLimit : 0;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const next = serviceDateLabel(info.nextServiceAt);
  return <div className={`gate-service-strip state-${info.state}`} title={COUNTING_CAVEAT}>
    <div className="gate-service-head">
      <span><Gauge aria-hidden="true" /> Gate cycles since service</span>
      <em>{serviceStateLabel(info)}</em>
    </div>
    <strong className="gate-service-count">{number(info.operationsSinceService)}<small>/ {number(info.operationLimit)}</small></strong>
    <div
      className="gate-service-bar"
      role="progressbar"
      aria-label={`${gateName}: ${number(info.operationsSinceService)} of ${number(info.operationLimit)} operations since last service`}
      aria-valuemin={0}
      aria-valuemax={info.operationLimit}
      aria-valuenow={Math.min(info.operationsSinceService, info.operationLimit)}
    ><i style={{ width: `${percent}%` }} /></div>
    <p>
      <span>Total {number(info.totalOperations)}</span>
      <span>{next ? `Next service ${next}` : "Last service not recorded yet"}</span>
    </p>
  </div>;
}

type SummaryProps = {
  gates: Gate[];
  service: Record<string, GateServiceInfo> | null | undefined;
  isAdministrator: boolean;
  busy: boolean;
  onRecord: (gateId: string, servicedOn: string) => Promise<void>;
};

/** Dashboard row: next scheduled service, gates due, and the admin "Record service" control. */
export function GateServiceSummary({ gates, service, isAdministrator, busy, onRecord }: SummaryProps) {
  const [open, setOpen] = useState(false);
  const [gateId, setGateId] = useState(gates[0]?.id ?? "");
  const [servicedOn, setServicedOn] = useState(() => melbourneToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tracked = service ? gates.map((gate) => ({ gate, info: service[gate.id] })).filter((entry): entry is { gate: Gate; info: GateServiceInfo } => Boolean(entry.info)) : [];
  const due = tracked.filter((entry) => entry.info.state === "due");
  const soon = tracked.filter((entry) => entry.info.state === "soon");
  const scheduled = tracked
    .filter((entry) => entry.info.nextServiceAt)
    .sort((a, b) => Date.parse(a.info.nextServiceAt!) - Date.parse(b.info.nextServiceAt!))[0];
  const intervalMonths = tracked[0]?.info.intervalMonths ?? 6;
  const limit = tracked[0]?.info.operationLimit ?? 4000;

  const detail = !service
    ? "Countdown starts after commissioning"
    : scheduled
      ? `${serviceDateLabel(scheduled.info.nextServiceAt)} · ${scheduled.gate.name}`
      : `Record each gate’s last service to start the ${intervalMonths}-month countdown`;

  async function submit() {
    setError(null);
    if (!gateId) { setError("Choose a gate."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(servicedOn) || servicedOn > melbourneToday()) { setError("Choose the date the service was completed (not a future date)."); return; }
    setSaving(true);
    try {
      await onRecord(gateId, servicedOn);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The service could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="gate-service-overview" aria-label="Gate service and cycle counter">
    <div className="gso-main">
      <span className="gso-icon" aria-hidden="true"><Wrench /></span>
      <div>
        <small>Gate service</small>
        <strong>Next scheduled service</strong>
        <p>{detail}</p>
      </div>
    </div>
    <div className="gso-rule">
      <small>Service rule</small>
      <span>Every {intervalMonths} months or {number(limit)} gate cycles, whichever comes first. RJL is alerted if a gate reaches the cycle limit before its service date.</span>
    </div>
    <div className="gso-actions">
      {(due.length > 0 || soon.length > 0)
        ? <span className={`service-alert ${due.length ? "is-due" : "is-soon"}`} role="status">
            <Wrench aria-hidden="true" />
            {due.length
              ? `${due.length} gate${due.length === 1 ? "" : "s"} due for service`
              : `${soon.length} gate${soon.length === 1 ? "" : "s"} near ${number(limit)} cycles`}
          </span>
        : service && <span className="service-alert is-ok" role="status">All gates within service limits</span>}
      {isAdministrator && service && (
        <Button type="button" variant="outline" size="sm" className="service-record-button" disabled={busy} onClick={() => { setError(null); setServicedOn(melbourneToday()); setOpen(true); }}>
          <Wrench aria-hidden="true" /> Record service
        </Button>
      )}
    </div>
    <p className="gso-note">{COUNTING_CAVEAT}</p>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="service-record-dialog">
        <DialogHeader>
          <DialogTitle>Record a completed gate service</DialogTitle>
          <DialogDescription>
            This resets the gate’s cycle count to 0 and sets its next scheduled service {intervalMonths} months after the service date. A service is also due early if the gate reaches {number(limit)} cycles first. The change is recorded in the activity log with your name.
          </DialogDescription>
        </DialogHeader>
        <form className="service-record-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="service-gate">Gate</label>
          <NativeSelect id="service-gate" value={gateId} onChange={(event) => setGateId(event.target.value)} disabled={saving}>
            {gates.map((gate) => <NativeSelectOption key={gate.id} value={gate.id}>{gate.name}</NativeSelectOption>)}
          </NativeSelect>
          <label htmlFor="service-date">Service completed on</label>
          <Input id="service-date" type="date" value={servicedOn} min="2020-01-01" max={melbourneToday()} onChange={(event) => setServicedOn(event.target.value)} disabled={saving} required />
          <p className="service-record-note">{COUNTING_CAVEAT}</p>
          {error && <p className="service-record-error" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Recording…" : "Record service"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
