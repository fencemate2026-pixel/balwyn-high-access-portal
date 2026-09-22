import type { AccessRule } from "../../shared/types";

interface AccessControlProps {
  accessRules: AccessRule[];
}

export function AccessControl({ accessRules }: AccessControlProps){
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Rules engine</span>
          <h2>Access control policies</h2>
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Zone</th>
              <th>Group</th>
              <th>Schedule</th>
              <th>Threat cap</th>
            </tr>
          </thead>
          <tbody>
            {accessRules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <strong>{rule.name}</strong>
                  <p>{rule.notes}</p>
                </td>
                <td>{rule.zone}</td>
                <td>{rule.credentialGroup}</td>
                <td>{rule.schedule}</td>
                <td>{rule.threatLevelLimit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
