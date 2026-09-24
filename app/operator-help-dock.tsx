"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import "./operator-help-dock.css";

type ChatItem = { role: "user" | "assistant"; content: string };

export default function OperatorHelpDock() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([{
    role: "assistant",
    content: "Ask how the portal works. I cannot open gates, issue fire commands, or change settings.",
  }]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, open]);

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
        </section>
      ) : (
        <button type="button" className="operator-help-toggle" onClick={() => setOpen(true)}>
          Ask Magic Keys
        </button>
      )}
    </div>
  );
}
