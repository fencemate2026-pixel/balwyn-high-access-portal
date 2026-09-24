"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import "./operator-help-dock.css";

type ChatItem = { role: "user" | "assistant"; content: string };
type HelpEvent = {
  id: string;
  created_at: string;
  actor_role: string;
  page: string;
  question: string;
  status: string;
  mode: string;
  article_id: string | null;
};

export default function OperatorHelpDock() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "insights">("chat");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [events, setEvents] = useState<HelpEvent[]>([]);
  const [items, setItems] = useState<ChatItem[]>([{
    role: "assistant",
    content: "Ask how the portal works. I cannot open gates, issue fire commands, or change settings.",
  }]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, open, tab]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch("/api/help/events", { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setAdmin(false); return; }
      const body = await response.json() as { events?: HelpEvent[] };
      setAdmin(true);
      setEvents(body.events ?? []);
    }).catch(() => { if (active) setAdmin(false); });
    return () => { active = false; };
  }, [open]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    const history = items.slice(-6);
    setQuestion("");
    setItems((current) => [...current, { role: "user", content: text }]);
    setBusy(true);
    try {
      const response = await fetch("/api/help", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history, page: "dashboard" }),
      });
      const body = await response.json() as { answer?: string; error?: string; issue?: string };
      const reply = body.answer || body.error || body.issue || "Help is unavailable right now.";
      setItems((current) => [...current, { role: "assistant", content: reply }]);
    } catch {
      setItems((current) => [...current, { role: "assistant", content: "The help service could not be reached." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="operator-help-dock">
      {open ? (
        <section className="operator-help-panel" aria-label="Magic Keys help">
          <header>
            <strong>Ask Magic Keys</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help">Close</button>
          </header>
          {admin ? (
            <nav className="operator-help-tabs" aria-label="Help views">
              <button type="button" className={tab === "chat" ? "is-active" : ""} onClick={() => setTab("chat")}>Chat</button>
              <button type="button" className={tab === "insights" ? "is-active" : ""} onClick={() => setTab("insights")}>What people ask</button>
            </nav>
          ) : null}
          {tab === "insights" && admin ? (
            <div className="operator-help-list" ref={listRef}>
              {events.length === 0 ? (
                <p className="operator-help-item is-assistant">No help questions recorded yet. Apply the help_events migration if this stays empty after people ask.</p>
              ) : events.map((item) => (
                <p key={item.id} className="operator-help-item is-assistant">
                  <small>{item.status} · {item.actor_role} · {item.page}</small>
                  {item.question}
                </p>
              ))}
            </div>
          ) : (
            <>
              <div className="operator-help-list" ref={listRef}>
                {items.map((item, index) => (
                  <p key={`${item.role}-${index}`} className={`operator-help-item is-${item.role}`}>{item.content}</p>
                ))}
                {busy ? <p className="operator-help-item is-assistant">Looking up the guide…</p> : null}
              </div>
              <form onSubmit={send}>
                <label className="sr-only" htmlFor="operator-help-input">Question</label>
                <input
                  id="operator-help-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={1500}
                  placeholder="How does fire evacuation work?"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !question.trim()}>Send</button>
              </form>
            </>
          )}
        </section>
      ) : (
        <button type="button" className="operator-help-toggle" onClick={() => setOpen(true)}>
          Ask Magic Keys
        </button>
      )}
    </div>
  );
}
