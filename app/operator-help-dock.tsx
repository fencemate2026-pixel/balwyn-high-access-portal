"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import "./operator-help-dock.css";

type ChatItem = { role: "user" | "assistant"; content: string };
type HelpFrame = { mediaType: "image/jpeg"; data: string };

const CLIP_SECONDS = 15;
const MAX_EDGE = 768;

function readError(kind: "photo" | "clip") {
  return kind === "clip" ? "That clip could not be read." : "That picture could not be read.";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x4000));
  }
  return btoa(binary);
}

async function jpegData(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, MAX_EDGE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(readError("photo"));
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.72;
  while (quality >= 0.4) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error(readError("photo"));
    if (blob.size <= 500_000) {
      const data = await blobToBase64(blob);
      if (data.length <= 640_000 && data.length % 4 === 0) return data;
    }
    quality = Math.round((quality - 0.16) * 100) / 100;
  }
  throw new Error("That picture is too large. Use a smaller photo or a shorter clip.");
}

async function frameFromImage(file: File): Promise<HelpFrame> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(readError("photo"));
  }
  try {
    return { mediaType: "image/jpeg", data: await jpegData(bitmap, bitmap.width, bitmap.height) };
  } finally {
    bitmap.close();
  }
}

function waitForMedia(target: HTMLVideoElement, event: "seeked" | "loadeddata", ms: number) {
  let cancel = () => {};
  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error(readError("clip"))), ms);
    const ok = () => finish();
    const fail = () => finish(new Error(readError("clip")));
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener("error", fail);
      if (error) reject(error);
      else resolve();
    }
    cancel = () => finish();
    target.addEventListener(event, ok);
    target.addEventListener("error", fail);
  });
  return { done, cancel: () => cancel() };
}

async function seekVideo(video: HTMLVideoElement, time: number) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = Math.min(Math.max(time, 0), Math.max(duration - 0.05, 0));
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.01) return;
  const event = video.readyState < 2 && Math.abs(video.currentTime - target) < 0.01 ? "loadeddata" : "seeked";
  const waiter = waitForMedia(video, event, 8000);
  if (event === "seeked") video.currentTime = target;
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.01) {
    waiter.cancel();
    return;
  }
  try {
    await waiter.done;
  } catch (error) {
    waiter.cancel();
    throw error;
  }
}

async function framesFromClip(file: File): Promise<HelpFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(readError("clip"))), 8000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error(readError("clip"))); };
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error(readError("clip"));
    }
    if (video.duration > CLIP_SECONDS + 0.05) throw new Error("Use a clip of 15 seconds or less.");
    try {
      await video.play();
      video.pause();
    } catch { /* Seek still copies a frame when the browser has decoded one. */ }
    const end = Math.max(video.duration - 0.05, 0);
    const times = video.duration < 0.2 ? [0] : [0, video.duration / 2, end];
    const unique: number[] = [];
    for (const time of times) {
      const rounded = Math.round(time * 100) / 100;
      if (!unique.some((item) => Math.abs(item - rounded) < 0.05)) unique.push(rounded);
    }
    const frames: HelpFrame[] = [];
    for (const time of unique.slice(0, 3)) {
      await seekVideo(video, time);
      frames.push({ mediaType: "image/jpeg", data: await jpegData(video, video.videoWidth, video.videoHeight) });
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
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
  const [watching, setWatching] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [events, setEvents] = useState<HelpEvent[]>([]);
  const [items, setItems] = useState<ChatItem[]>([{
    role: "assistant",
    content: "Ask me where to find anything in Magic Keys: opening gates, schedules, stadium bookings, gate servicing, users, settings or fire evacuation. You can attach a photo or a short clip of a school scene and I will look at it. I explain the steps on screen; I can’t press the controls for you, and I can’t see the live cameras.",
  }]);
  const [frames, setFrames] = useState<HelpFrame[]>([]);
  const [attachNote, setAttachNote] = useState("");
  const [attachError, setAttachError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function clearAttachment() {
    setFrames([]);
    setAttachNote("");
    setAttachError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function attachFile(file: File) {
    setAttachError("");
    setAttachNote("");
    setFrames([]);
    const isImage = file.type === "image/jpeg" || file.type === "image/png";
    const isVideo = file.type === "video/mp4" || file.type === "video/webm";
    try {
      if (!isImage && !isVideo) throw new Error("Attach a photo or a short clip.");
      if (file.size > 8 * 1024 * 1024) throw new Error("That picture is too large. Use a smaller photo or a shorter clip.");
      const sampled = isImage ? [await frameFromImage(file)] : await framesFromClip(file);
      setFrames(sampled);
      setAttachNote(isVideo
        ? `Clip ready (${sampled.length} moment${sampled.length === 1 ? "" : "s"}). Ask what it shows, then send.`
        : "Photo ready. Ask what it shows, then send.");
    } catch (error) {
      setFrames([]);
      setAttachError(error instanceof Error ? error.message : readError(isVideo ? "clip" : "photo"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    const history = items.slice(-6);
    const attached = frames;
    const note = attached.length === 1 ? "Photo attached" : attached.length > 1 ? "Clip attached" : "";
    setWatching(attached.length > 0);
    setQuestion("");
    clearAttachment();
    setItems((current) => [...current, { role: "user", content: note ? `${text}\n(${note})` : text }]);
    setBusy(true);
    try {
      const response = await fetch("/api/help", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history, page: "dashboard", ...(attached.length ? { frames: attached } : {}) }),
      });
      const body = await response.json() as { answer?: string; error?: string; issue?: string };
      const reply = body.answer || body.error || body.issue || "Help is unavailable right now.";
      setItems((current) => [...current, { role: "assistant", content: reply }]);
    } catch {
      setItems((current) => [...current, { role: "assistant", content: "The help service could not be reached." }]);
    } finally {
      setBusy(false);
      setWatching(false);
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
                <p className="operator-help-item is-assistant">No help questions recorded yet.</p>
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
                {busy ? <p className="operator-help-item is-assistant">{watching ? "Looking…" : "Looking that up…"}</p> : null}
              </div>
              <form onSubmit={send}>
                <label className="sr-only" htmlFor="operator-help-input">Question</label>
                <input
                  id="operator-help-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={1500}
                  placeholder="How do I add a user?"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !question.trim()}>Send</button>
                <label className="operator-help-file">
                  Attach a photo or clip
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,video/mp4,video/webm"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void attachFile(file);
                    }}
                  />
                </label>
                {attachNote || attachError ? (
                  <p className={attachError ? "operator-help-note is-error" : "operator-help-note"} role={attachError ? "alert" : undefined}>
                    {attachError || attachNote}
                    {attachNote && !attachError ? (
                      <button type="button" className="operator-help-clear" onClick={clearAttachment}>Remove</button>
                    ) : null}
                  </p>
                ) : null}
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
