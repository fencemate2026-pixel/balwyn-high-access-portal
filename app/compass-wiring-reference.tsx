import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CompassWiringReference() {
  return (
    <section className="settings-card compass-wiring-reference" aria-labelledby="compass-wiring-title">
      <div className="panel-heading">
        <div>
          <h2 id="compass-wiring-title">Wiring</h2>
          <small>Compass ACB-004 · Magnetic lock · Roger F70/IPU36</small>
        </div>
      </div>
      <p>The existing four-door Compass controller remains in place. This reference describes the lock-power and gate-command connections; the installed board, lock ratings and local release sequence must be checked during commissioning.</p>

      <div className="compass-wiring-isolation">
        <strong>Keep lock power separate from the gate command.</strong>
        <p>NC and NO on one changeover relay share COM. Once that COM carries the lock’s +12 V supply, its NO is a switched power output. It cannot also provide the Roger’s voltage-free command. Use a correctly rated local interface or sequencer with electrically isolated contacts.</p>
      </div>

      <div className="compass-wiring-steps">
        <section aria-labelledby="maglock-wiring-title">
          <h3 id="maglock-wiring-title">1. Magnetic lock (fail-safe)</h3>
          <p>A fail-safe maglock stays locked while powered and releases when power is interrupted. Use 12 V DC only when specified on the installed lock.</p>
          <ul>
            <li><strong>Lock negative (−):</strong> connect to the dedicated lock power supply’s negative terminal.</li>
            <li><strong>Lock positive (+):</strong> connect to NC on the assigned ACB-004 door relay.</li>
            <li><strong>Lock supply positive:</strong> connect to COM on that same door relay, through the approved protected supply and emergency-release arrangement.</li>
          </ul>
          <p>An authorised access request opens the NC path and removes lock power. Confirm contact ratings and retain the installed emergency power-release circuit.</p>
        </section>
        <section aria-labelledby="roger-wiring-title">
          <h3 id="roger-wiring-title">2. Roger F70/IPU36 open command</h3>
          <p>The local interface must release the lock before requesting movement. Its separate, isolated normally-open contact then connects the following Roger inputs:</p>
          <ul>
            <li><strong>Isolated contact COM:</strong> connect to terminal 32 (COM).</li>
            <li><strong>Isolated contact NO:</strong> connect to terminal 34 (AP / opening).</li>
          </ul>
          <p>Terminal 36 is PP (step-by-step), paired with 38 COM. PP can perform different actions depending on configuration and is excluded from this open-only design. Verify the terminal labels on the installed revision.</p>
        </section>
      </div>

      <h3>Summary connection matrix</h3>
      <Table>
        <TableCaption>Proposed connections, subject to the installed equipment and local interface being verified.</TableCaption>
        <TableHeader><TableRow><TableHead>Device / wire</TableHead><TableHead>ACB-004 / lock supply</TableHead><TableHead>Separate isolated interface</TableHead><TableHead>F70/IPU36</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow><TableCell>Maglock positive (+)</TableCell><TableCell>Assigned door-relay NC</TableCell><TableCell>—</TableCell><TableCell>—</TableCell></TableRow>
          <TableRow><TableCell>Maglock negative (−)</TableCell><TableCell>Lock power supply negative</TableCell><TableCell>—</TableCell><TableCell>—</TableCell></TableRow>
          <TableRow><TableCell>Lock supply positive (+12 V if rated)</TableCell><TableCell>Assigned door-relay COM, via the approved supply / emergency-release circuit</TableCell><TableCell>—</TableCell><TableCell>—</TableCell></TableRow>
          <TableRow><TableCell>Gate trigger wire 1</TableCell><TableCell>No direct connection to the powered door-relay COM</TableCell><TableCell>Voltage-free contact COM</TableCell><TableCell>32 (COM)</TableCell></TableRow>
          <TableRow><TableCell>Gate trigger wire 2</TableCell><TableCell>No direct connection to the powered door-relay NO</TableCell><TableCell>Voltage-free contact NO</TableCell><TableCell>34 (AP / opening)</TableCell></TableRow>
        </TableBody>
      </Table>

      <h3>Unlock timing and return to secure operation</h3>
      <p>The access-controller unlock period and the gate activation pulse are separate settings. A 3–5-second unlock period is a commissioning candidate only, not a confirmed site setting or a universal requirement for residual magnetism. Measure lock release, bracket clearance and gate travel, then set the local sequence so the lock releases before movement and re-energises at the appropriate point.</p>
      <p>The Roger manual states that holding AP active prevents automatic reclosing; the reclose timer resumes when AP is released. Verify the intended hold-open and return-to-secure behaviour locally.</p>

      <details>
        <summary>Magic Keys Pi remote-open interface</summary>
        <p>The Pi requests access through one isolated relay NO/COM contact across the verified ACB-004 door exit input P1–P4 and its matching GND. Each request pulses only its assigned channel for 300–800 ms. Never connect GPIO directly to the board.</p>
        <p>This pulse does not determine the lock-release period or sequence the lock and motor. The service provides no close, hold-open, fire or lockdown command. Acknowledgement confirms only the pulse; it provides no live gate-position, lock-release or safety feedback.</p>
      </details>

      <h3>Commissioning and testing</h3>
      <p>Testing will cover permissions and readers, operating schedules, hold-open and return to secure operation, remote commands, required gate-state feedback, emergency behaviour, safety functions and recovery after a power or communications failure. Required feedback must be independently verified; the open-only Pi path supplies none.</p>
      <p>The manuals describe the contact functions. They do not verify the installed interface or certify the complete system; the installed configuration and local safety operation will be confirmed through commissioning.</p>
      <p className="compass-source">References: supplied S4A ACB-00 wiring manual, ACB-004 diagram (PDF sheet 3); supplied software guide §§2.2, 2.5, 3.2.2 and 3.3.1; <a href="https://www.manualslib.com/manual/3373474/Roger-Technology-F70-Ipu36.html?page=23" target="_blank" rel="noreferrer">Roger F70/IPU36 installer manual, command terminals</a>.</p>
    </section>
  );
}
