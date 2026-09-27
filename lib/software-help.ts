import passages from '../data/software-knowledge.json' with { type: 'json' };
const stop = new Set('the and how what where does can for with this that have why are you use help please about tell could would should want need my me a an to of on in is it do i we our get make from'.split(' '));
const aliases: Record<string, string> = {
  settings: 'settings', setting: 'settings', setings: 'settings', settigns: 'settings',
  password: 'password', passwrod: 'password', login: 'login', logon: 'login',
  gates: 'gate', doors: 'door', cameras: 'camera', schedules: 'schedule',
  pulses: 'pulse', seconds: 'second', six: '6', sixsecond: '6',
  photos: 'photo', picture: 'photo', avatar: 'photo', feeds: 'feed',
  staff: 'user', users: 'user', operator: 'user', account: 'user',
  add: 'add', create: 'add', invite: 'add',
};
function terms(text: string) {
  return [...new Set((text.toLowerCase().replace(/six-second/g, '6 second').match(/[a-z0-9_]+/g) ?? []).filter(t => !stop.has(t)).map(t => aliases[t] ?? t))];
}
const indexed = passages.map(p => ({ p, title: new Set(terms(p.title)), body: new Set(terms(p.text)) }));
export function findHelp(question: string, previousQuestion = '', page = '') {
  const query = terms(question), previous = terms(previousQuestion), pageTerms = terms(page);
  if (!query.length && !previous.length) return [];
  return indexed.map(({ p, title, body }) => {
    const scoreTerms = (words: string[]) => words.reduce((sum, term) => sum + (title.has(term) ? 6 : 0) + (body.has(term) ? 1 : 0), 0);
    const match = scoreTerms(query) + scoreTerms(previous) * 0.5;
    // Page context only breaks ties; it cannot turn an unrelated question into a match.
    return { p, score: match ? match * (p.source === 'SOFTWARE_HELP.md' ? 2 : 1) + scoreTerms(pageTerms) * 0.1 : 0 };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(x => x.p);
}
export const helpTopics = passages.filter(p => p.source === 'SOFTWARE_HELP.md' && p.text.trim().split('\n').length > 1).map(p => ({ id: p.id, title: p.title }));
export function helpPassage(id: string) { return passages.find(p => p.id === id); }
