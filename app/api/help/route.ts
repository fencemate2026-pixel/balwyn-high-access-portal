import { helpProvider } from '@/lib/help-provider';
import { env } from '@/lib/server-env';
import { getSql } from '@/db';
import { assertSameOrigin, requireOperator } from '@/lib/portal-auth';
import { helpTopics, helpPassage } from '@/lib/software-help';
import { answerHelp, parseHelpInput, type HelpInput } from '@/lib/help-agent';
import { recordHelpEvent } from '@/lib/help-events';
import { getPortalPlan } from '@/lib/portal-plan';
import { readEquipment } from '@/lib/equipment-store';
import { readDoorConfiguration } from '@/lib/door-open-gateway';
import { GATES } from '@/lib/portal-model';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const runtime = () => env as unknown as Record<string, string | undefined>;
export async function GET(request: Request) {
  const auth = await requireOperator(request, 'viewer');
  if (!auth.user) return auth.response;
  const id = new URL(request.url).searchParams.get('article');
  if (id) { const article = helpPassage(id); return article ? json({ article }) : json({ error: 'Article not found' }, 404); }
  const provider = helpProvider(runtime());
  return json({ topics: helpTopics, aiConfigured: Boolean(provider.apiKey), provider: provider.label, topicCount: helpTopics.length });
}
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return json({ error: 'Request rejected' }, 403);
  const auth = await requireOperator(request, 'viewer');
  if (!auth.user) return auth.response;
  let input: HelpInput;
  try {
    const text = await request.text();
    if (text.length > 20000) return json({ error: 'Conversation is too long. Start a new chat.' }, 413);
    input = parseHelpInput(JSON.parse(text));
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Enter a question.' }, 400); }
  const values = runtime();
  const provider = helpProvider(values);
  if (provider.apiKey) {
    try {
      const fingerprint = `software-help:${auth.user.email}`;
      const cutoff = new Date(Date.now() - 60000).toISOString();
      const limit = await getSql().prepare('INSERT INTO auth_attempts (fingerprint,success,created_at) SELECT ?,1,? WHERE (SELECT COUNT(*) FROM auth_attempts WHERE fingerprint=? AND created_at>?)<10')
        .bind(fingerprint, new Date().toISOString(), fingerprint, cutoff).run();
      if (!limit.meta.changes) return json({ error: 'Please wait a minute before asking more questions.' }, 429);
    } catch { return json({ error: 'Help is temporarily unavailable. Please try again.' }, 503); }
  }
  let remoteOpen = 'Configuration could not be read. Hardware operation is not verified.';
  try {
    const equipment = await readEquipment();
    const configuration = readDoorConfiguration(key => {
      if (!equipment.remoteOpenEnabled) return undefined;
      if (key === 'DOOR_GATE_MAP' && equipment.gateMap !== null) return Object.keys(equipment.gateMap).length ? JSON.stringify(equipment.gateMap) : undefined;
      return values[key];
    }, GATES);
    remoteOpen = !equipment.remoteOpenEnabled ? 'Disabled in equipment settings.' : configuration ? 'Configuration is present and valid in format. Reachability and physical operation have not been tested by this helper.' : 'Not configured; no hardware call can be made through this integration.';
  } catch { /* Do not expose configuration values or parsing errors. */ }
  const result = await answerHelp(input, { role: auth.user.role, plan: getPortalPlan(auth.user).name, remoteOpen }, provider);
  await recordHelpEvent({
    role: auth.user.role,
    page: input.page,
    question: input.question,
    status: result.status,
    mode: result.mode,
    articleId: result.sources?.[0]?.id ?? null,
    issue: 'issue' in result ? result.issue ?? null : null,
  });
  return json(result);
}
