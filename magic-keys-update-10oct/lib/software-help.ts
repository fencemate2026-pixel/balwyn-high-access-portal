/**
 * Search over the staff guide (data/software-knowledge.json, built from
 * SOFTWARE_HELP.md by scripts/build-help-index.mjs). The index holds client-facing
 * topics only; internal notes are never indexed, so nothing here can surface them.
 */
import passages from '../data/software-knowledge.json' with { type: 'json' };

export type HelpPassage = { id: string; title: string; source: string; text: string };

const stop = new Set('the and how what where does can for with this that have why are you use help please about tell could would should want need my me a an to of on in is it do i we our get make from'.split(' '));
const aliases: Record<string, string> = {
  settings: 'settings', setting: 'settings', setings: 'settings', settigns: 'settings',
  password: 'password', passwrod: 'password', pasword: 'password', login: 'signin', logon: 'signin', log: 'log', signin: 'signin', sign: 'signin',
  gates: 'gate', doors: 'gate', door: 'gate', boom: 'gate', booms: 'gate', cameras: 'camera', cctv: 'camera', schedules: 'schedule', timetable: 'schedule',
  photos: 'photo', picture: 'photo', avatar: 'photo',
  staff: 'user', users: 'user', account: 'user', accounts: 'user', person: 'user', people: 'user',
  add: 'add', create: 'add', invite: 'add', new: 'add',
  cycle: 'cycle', cycles: 'cycle', counter: 'cycle', count: 'cycle', tally: 'cycle', operations: 'cycle',
  service: 'service', services: 'service', servicing: 'service', serviced: 'service', maintenance: 'service',
  booking: 'booking', bookings: 'booking', book: 'booking', hire: 'booking', hiring: 'booking', stadium: 'booking',
  evacuation: 'fire', evacuate: 'fire', evac: 'fire', emergency: 'fire', alarm: 'fire',
  roles: 'role', permission: 'role', permissions: 'role', admin: 'administrator', viewer: 'role', operator: 'role',
  unlock: 'unlock', unlocked: 'unlock', locked: 'unlock', upgrade: 'plan', package: 'plan', advanced: 'plan',
  history: 'activity', audit: 'activity', export: 'activity', csv: 'activity',
};
function terms(text: string) {
  return [...new Set((text.toLowerCase().replace(/six-second/g, '6 second').match(/[a-z0-9_]+/g) ?? []).filter(t => !stop.has(t)).map(t => aliases[t] ?? t))];
}
const guide = passages as HelpPassage[];
const indexed = guide.map(p => ({ p, title: new Set(terms(p.title)), body: new Set(terms(p.text)) }));

export function findHelp(question: string, previousQuestion = '', page = ''): HelpPassage[] {
  const query = terms(question), previous = terms(previousQuestion), pageTerms = terms(page);
  if (!query.length && !previous.length) return [];
  return indexed.map(({ p, title, body }) => {
    const scoreTerms = (words: string[]) => words.reduce((sum, term) => sum + (title.has(term) ? 6 : 0) + (body.has(term) ? 1 : 0), 0);
    const match = scoreTerms(query) + scoreTerms(previous) * 0.5;
    // Page context only breaks ties; it cannot turn an unrelated question into a match.
    return { p, score: match ? match + scoreTerms(pageTerms) * 0.1 : 0 };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.p);
}

/** Topic list for the help panel: titles only. */
export const helpTopics = guide.map(p => ({ id: p.id, title: p.title }));

/** One staff-guide topic by id; anything else (including old ids) is not found. */
export function helpPassage(id: string): HelpPassage | undefined {
  return /^guide-\d{1,3}$/.test(id) ? guide.find(p => p.id === id) : undefined;
}
