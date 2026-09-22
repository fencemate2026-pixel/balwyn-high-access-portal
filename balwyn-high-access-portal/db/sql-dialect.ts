// Convert only placeholders outside SQL literals and quoted identifiers.
export function postgresPlaceholders(sql: string) {
  let quote = "", output = "", count = 0, blockComment = false, lineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      output += ch;
      if (ch === "\n") lineComment = false;
    } else if (blockComment) {
      output += ch;
      if (ch === "*" && next === "/") {
        output += sql[++i];
        blockComment = false;
      }
    } else if (quote) {
      output += ch;
      if (ch === quote) {
        if (next === quote) output += sql[++i];
        else quote = "";
      }
    } else if (ch === "-" && next === "-") {
      output += ch + sql[++i];
      lineComment = true;
    } else if (ch === "/" && next === "*") {
      output += ch + sql[++i];
      blockComment = true;
    } else if (ch === "'" || ch === '"') { quote = ch; output += ch; }
    else if (/^CURRENT_TIMESTAMP\b/.test(sql.slice(i)) && (i === 0 || !/[A-Za-z0-9_]/.test(sql[i-1]))) {
      output += "to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
      i += "CURRENT_TIMESTAMP".length - 1;
    }
    else if (ch === "?") output += `$${++count}`;
    else output += ch;
  }
  if (quote || blockComment) throw new Error("Unterminated SQL literal.");
  return output;
}
