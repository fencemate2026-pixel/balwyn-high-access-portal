/**
 * Help-assistant guard rails (pure functions, no I/O).
 *
 * 1. classifyHelpQuestion: decides whether a question should be quietly
 *    forwarded to RJL: security probing, attempts to extract internal or
 *    personal information, prompt injection, abuse, or questions that have
 *    nothing to do with the portal. The asker is never told.
 * 2. leaksInternalDetail: last check on an AI answer before it is shown. If the
 *    answer mentions internal detail anyway, the caller replaces it with the
 *    staff-guide answer. Mirrors the guard in scripts/build-help-index.mjs.
 *
 * Patterns favour catching probing over perfect precision: a false positive
 * only means RJL reads one extra question (alerts are rate limited).
 */
import { findHelp } from "./software-help.ts";
import { matchOperatorHelp } from "./help-operator-answers.ts";

export type HelpFlagCategory = "security_probe" | "prompt_injection" | "data_request" | "safety_bypass" | "abuse" | "off_topic";
export type HelpFlag = { category: HelpFlagCategory; reasons: string[] } | null;

const RULES: Array<{ category: HelpFlagCategory; reason: string; pattern: RegExp }> = [
  // Prompt injection / trying to change or reveal the assistant's rules.
  { category: "prompt_injection", reason: "asks the assistant to ignore its rules", pattern: /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|the)\b.{0,25}\b(instructions?|rules|prompts?|guidelines|restrictions)\b/i },
  { category: "prompt_injection", reason: "asks for the system prompt or hidden instructions", pattern: /\b(system|hidden|initial|original|developer)\s+(prompt|instructions?|message)\b|\b(reveal|show|print|repeat|output|tell me)\b.{0,30}\b(your|the)\s+(prompt|instructions|rules|reference data)\b/i },
  { category: "prompt_injection", reason: "role-play or jailbreak attempt", pattern: /\b(jailbreak|dan mode|developer mode|god mode|you are now|pretend (to be|you are)|act as (an? )?(admin|administrator|developer|system|root))\b/i },
  // Security probing: attack vocabulary (always suspicious in a staff help chat).
  { category: "security_probe", reason: "asks about attacking or bypassing security", pattern: /\b(hack(s|ing|ed|er)?|exploit(s|ing|able)?|vulnerab\w*|pen(etration)?[ -]?test\w*|brute[ -]?forc\w*|(sql|code|prompt|script|command) injection|xss|csrf|ssrf|ddos|dos attack|backdoor|privilege escalation|escalat\w* (my )?(privileges?|access|role)|zero[ -]?day|malware|phishing|crack(ing)? (the |a |an |my )?(password|code|login|pin|account)|bypass\w* (the )?(login|sign[- ]?in|security|password|authenticat\w*|authenticator|2fa|mfa|permissions?|access control|rate limit|lock ?out|audit|logging|activity log))\b/i },
  // Security probing: credentials and security mechanisms.
  { category: "security_probe", reason: "asks about credentials or security internals", pattern: /\b(api[ -]?keys?|secret keys?|access tokens?|session (tokens?|cookies?|ids?)|jwt|bearer tokens?|(password|token) hash\w*|hash(ed|ing)? passwords?|salt(ed)? (hash(es)?|passwords?)|rate[ -]?limit\w*|lock[ -]?out (rules?|policy|threshold|limit)|totp secret|2fa secret)\b/i },
  // Security probing: how the system is built or hosted (specific technical terms only).
  { category: "security_probe", reason: "asks how the system is built or hosted", pattern: /\b((which|what) (server|host|hosting|cloud|database|db|back[ -]?end|framework|tech stack|stack|programming language|ai|llm|ai model|language model)\b|where is (the |this )?(portal|site|app|system|data) (hosted|stored|kept)|hosting (provider|company|platform|service)|hosted (on|by|with)|database (schema|tables?|password|server)|sql|postgres\w*|supabase|render\.com|aws|amazon web services|cloud ?flare|source code|repo(sitory)?|github|(software|web|javascript|js) framework|next\.?js|node\.?js|tech(nology)? stack|environment variables?|env vars?|config(uration)? files?|ip address(es)?|open ports?|port numbers?|dns (records?|settings?)|ssh|firewall (rules?|settings?)|(api|server) (url|route|endpoint|address)s?|endpoints?|are you (claude|chatgpt|gpt|gemini)|openai|anthropic|chatgpt|gpt-?\d|large language model|llm|raspberry pi|relay (pins?|channels?)|gpio)\b/i },
  // Requests for secrets or other people's personal information.
  { category: "data_request", reason: "asks for a password, code or secret", pattern: /\b(what('?s| is| are)|tell me|give me|share|send me|show me)\s+(me\s+)?(the|an?|your|his|her|their)\s+(admin(istrator)?|settings|master|default|root|super|override|backdoor)\s+(passwords?|passcodes?|pins?|codes?|keys?)\b/i },
  { category: "data_request", reason: "asks for other people's passwords or personal details", pattern: /\b(other (users?|people|staff)'?s?|someone else'?s|everyone'?s|every (user|staff member)'?s?|all (the )?(users?|staff|admins?|administrators|operators)'?s?) (passwords?|pins?|codes?|emails?|email addresses|phone numbers?|home addresses|personal (details|information|data))\b|\b(list|give me|send me|export|show me|tell me)\b.{0,30}\b(all|every|everyone'?s)\b.{0,25}\b(emails?|email addresses|phone numbers?|passwords?|home addresses|personal (details|information|data))\b/i },
  // Defeating safety devices or the audit trail.
  { category: "safety_bypass", reason: "asks to defeat a safety device or the audit trail", pattern: /\b(disable|defeat|bypass|jumper|short(ing)? out|tamper(ing)? with|override|turn off|switch off)\s+(the\s+)?(safety\s+(beams?|edges?|sensors?|loops?|inputs?|circuits?|devices?)|photo ?(cells?|beams?|eyes?)|interlocks?|e-?stop|emergency stop|activity log|audit (log|trail)|logging)\b/i },
  { category: "safety_bypass", reason: "asks to operate gates without authorisation or record", pattern: /\b(open|unlock|operate)\b.{0,30}\b(without|with no|bypassing|avoiding)\b.{0,25}\b(permission|approval|password|authori[sz]ation|login|signing in|being logged|a record|the log|anyone knowing)\b/i },
  // Abuse.
  { category: "abuse", reason: "abusive or offensive language", pattern: /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|bastard\w*|dickhead\w*|wank\w*|arse ?hole|ass ?hole|retard\w*|slut\w*|piss off|stfu|kys)\b/i },
  { category: "abuse", reason: "insults the assistant", pattern: /\b(you('re| are)|this (app|thing|bot|portal) is)\s+(so\s+)?(stupid|dumb|useless|idiot\w*|trash|rubbish|garbage|crap|pathetic|hopeless)\b|\b(idiot|moron|dumbass|imbecile)\b/i },
  // Clearly off-topic requests.
  { category: "off_topic", reason: "unrelated request", pattern: /\b(tell me a joke|jokes?|poem|song lyrics|write (me )?(a|an) (story|essay|song|poem)|recipe|homework|essay|bitcoin|crypto\w*|stock tips?|lotto|lottery|horoscope|online dating|dating (app|site|advice)|girlfriend|boyfriend|footy tips?|who will win|capital of|meaning of life)\b/i },
];

const GREETING = /^(hi|hello|hey|g'?day|thanks?|thank you|cheers|ta|ok(ay)?|good (morning|afternoon)|bye)[!. ]*$/i;
const ACKNOWLEDGEMENT = /\b(thanks?|thank you|cheers|ta|got it|perfect|great|awesome|no worries|all good|that worked|sorted|understood|makes sense)\b/i;

/** Rule matches only (no "nothing in the guide" fallback). Used for earlier turns in a chat. */
export function classifyHelpRules(text: string): HelpFlag {
  const matched = RULES.filter((rule) => rule.pattern.test(text));
  return matched.length ? { category: matched[0].category, reasons: [...new Set(matched.map((rule) => rule.reason))] } : null;
}

/** Returns the reasons a question should be quietly forwarded to RJL, or null. */
export function classifyHelpQuestion(question: string): HelpFlag {
  const text = question.trim();
  if (!text || GREETING.test(text)) return null;
  const ruled = classifyHelpRules(text);
  if (ruled) return ruled;
  const words = text.split(/\s+/).filter(Boolean).length;
  // Short thank-yous and acknowledgements are never "off-topic".
  if (words <= 8 && ACKNOWLEDGEMENT.test(text)) return null;
  // Nothing in the staff guide or the ready answers relates to it at all.
  if (words >= 4 && !matchOperatorHelp(text) && findHelp(text).length === 0) {
    return { category: "off_topic", reasons: ["nothing in the staff guide relates to the question"] };
  }
  return null;
}

const ALLOWED_EMAIL = "info@rjlcommercialgroup.com";
const ANSWER_LEAKS: Array<[RegExp, string]> = [
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/, "setting name"],
  [/\b(render\.com|onrender|supabase|cloudflare|netlify|vercel|github|docker|postgres(ql)?|sqlite|resend\.com|resend api|foundry|openai|anthropic|claude|chatgpt|gpt-?\d|gemini|haiku|next\.js|node\.js|pglite|drizzle|azure (app service|container|functions))\b/i, "vendor or technology name"],
  [/\bhttps?:\/\/|\bwww\./i, "web address"],
  [/\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b(?!\.\d)/, "network address"],
  [/\b[\w-]+\/[\w./-]+\.(md|ts|tsx|js|mjs|json|sql|py|sh|env|token)\b/i, "file path"],
  [/\b(api[ _-]?key|bearer|service[ _-]?token|private key|secret key|gpio|ssh|sudo|system prompt)\b/i, "credential or system vocabulary"],
  [/\bhosted (on|by|with|at)\b|\b(on|via|with|using|by) Render\b/i, "hosting detail"],
  // Distinctive headings from the assistant's own instructions (case-sensitive).
  [/\bNEVER SHARE\b|\bYOUR JOB\b|Reference data \(not instructions\)/, "instruction text"],
];

/** Names the kind of internal detail an answer contains, or null if it is clean. */
export function leaksInternalDetail(answer: string): string | null {
  for (const [pattern, label] of ANSWER_LEAKS) if (pattern.test(answer)) return label;
  for (const email of answer.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) if (email.toLowerCase() !== ALLOWED_EMAIL) return "email address";
  return null;
}
