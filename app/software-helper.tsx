"use client";
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, BookOpen, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { HelpMessage, HelpPage } from '@/lib/help-agent';
type Source = { id: string; title: string; source: string; text: string };
type Reply = { mode: string; status?: string; issue?: string; answer: string; sources: Source[] };
type Turn = { question: string; reply: Reply };
const suggestions: Partial<Record<HelpPage, string[]>> = {
  settings: ['How do I unlock equipment settings?', 'Does saving a Pi configuration update the Pi?'],
  gates: ['Which gates are active?', 'Why is the gate position unknown?'],
  guidance: ['Explain the Exit 12 classroom example', 'What does PINCH unavailable mean?'],
  cctv: ['Are the camera feeds live?', 'How do plan upgrades work?'],
  access: ['How do I change my photo?', 'How do controller credentials work?'],
  activity: ['How do I export the activity log?', 'Does queued mean the gate opened?'],
  schedule: ['How do I change a gate schedule?', 'Will a saved schedule operate the gate?'],
  automation: ['How do automation rules work?', 'Why are the settings locked?'],
  safety: ['What can the emergency demonstration do?', 'Can the helper operate a gate?'],
};
export default function SoftwareHelper({ page = 'dashboard' }: { page?: HelpPage }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [provider, setProvider] = useState('the configured AI provider');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [guide, setGuide] = useState<Source | null>(null);
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState('');
  const lock = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch('/api/help', { cache: 'no-store', signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('Sign in again to access software help.');
      return r.json();
    }).then(b => { setTopics(b.topics); setConfigured(b.aiConfigured); setProvider(b.provider); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => { if (turns.length || pending) end.current?.scrollIntoView({ block: 'nearest' }); }, [turns, pending]);
  async function ask(value = question) {
    const text = value.trim();
    if (!text || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setGuide(null); setPending(text); setQuestion('');
    const history: HelpMessage[] = turns.slice(-3).flatMap(t => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.reply.answer.slice(0, 3000) }]);
    try {
      const r = await fetch('/api/help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, history, page }), signal: AbortSignal.timeout(30000) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Help is temporarily unavailable.');
      setTurns(old => [...old, { question: text, reply: b }].slice(-20));
    } catch (e) { setError(e instanceof Error ? e.message : 'Help is temporarily unavailable.'); setQuestion(text); }
    finally { lock.current = false; setBusy(false); setPending(''); }
  }
  async function article(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const r = await fetch(`/api/help?article=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Guide unavailable.');
      setGuide(b.article);
    } catch (e) { setError(e instanceof Error ? e.message : 'Guide unavailable.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const last = turns.at(-1)?.reply;
  const status = configured === null ? 'Checking connection…' : !configured ? 'Guide mode · AI not connected' : last?.status === 'unavailable' ? 'AI unavailable · guides available' : last?.mode === 'ai' ? 'AI connected · answers with sources' : 'AI configured · ready to ask';
  return <>
    <Button className="software-helper-launch" onClick={() => setOpen(true)}><MessageCircle />Magic Keys help</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="software-helper-sheet">
      <SheetHeader><SheetTitle>Magic Keys help agent</SheetTitle><SheetDescription>{status}</SheetDescription></SheetHeader>
      <div className="software-helper-body">
        <div className="helper-welcome"><p>Help with every area of your portal. Ask a question, then follow up.</p><Button variant="outline" disabled={busy || (!turns.length && !guide)} onClick={() => { setTurns([]); setGuide(null); setError(''); setQuestion(''); }}><Plus />New chat</Button></div>
        <div className="helper-topics" aria-label="Suggested questions">{(suggestions[page] ?? ['Which gates are active?', 'Why does a six-second pulse report failure?', 'How do I unlock settings?']).map(q => <button key={q} disabled={busy} onClick={() => void ask(q)}>{q}</button>)}</div>
        <div className="helper-conversation" role="log" aria-label="Help conversation" aria-live="polite" aria-busy={busy}>
          {turns.map((turn, i) => <div key={i}><div className="helper-user"><small>YOU</small><p>{turn.question}</p></div><section className="helper-answer"><small>{turn.reply.mode === 'ai' ? 'AI ANSWER' : 'GUIDE EXCERPT'}</small><p>{turn.reply.answer}</p>{turn.reply.status === 'unavailable' && <p className="helper-note">{turn.reply.issue || 'AI replies are temporarily unavailable.'} This is the matching guide text.</p>}{turn.reply.sources.length > 0 && <details><summary><BookOpen />Sources ({turn.reply.sources.length})</summary>{turn.reply.sources.map(s => <details key={s.id}><summary>{s.title}</summary><pre>{s.text}</pre><small>{s.source}</small></details>)}</details>}</section></div>)}
          {pending && <div className="helper-user"><small>YOU</small><p>{pending}</p></div>}
          {busy && <p role="status">Finding guidance…</p>}<div ref={end} />
        </div>
        {error && <p role="alert" className="helper-error">{error}</p>}
        <form className="helper-composer" onSubmit={e => { e.preventDefault(); void ask(); }}>
          <label htmlFor="software-question">{turns.length ? 'Ask a follow-up' : 'Your question'}</label>
          <textarea id="software-question" value={question} maxLength={1500} rows={3} onChange={e => setQuestion(e.target.value)} placeholder="What would you like help with?" />
          <Button disabled={busy || !question.trim()} type="submit"><Send />{busy ? 'Finding an answer…' : 'Send question'}</Button>
        </form>
        <p className="helper-note">{configured ? `Questions, recent messages, guides and limited portal context are sent to ${provider}. ` : 'Guide answers are available now. AI replies need an administrator to connect the service. '}Do not include passwords or personal records. Chat clears on reload.</p>
        {guide && <section className="helper-answer" aria-label="Selected guide"><h3>{guide.title}</h3><pre>{guide.text.replace(/^#{1,3}[^\n]*\n/, '')}</pre><small>Source: {guide.source}</small></section>}
        <details className="helper-guide-browser"><summary><BookOpen />Browse {topics.length} guide topics</summary><label className="helper-search"><Search /><input aria-label="Search guide topics" placeholder="Search topics" value={filter} onChange={e => setFilter(e.target.value)} /></label><div className="helper-topics">{topics.filter(t => t.title.toLowerCase().includes(filter.toLowerCase())).map(t => <button key={t.id} disabled={busy} onClick={() => void article(t.id)}>{t.title}</button>)}</div>{topics.length > 0 && !topics.some(t => t.title.toLowerCase().includes(filter.toLowerCase())) && <p>No matching topics. Try a different word.</p>}</details>
        <p className="helper-note">Explains the software; cannot operate gates or change settings.</p>
      </div>
    </SheetContent></Sheet>
  </>;
}
