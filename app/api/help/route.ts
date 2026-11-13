/**
 * Ask Magic Keys (help assistant) API.
 *
 * Hardening (10 Oct 2026):
 *  - Answers come only from the staff guide (SOFTWARE_HELP.md); internal notes are not indexed.
 *  - Responses carry topic titles only, never guide text from other sources, provider names,
 *    configuration names or provider error details.
 *  - Every AI answer is checked for internal detail before it is shown; a leaking answer is
 *    replaced with the staff-guide answer.
 *  - Rate limit for every mode: 10 questions per person per minute.
 *  - Flagged questions (probing, injection, data requests, safety bypass, abuse, off-topic)
 *    are forwarded to RJL after the reply is built, without telling the asker.
 *  - If the AI provider fails, RJL is told (at most every 6 hours); the asker gets the guide.
 */
import { helpProvider } from '@/lib/help-provider';
import { env } from '@/lib/server-env';
import { assertSameOrigin, requireOperator } from '@/lib/portal-auth';
import { helpTopics, helpPassage } from '@/lib/software-help';
import { answerHelp, parseHelpInput, type HelpInput } from '@/lib/help-agent';
import { recordHelpEvent } from '@/lib/help-events';
import { classifyHelpQuestion, classifyHelpRules, leaksInternalDetail } from '@/lib/help-guard';
import { forwardFlaggedQuestion, reportBlockedAnswer, reportHelpServiceIssue } from '@/lib/help-flags';
import { matchOperatorHelp, operatorFallbackAnswer } from '@/lib/help-operator-answers';
import { personKey, takeActionSlot } from '@/lib/action-rate-limit';
import { readBoundedText } from '@/lib/request-body';
import { getPortalPlan } from '@/lib/portal-plan';
import { readEquipment } from '@/lib/equipment-store';
import { readDoorConfiguration, remoteOpenEnvironment } from '@/lib/door-open-gateway';
import { GATES } from '@/lib/portal-model';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const runtime = () => env as unknown as Record<string, string | undefined>;
const GENERIC_ISSUE = 'The AI assistant is not available right now, so this answer comes from the staff guide.';
// Three still pictures, each checked again at 500 KB decoded. The clip itself is never uploaded.
const MAX_BODY = 2_600_000;

export async function GET(request: Request) {
  const auth = await requireOperator(request, 'viewer');
  if (!auth.user) return auth.response;
  const id = new URL(request.url).searchParams.get('article');
  if (id) {
    const article = helpPassage(id);
    return article ? json({ article: { id: article.id, title: article.title, text: article.text } }) : json({ error: 'Article not found' }, 404);
  }
  const provider = helpProvider(runtime());
  return json({ topics: helpTopics, aiConfigured: Boolean(provider.apiKey), topicCount: helpTopics.length });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return json({ error: 'Request rejected' }, 403);
  const auth = await requireOperator(request, 'viewer');
  if (!auth.user) return auth.response;
  const user = auth.user;
  let input: HelpInput;
  try {
    const text = await readBoundedText(request, MAX_BODY);
    if (text === null) return json({ error: 'Conversation is too long. Start a new chat.' }, 413);
    input = parseHelpInput(JSON.parse(text));
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? 'Enter a question.' : e instanceof Error ? e.message : 'Enter a question.' }, 400);
  }

  try {
    if (!await takeActionSlot(await personKey('software-help:user', user.email), 10, 60_000)) {
      return json({ error: 'Please wait a minute before asking more questions.' }, 429);
    }
  } catch { return json({ error: 'Help is temporarily unavailable. Please try again.' }, 503); }

  const values = runtime();
  const provider = helpProvider(values);
  // Plain status for the assistant: no addresses, settings names or test results.
  let remoteOpen = 'unknown';
  try {
    const equipment = await readEquipment();
    const configuration = readDoorConfiguration(remoteOpenEnvironment(key => values[key], equipment.remoteOpenEnabled), GATES);
    remoteOpen = !equipment.remoteOpenEnabled ? 'switched off by the school' : configuration ? 'set up for this site' : 'not set up for this site';
  } catch { /* stays unknown */ }

  const result = await answerHelp(input, { role: user.role, plan: getPortalPlan(user).name, remoteOpen }, provider);

  // Provider problems: details to RJL and the server log only; the asker gets a generic note.
  const providerIssue = 'issue' in result && result.issue ? result.issue : null;
  if (providerIssue && result.status === 'unavailable') void reportHelpServiceIssue(providerIssue);

  // Last check: an AI answer that mentions internal detail is replaced with the guide answer.
  let answer = result.answer;
  let mode: string = result.mode;
  const leak = result.mode === 'ai' ? leaksInternalDetail(answer) : null;
  if (leak) {
    console.warn('help_answer_blocked', JSON.stringify({ reason: leak }));
    const common = matchOperatorHelp(input.question);
    answer = common ? common.answer : result.sources?.[0] ? operatorFallbackAnswer(result.sources[0].text)
      : "That's not something I can help with here. Please contact RJL Commercial Group at info@rjlcommercialgroup.com.";
    mode = 'knowledge';
  }

  const sources = (result.sources ?? []).map(({ id, title }) => ({ id, title }));
  const status = leak ? 'answered' : result.status;
  await recordHelpEvent({
    role: user.role,
    page: input.page,
    // The stored question is text. Picture bytes are not written to the help log.
    question: input.frames.length ? `${input.question} [${input.frames.length === 1 ? "photo attached" : `${input.frames.length} pictures attached`}]` : input.question,
    status,
    mode,
    articleId: sources[0]?.id ?? null,
    // Short codes only: administrators can read this log, so no provider detail.
    issue: leak ? 'answer_replaced' : providerIssue ? 'ai_unavailable' : null,
  });

  // A replaced AI answer is a system issue for RJL, never blamed on the asker.
  if (leak) void reportBlockedAnswer(leak);

  // Quietly forward flagged questions (this question, or an earlier one in the
  // same chat). Not awaited, and nothing in the reply changes.
  const flag = classifyHelpQuestion(input.question)
    ?? input.history.filter((message) => message.role === 'user').map((message) => classifyHelpRules(message.content)).find(Boolean)
    ?? null;
  if (flag) void forwardFlaggedQuestion({ flag, user, page: input.page, question: input.question, history: input.history, answer, answerMode: mode });

  // The reply carries only what the help panel shows: the answer, topic titles
  // and, if the AI is down, a generic note. Same shape whether or not flagged.
  return json({
    answer,
    sources,
    ...(providerIssue && result.status === 'unavailable' ? { issue: GENERIC_ISSUE } : {}),
  });
}
