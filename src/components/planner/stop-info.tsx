"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Message = { role: "user" | "assistant"; content: string };

// Starter prompts. The label is the pill; the question is what's sent (and shown as your message).
const STARTERS = [
  { label: "Tell me about this", question: "Give me a quick overview: what it is, why it's worth the stop, and how long to allow." },
  { label: "Latest info", question: "Any current closures, alerts, or track and road conditions I should know about?" },
  { label: "Getting there", question: "How do I get in? Road surface, 4WD or tide needs, and parking." },
  { label: "Things to do", question: "What are the best things to do or see here?" },
  { label: "Where to eat", question: "Where are good places to eat or grab a coffee nearby?" },
  { label: "Where to stay", question: "What campsites or accommodation are nearby, and do they need booking?" },
  { label: "Fuel & supplies", question: "Where's the nearest fuel, water and groceries, and is there phone signal?" },
  { label: "Weather then", question: "What's the weather usually like here on my dates?" },
  { label: "Good for kids?", question: "Is this good for kids? Any hazards, and are there toilets?" },
  { label: "Permits & fees", question: "Do I need any permits, passes or bookings, and what are the fees?" },
];

type Props = { stopId: string; stopName: string; mapsUrl: string | null; hipcampUrl: string | null; onClose: () => void };

/** AI briefing about a stop, with a follow-up conversation. Streams from /api/stops/[id]/chat. */
export function StopInfo({ stopId, stopName, mapsUrl, hipcampUrl, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // progress while streaming
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ask = useCallback(
    async (payload: { message?: string; reset?: boolean }) => {
      setError(null);
      setStreaming(true);
      if (payload.message) setMessages((m) => [...m, { role: "user", content: payload.message! }]);
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/stops/${stopId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Couldn't get an answer. Try again.");
        }
        // Newline-delimited JSON events: answer text, or a progress status.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as { t: "text" | "status"; v: string };
          if (event.t === "status") return setStatus(event.v);
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + event.v };
            return next;
          });
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
        }
        handle(buffer);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
        setMessages((m) => (m.at(-1)?.role === "assistant" && !m.at(-1)!.content ? m.slice(0, -1) : m));
      } finally {
        setStreaming(false);
        setStatus(null);
        abortRef.current = null;
      }
    },
    [stopId],
  );

  // Load the saved conversation, or ask for the first briefing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stops/${stopId}/chat`);
        if (!res.ok) throw new Error("Couldn't load this stop's info.");
        const { messages: saved } = (await res.json()) as { messages: Message[] };
        if (cancelled) return;
        setLoading(false);
        if (saved.length) setMessages(saved);
        // An empty conversation waits for a starter pill or a typed question.
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [stopId, ask]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    void ask({ message: text });
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,20,22,0.45)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-info-title"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[22px] bg-paper min-[640px]:inset-auto min-[640px]:top-1/2 min-[640px]:left-1/2 min-[640px]:w-[640px] min-[640px]:max-w-[calc(100%-32px)] min-[640px]:-translate-x-1/2 min-[640px]:-translate-y-1/2 min-[640px]:rounded-2xl min-[640px]:shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0">
            <span className="text-[12.5px] font-bold text-muted">About this stop</span>
            <div className="flex items-center gap-2">
              <h2 id="stop-info-title" className="truncate text-[26px] font-bold">
                {stopName}
              </h2>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${stopName} in Google Maps`}
                  title="Open in Google Maps"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-[1.5px] border-line text-ocean hover:border-ocean"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </a>
              )}
              {hipcampUrl && (
                <a
                  href={hipcampUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Find Hipcamps near ${stopName}`}
                  title="Find Hipcamps nearby"
                  className="flex h-8 shrink-0 items-center gap-1 rounded-lg border-[1.5px] border-line px-2 text-[12.5px] font-bold text-myrtle hover:border-myrtle"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.5 21 12 4l8.5 17" />
                    <path d="M12 4v17" />
                    <path d="M2 21h20" />
                  </svg>
                  Hipcamp
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer px-2 py-1 text-[22px] leading-none text-muted">
            ×
          </button>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
          {loading && <p className="text-muted">Loading…</p>}
          {!loading && messages.length === 0 && !streaming && (
            <div>
              <p className="mb-3 text-[14px] text-muted">Ask anything about this stop, or start with one of these.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STARTERS.slice(0, 2).map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void ask({ message: s.question })}
                    className="cursor-pointer rounded-xl border-[1.5px] border-line bg-soft px-3.5 py-3 text-left hover:border-ocean"
                  >
                    <span className="block font-bold">{s.label}</span>
                    <span className="text-[13px] text-muted">{s.question}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STARTERS.slice(2).map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void ask({ message: s.question })}
                    className="min-h-9 cursor-pointer rounded-full border-[1.5px] border-line bg-paper px-3 text-[13.5px] hover:border-ocean"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="my-3 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-paper">
                {m.content}
              </p>
            ) : (
              <div key={i} className="ai-answer my-3">
                {m.content ? (
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                ) : (
                  <p className="text-muted">Starting…</p>
                )}
              </div>
            ),
          )}
          {streaming && status && (
            <p className="my-2 flex items-center gap-2 text-[13.5px] text-muted" role="status">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ocean" aria-hidden="true" />
              {status}
              {status.startsWith("Search") || status.startsWith("Read")
                ? " Checking current info can take up to a minute."
                : ""}
            </p>
          )}
          {error && (
            <p role="alert" className="notice notice-bad my-2">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-line px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {messages.length > 0 && (
            <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 no-scrollbar" aria-label="Suggested questions">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={streaming}
                  onClick={() => void ask({ message: s.question })}
                  className="min-h-8 shrink-0 cursor-pointer rounded-full border-[1.5px] border-line bg-paper px-2.5 text-[12.5px] hover:border-ocean disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={messages.length ? "Ask a follow-up…" : "Or type your own question…"}
              aria-label="Ask a follow-up question"
              maxLength={2000}
              className="min-w-0 flex-1 resize-none rounded-[10px] border-[1.5px] border-line bg-soft px-3 py-2 text-[16px]"
            />
            <button type="submit" className="btn btn-primary" disabled={streaming || !draft.trim()}>
              {streaming ? "…" : "Send"}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span>AI-generated with web search. Check anything important before you rely on it.</span>
            <button
              type="button"
              disabled={streaming}
              onClick={async () => {
                setMessages([]);
                setError(null);
                await fetch(`/api/stops/${stopId}/chat`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reset: true }),
                }).catch(() => setError("Couldn't clear the conversation. Try again."));
                inputRef.current?.focus();
              }}
              className="ml-3 shrink-0 cursor-pointer font-bold text-ocean disabled:opacity-50"
            >
              Start over
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
