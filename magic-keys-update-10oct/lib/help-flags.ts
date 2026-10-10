/**
 * Quietly forwards flagged help-assistant questions to RJL (server only).
 *
 * The asker sees exactly the same reply whether or not the question is flagged:
 * the route calls this AFTER building the reply and does not wait for it, and
 * nothing in the response says a flag was raised. The privacy policy discloses
 * that help questions may be reviewed by RJL and that flagged questions are
 * sent to RJL with the asker's name and email (Australian Privacy Principle 5).
 *
 * Volume limits per hour: serious categories (probing, injection, data
 * requests, safety bypass) 10 per person and 60 site-wide; minor categories
 * (off-topic, abuse) 5 per person and 30 site-wide, as separate budgets. Over
 * the limit, the question is still in the help log; it is just not emailed.
 *
 * Never throws.
 */
import { personKey, takeActionSlot } from "@/lib/action-rate-limit";
import { sendRjlAlert } from "@/lib/rjl-alerts";
import { scrubHelpQuestion } from "@/lib/help-events";
import type { HelpFlag } from "@/lib/help-guard";
import type { HelpMessage } from "@/lib/help-agent";
import type { PortalUser } from "@/lib/portal-model";

const CATEGORY_LABEL: Record<NonNullable<HelpFlag>["category"], string> = {
  security_probe: "security or system probing",
  prompt_injection: "attempt to override the assistant's rules",
  data_request: "request for passwords or other people's information",
  safety_bypass: "request to defeat a safety control",
  abuse: "abusive language",
  off_topic: "off-topic question",
};

const melbourneTime = (date: Date) => new Intl.DateTimeFormat("en-AU", {
  dateStyle: "full", timeStyle: "medium", timeZone: "Australia/Melbourne",
}).format(date);

export async function forwardFlaggedQuestion(input: {
  flag: NonNullable<HelpFlag>;
  user: PortalUser;
  page: string;
  question: string;
  history: HelpMessage[];
  answer: string;
  answerMode: string;
  now?: Date;
  fetcher?: typeof fetch;
}) {
  try {
    const email = input.user.email.toLowerCase();
    // Separate budgets: serious categories can't be silenced by first using up
    // the allowance with off-topic or rude questions.
    const serious = !["off_topic", "abuse"].includes(input.flag.category);
    const tier = serious ? "serious" : "minor";
    if (!await takeActionSlot(await personKey(`help-flag-${tier}:user`, email), serious ? 10 : 5, 3_600_000)) return "throttled";
    if (!await takeActionSlot(`help-flag-${tier}:site:all`, serious ? 60 : 30, 3_600_000)) return "throttled";
    const label = CATEGORY_LABEL[input.flag.category];
    const earlier = input.history.filter((message) => message.role === "user").slice(-2)
      .map((message, index) => `  ${index + 1}. ${scrubHelpQuestion(message.content).slice(0, 400)}`);
    const body = [
      `A question asked in the Magic Keys help chat was flagged: ${label}.`,
      "The person was not told. Their reply was the normal help answer.",
      "",
      `Asked by: ${input.user.displayName} <${email}> (${input.user.role})`,
      `When: ${melbourneTime(input.now ?? new Date())}`,
      `Page: ${input.page}`,
      `Why flagged: ${input.flag.reasons.join("; ")}`,
      "",
      "Question:",
      scrubHelpQuestion(input.question),
      "",
      ...(earlier.length ? ["Earlier questions in the same chat:", ...earlier, ""] : []),
      `Reply shown (${input.answerMode === "ai" ? "AI answer" : "staff-guide answer"}):`,
      scrubHelpQuestion(input.answer).slice(0, 1200),
      "",
      "Passwords, tokens and email addresses typed into a question are masked before this email is sent.",
    ].join("\n");
    return await sendRjlAlert({
      kind: "help_flag",
      subject: `Magic Keys help: ${label} from ${input.user.displayName}`,
      body,
    }, { fetcher: input.fetcher });
  } catch {
    console.warn("help_flag_forward_failed");
    return "failed";
  }
}

/** Tells RJL (at most once every 6 hours) that the help AI is not working. Never throws. */
export async function reportHelpServiceIssue(issue: string, options: { fetcher?: typeof fetch } = {}) {
  try {
    if (!await takeActionSlot("rjl-alert:system:help-ai", 1, 6 * 3_600_000)) return "throttled";
    return await sendRjlAlert({
      kind: "system_issue",
      subject: "Magic Keys: the help assistant's AI service is not working",
      body: [
        "The Ask Magic Keys help chat could not get an answer from its AI service, so staff are being shown staff-guide answers instead.",
        "",
        `Detail: ${issue}`,
        "",
        "Check the AI provider account (key, billing and model access) in the server settings. This email is sent at most once every 6 hours.",
      ].join("\n"),
    }, options);
  } catch {
    return "failed";
  }
}

/** Tells RJL (at most once an hour) that an AI answer contained internal detail and was replaced. Never throws. */
export async function reportBlockedAnswer(reason: string, options: { fetcher?: typeof fetch } = {}) {
  try {
    if (!await takeActionSlot("rjl-alert:system:help-leak", 1, 3_600_000)) return "throttled";
    return await sendRjlAlert({
      kind: "system_issue",
      subject: "Magic Keys: a help-chat AI answer was blocked",
      body: [
        `An AI answer in the Ask Magic Keys help chat contained ${reason} and was replaced with the staff-guide answer before it was shown.`,
        "",
        "No action is needed unless this repeats. Check the help log ('What people ask') for the question. This email is sent at most once an hour.",
      ].join("\n"),
    }, options);
  } catch {
    return "failed";
  }
}

