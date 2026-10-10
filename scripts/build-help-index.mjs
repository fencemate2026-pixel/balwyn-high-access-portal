/**
 * Builds data/software-knowledge.json, the ONLY knowledge the in-portal help
 * assistant can search, quote or send to the AI provider.
 *
 * Client-facing by design (10 Oct 2026): only SOFTWARE_HELP.md (the staff guide)
 * is indexed. Internal notes (hosting, configuration, commissioning, security)
 * live in docs/INTERNAL_TECHNICAL_HELP_NOTES.md and must never be added here.
 *
 * Guard: the build FAILS if a passage contains internal detail (environment
 * setting names, vendor/hosting names, web or network addresses, file paths,
 * credentials vocabulary). This stops a future guide edit leaking it to staff.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "SOFTWARE_HELP.md";
const ALLOWED_ADDRESSES = new Set(["info@rjlcommercialgroup.com"]);
const FORBIDDEN = [
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/, "an environment/setting name"],
  [/\b(azure|render\.com|supabase|cloudflare|netlify|vercel|github|docker|postgres(ql)?|sqlite|resend|foundry|openai|anthropic)\b/i, "a vendor or hosting name"],
  [/\bhttps?:\/\/|\bwww\./i, "a web address"],
  [/\b\d{1,3}(\.\d{1,3}){3}\b/, "a network address"],
  [/\b[\w-]+\/[\w./-]+\.(md|ts|tsx|js|mjs|json|sql|py|sh|env|token)\b/i, "a file path"],
  [/\b(api[ _-]?key|bearer|service[ _-]?token|private key|secret key|gpio|ssh|sudo|\.env)\b/i, "credential or system vocabulary"],
];

function check(passage) {
  for (const [pattern, label] of FORBIDDEN) {
    const match = passage.text.match(pattern);
    if (match) throw new Error(`Help index refused: "${passage.title}" contains ${label} ("${match[0]}"). Move it to docs/INTERNAL_TECHNICAL_HELP_NOTES.md.`);
  }
  for (const email of passage.text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) {
    if (!ALLOWED_ADDRESSES.has(email.toLowerCase())) throw new Error(`Help index refused: "${passage.title}" contains the address ${email}.`);
  }
}

// HTML comments are editor notes, never indexed.
const text = readFileSync(SOURCE, "utf8").replace(/<!--[\s\S]*?-->/g, "");
const entries = [];
for (const part of text.split(/(?=^## )/m)) {
  const heading = part.match(/^## (.+)/)?.[1]?.trim();
  if (!heading) continue; // the title block is not a topic
  const body = part.replace(/^## .+\n/, "").trim();
  if (!body) continue;
  const passage = { id: `guide-${entries.length + 1}`, title: heading, source: SOURCE, text: `## ${heading}\n${body}` };
  if (passage.text.length > 4000) throw new Error(`Help index refused: "${heading}" is too long; split it.`);
  check(passage);
  entries.push(passage);
}
if (entries.length < 10) throw new Error("Help index refused: the staff guide looks incomplete.");
writeFileSync("data/software-knowledge.json", JSON.stringify(entries, null, 2) + "\n");
console.log(`Indexed ${SOURCE} in ${entries.length} topics`);
