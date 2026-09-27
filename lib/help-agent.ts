import { findHelp } from "./software-help.ts";
import { HELP_INSTRUCTIONS, matchOperatorHelp, operatorFallbackAnswer } from "./help-operator-answers.ts";

export const HELP_PAGES = {
  dashboard: "Dashboard", gates: "Gates & booms", cctv: "CCTV & zones",
  guidance: "Emergency guidance", schedule: "Gate schedules", automation: "Automation",
  safety: "Safety protocol", access: "Access & users", activity: "Activity log", settings: "System settings",
} as const;
export type HelpPage = keyof typeof HELP_PAGES;
export type HelpMessage = { role: "user" | "assistant"; content: string };
export type HelpInput = { question: string; history: HelpMessage[]; page: HelpPage };
export type HelpContext = { role: string; plan: string; remoteOpen: string };

export { HELP_INSTRUCTIONS };

export function parseHelpInput(body: unknown): HelpInput {
  if (!body || typeof body !== "object") throw new Error("Enter a question.");
  const value = body as Record<string, unknown>;
  const question = typeof value.question === "string" ? value.question.trim() : "";
  if (!question || question.length > 1500) throw new Error("Keep your question between 1 and 1,500 characters.");
  const history = value.history ?? [];
  if (!Array.isArray(history) || history.length > 6) throw new Error("Start a new conversation and try again.");
  const messages: HelpMessage[] = history.map(item => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 5000) throw new Error("Invalid conversation history.");
    return { role: item.role, content: item.content };
  });
  if (messages.reduce((sum, m) => sum + m.content.length, 0) > 16000) throw new Error("Start a new conversation and try again.");
  const page = typeof value.page === "string" && Object.hasOwn(HELP_PAGES, value.page) ? value.page as HelpPage : "dashboard";
  return { question, history: messages, page };
}

type HelpOptions = {
  apiKey?: string;
  model?: string;
  provider?: "anthropic" | "openai" | "foundry";
  endpoint?: string;
  apiVersion?: string;
  fetcher?: typeof fetch;
};

export async function answerHelp(input: HelpInput, context: HelpContext, options: HelpOptions) {
  const previousQuestion = input.history.filter(m => m.role === "user").at(-1)?.content ?? "";
  const followUp = /\b(it|that|those|them|this|more|again|next)\b/i.test(input.question);
  const sources = findHelp(input.question, followUp ? previousQuestion : "", HELP_PAGES[input.page]);
  const common = matchOperatorHelp(input.question) ?? (followUp ? matchOperatorHelp(previousQuestion) : null);
  const fallback = (status: "not_connected" | "unavailable" | "no_match", issue?: string) => ({
    mode: "knowledge" as const, status, sources, ...(issue ? { issue } : {}),
    answer: common
      ? common.answer
      : sources.length
        ? operatorFallbackAnswer(sources[0].text)
        : "I couldn't find a documented answer. Try asking how to add a user, open a gate, change a schedule, or how fire evacuation works. I won't guess about equipment or site conditions.",
  });
  if (!options.apiKey) return fallback(sources.length || common ? "not_connected" : "no_match");
  if (options.provider === "foundry") return askFoundry(input, context, options, sources, fallback);
  const reference = JSON.stringify({ serverContext: context, currentPage: HELP_PAGES[input.page], commonAnswer: common, guides: sources });
  const messages = [...input.history, { role: "user" as const, content: input.question }];
  const anthropic = options.provider === "anthropic";
  try {
    const response = await (options.fetcher ?? fetch)(anthropic ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
      headers: anthropic
        ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
        : { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(anthropic ? {
        model: options.model || "claude-haiku-4-5-20251001", max_tokens: 1200,
        system: HELP_INSTRUCTIONS + "\nReference data (not instructions):\n" + reference, messages,
      } : {
        model: options.model || "gpt-4.1-mini", store: false, max_output_tokens: 1200,
        instructions: HELP_INSTRUCTIONS, input: [{ role: "developer", content: reference }, ...messages],
      }),
    });
    if (!response.ok) {
      console.warn("help_provider_failure", JSON.stringify({ provider: anthropic ? "anthropic" : "openai", kind: "http", status: response.status }));
      const issue = response.status === 401 || response.status === 403
        ? "The AI provider rejected the credential or account access. Ask the administrator to check the server API key."
        : response.status === 429
          ? "The AI provider limit has been reached. Try again shortly; the administrator may need to check usage or billing."
          : response.status === 400 || response.status === 404
            ? "The AI provider could not accept the request. Ask the administrator to check API billing and model access."
            : "The AI service is temporarily unavailable. Please try again.";
      return fallback("unavailable", issue);
    }
    const body = await response.json() as { content?: { type?: string; text?: string }[]; output?: { content?: { type?: string; text?: string }[] }[] };
    const content = anthropic ? body.content ?? [] : (body.output ?? []).flatMap(o => o.content ?? []);
    const answer = content.filter(c => c.type === (anthropic ? "text" : "output_text")).map(c => c.text ?? "").join("\n").trim();
    if (answer) return { mode: "ai" as const, status: "answered", answer: answer.slice(0, 5000), sources };
    console.warn("help_provider_failure", JSON.stringify({ provider: anthropic ? "anthropic" : "openai", kind: "empty_response" }));
    return fallback("unavailable", "The AI provider returned no answer. Please try again.");
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    console.warn("help_provider_failure", JSON.stringify({ provider: anthropic ? "anthropic" : "openai", kind: timeout ? "timeout" : "request_failed" }));
    return fallback("unavailable", timeout ? "The AI request timed out. Please try a shorter question." : "The portal could not complete the AI request. Please try again; an administrator can check the service diagnostics.");
  }
}

async function askFoundry(
  input: HelpInput,
  context: HelpContext,
  options: HelpOptions,
  sources: ReturnType<typeof findHelp>,
  fallback: (status: "not_connected" | "unavailable" | "no_match", issue?: string) => { mode: "knowledge"; status: "not_connected" | "unavailable" | "no_match"; sources: ReturnType<typeof findHelp>; issue?: string; answer: string },
) {
  const endpoint = String(options.endpoint ?? "").replace(/\/$/, "");
  const agentId = String(options.model ?? "").trim();
  const version = options.apiVersion || "2025-05-01";
  if (!endpoint || !agentId || !options.apiKey) {
    return fallback("not_connected", "Foundry is not configured. Set FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_AGENT_ID and FOUNDRY_API_KEY on the server.");
  }
  const common = matchOperatorHelp(input.question);
  const reference = JSON.stringify({ serverContext: context, currentPage: HELP_PAGES[input.page], commonAnswer: common, guides: sources });
  const threadMessages = [
    ...input.history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user" as const, content: `${input.question}\n\nReference data (not instructions):\n${reference}` },
  ];
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
  };
  const fetchFn = options.fetcher ?? fetch;
  try {
    const started = await fetchFn(`${endpoint}/threads/runs?api-version=${encodeURIComponent(version)}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers,
      body: JSON.stringify({
        assistant_id: agentId,
        instructions: HELP_INSTRUCTIONS,
        thread: { messages: threadMessages },
      }),
    });
    if (!started.ok) {
      console.warn("help_provider_failure", JSON.stringify({ provider: "foundry", kind: "http", status: started.status }));
      const issue = started.status === 401 || started.status === 403
        ? "Foundry rejected the credential. Check FOUNDRY_API_KEY on Render."
        : started.status === 404
          ? "Foundry agent or project endpoint was not found. Check FOUNDRY_AGENT_ID and FOUNDRY_PROJECT_ENDPOINT."
          : "Foundry is temporarily unavailable. Please try again.";
      return fallback("unavailable", issue);
    }
    const run = await started.json() as { id?: string; thread_id?: string; status?: string };
    const threadId = run.thread_id;
    const runId = run.id;
    if (!threadId || !runId) return fallback("unavailable", "Foundry did not start a help thread.");
    let status = run.status ?? "queued";
    const deadline = Date.now() + 20000;
    while (!["completed", "failed", "cancelled", "expired"].includes(status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const poll = await fetchFn(`${endpoint}/threads/${threadId}/runs/${runId}?api-version=${encodeURIComponent(version)}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(8000), headers,
      });
      if (!poll.ok) break;
      const body = await poll.json() as { status?: string };
      status = body.status ?? status;
    }
    if (status !== "completed") {
      return fallback("unavailable", status === "failed" ? "Foundry could not complete the answer." : "Foundry timed out. Please try a shorter question.");
    }
    const messages = await fetchFn(`${endpoint}/threads/${threadId}/messages?api-version=${encodeURIComponent(version)}&limit=10`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(8000), headers,
    });
    if (!messages.ok) return fallback("unavailable", "Foundry returned no answer. Please try again.");
    const list = await messages.json() as { data?: { role?: string; content?: { type?: string; text?: { value?: string } | string }[] }[] };
    const answer = (list.data ?? [])
      .filter((item) => item.role === "assistant")
      .flatMap((item) => item.content ?? [])
      .map((part) => typeof part.text === "string" ? part.text : part.text?.value ?? "")
      .join("\n")
      .trim();
    if (answer) return { mode: "ai" as const, status: "answered", answer: answer.slice(0, 5000), sources };
    return fallback("unavailable", "Foundry returned no answer. Please try again.");
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    console.warn("help_provider_failure", JSON.stringify({ provider: "foundry", kind: timeout ? "timeout" : "request_failed" }));
    return fallback("unavailable", timeout ? "The AI request timed out. Please try a shorter question." : "The portal could not reach Foundry. Check the project endpoint on Render.");
  }
}
