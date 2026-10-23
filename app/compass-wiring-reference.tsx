import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Rewritten 24 Oct 2026 (audit H4): this page described the superseded Roger
// F70/IPU36 plan with the lock on an ACB-004 relay. Balwyn uses Locinox Venus
// operators driven by gate-controller/. Source of truth for the wiring:
// gate-controller/deploy/INSTALL.md section 1d and venus-*.env.example. Keep this
// page in step with those files.
export default function CompassWiringReference() {
  return (
    <section className="settings-card compass-wiring-reference" aria-labelledby="compass-wiring-title">
      <div className="panel-heading">
        <div>
          <h2 id="compass-wiring-title">Wiring</h2>
          <small>Compass ACB-004 · Locinox Venus · Magic Keys Pi gate controller</small>
        </div>
      </div>
      <p>Each gate has a Locinox Venus operator with two command inputs. The Compass ACB-004 door relay and the Magic Keys Pi each have their own input, so the two systems are never wired to the same terminals. The installed board, lock rating and Venus settings are confirmed during commissioning.</p>

      <div className="compass-wiring-steps">
        <section aria-labelledby="acb-wiring-title">
          <h3 id="acb-wiring-title">1. Compass ACB-004 (keypad, card and exit button)</h3>
          <ul>
            <li><strong>Door relay DR1 (J14) COM / NO:</strong> to Venus <strong>IN1</strong> and its common. Volt-free: no supply on COM.</li>
            <li><strong>Venus IN1 setting:</strong> Control device, Normally Open, &ldquo;Open and close&rdquo;.</li>
            <li><strong>Keypad / reader:</strong> reader 1 (J1). <strong>Exit button:</strong> J2, P1 and GND.</li>
          </ul>
        </section>
        <section aria-labelledby="pi-wiring-title">
          <h3 id="pi-wiring-title">2. Magic Keys Pi gate controller</h3>
          <ul>
            <li><strong>Pi relay COM / NO:</strong> to Venus <strong>IN2</strong> and its common (TF-ENTRY relay on GPIO 22, SIDE-ENTRY relay on GPIO 23). Never connect a GPIO pin directly to the Venus.</li>
            <li><strong>Venus IN2 setting:</strong> Control device, Normally Open, &ldquo;Hold to keep open&rdquo;. The controller closes the contact for its set pulse time on a manual open, and keeps it closed for schedule and fire / evacuation holds. How the Venus responds to a short close is bench test V2 (INSTALL.md).</li>
            <li><strong>Safety input:</strong> Venus OUT2 (24 V AUX) drives a 24 V relay coil (BEM-41F, A1 / A2). That relay&rsquo;s COM goes to the Pi safety input (TF-ENTRY GPIO 5, SIDE-ENTRY GPIO 6) and its NO to Pi GND. It proves the Venus is powered.</li>
            <li><strong>Reed switches:</strong> TF-ENTRY closed GPIO 17 / open GPIO 27; SIDE-ENTRY closed GPIO 24 / open GPIO 25, each to Pi GND.</li>
          </ul>
        </section>
        <section aria-labelledby="maglock-wiring-title">
          <h3 id="maglock-wiring-title">3. Magnetic lock</h3>
          <p>The lock is powered and released by the Venus (OUT1, set to Lock), wired for 24 V DC as its fitting sheet specifies. It is not powered from the ACB-004 or the Pi. The Venus releases the lock before it moves the gate.</p>
        </section>
      </div>

      <h3>Summary connection matrix</h3>
      <Table>
        <TableCaption>As set out in gate-controller/deploy/INSTALL.md section 1d. TF-ENTRY bench-tested 23–24 Oct 2026; SIDE-ENTRY not yet tested.</TableCaption>
        <TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Venus setting / note</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow><TableCell>ACB-004 DR1 (J14) COM / NO</TableCell><TableCell>Venus IN1 + common</TableCell><TableCell>Open and close · volt-free</TableCell></TableRow>
          <TableRow><TableCell>Pi gate relay COM / NO</TableCell><TableCell>Venus IN2 + common</TableCell><TableCell>Hold to keep open</TableCell></TableRow>
          <TableRow><TableCell>Venus OUT2 (24 V AUX)</TableCell><TableCell>BEM-41F coil A1 / A2</TableCell><TableCell>Relay COM to Pi safety input, NO to Pi GND</TableCell></TableRow>
          <TableRow><TableCell>Venus OUT1</TableCell><TableCell>Magnetic lock</TableCell><TableCell>Lock · 24 V DC</TableCell></TableRow>
          <TableRow><TableCell>Closed / open reed switches</TableCell><TableCell>Pi GPIO inputs and GND</TableCell><TableCell>Position feedback for the portal</TableCell></TableRow>
        </TableBody>
      </Table>

      <h3>Commissioning and testing</h3>
      <p>Testing covers readers and permissions, schedules, hold-open and return to closed, remote commands, position feedback, fire / evacuation behaviour, safety functions and recovery after a power or network failure. The Venus pause time, obstacle detection and lock timing are set in the Venus app at the gate; this portal does not change them.</p>
      <p>The manuals describe the terminal functions. They do not certify the complete system; the installed configuration and local safety operation are confirmed through commissioning.</p>
      <p className="compass-source">References: supplied S4A ACB-004 wiring manual; Locinox Venus installation and training manuals (project files); gate-controller/deploy/INSTALL.md section 1d.</p>
    </section>
  );
}
