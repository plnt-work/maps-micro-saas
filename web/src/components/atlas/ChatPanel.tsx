/**
 * ChatPanel — the left-rail conversational interface.
 *
 * One cohesive panel that replaces the previously-fragmented Sidebar +
 * Conversation + AskBar trio. Contents top-to-bottom:
 *
 *   ┌────────────────────────────────────┐
 *   │ Brand · tenant · status · + new    │   ← header
 *   ├────────────────────────────────────┤
 *   │ Starter card OR conversation       │
 *   │  · user / agent bubbles            │
 *   │  · inline candidate cards          │   ← scrollable log
 *   │  · thinking pill                   │
 *   ├────────────────────────────────────┤
 *   │ [ ask anything …            ] [→]  │   ← composer (always interactive)
 *   └────────────────────────────────────┘
 *
 * The composer's input is ALWAYS enabled so the user can type while we
 * connect; only the send button gates on `status === "connected"`. The
 * connection state is mirrored in both the header pill and the input
 * placeholder so there's no mystery about why send is greyed out.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { Status, TimelineItem } from "../../hooks/useWsChat";

export interface Candidate {
  name: string;
  neighborhood?: string;
  price?: string;
  category?: string;
  platform?: string;
}

export type LocStatus = "idle" | "asking" | "granted" | "denied";

export type ChatAction =
  | { kind: "offer_slots"; slots: string[]; business_name?: string }
  | { kind: "booking_confirmed"; business_name: string; slot: string; booking_id: string }
  | { kind: "booking_failed"; reason: string }
  | null;

interface Props {
  tenantId: string;
  status: Status;
  items: TimelineItem[];
  thinking: boolean;
  candidates: Candidate[];
  activeName: string | null;
  action?: ChatAction;
  locStatus?: LocStatus;
  userLoc?: { lat: number; lng: number } | null;
  onSend: (text: string) => boolean;
  onPickCandidate: (c: Candidate) => void;
  onPickSlot?: (slot: string) => void;
  onNewSession: () => void;
  onRequestLocation?: () => void;
}

const STARTERS = [
  "find me kebabs in Colaba",
  "table for two tomorrow at 8pm",
  "best-rated cafe within 1km",
];

export default function ChatPanel({
  tenantId, status, items, thinking, candidates, activeName,
  action = null, locStatus = "idle", userLoc = null,
  onSend, onPickCandidate, onPickSlot, onNewSession, onRequestLocation,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest content.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [items, thinking, candidates.length]);

  // Auto-focus once the socket is live so a returning user can type instantly.
  useEffect(() => {
    if (status === "connected") inputRef.current?.focus();
  }, [status]);

  const turns = items.filter((it) => {
    if (it.kind === "user") return true;
    return it.reply.role === "say" || it.reply.role === "system";
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (onSend(text)) setDraft("");
  };

  const sendExample = (text: string) => onSend(text);

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <div className="chat-brand">
          <div className="mark" aria-hidden />
          <div>
            <div className="name">Atlas</div>
            <div className="sub">tenant · {tenantId}</div>
          </div>
        </div>
        <div className="chat-header-right">
          <span className={`ws-pill ${status}`} aria-live="polite">
            <span className="dot" />
            {status}
          </span>
          <button
            type="button"
            className={`ws-pill ${locStatus === "granted" ? "connected" : locStatus === "denied" ? "error" : "idle"}`}
            onClick={() => onRequestLocation?.()}
            title={
              locStatus === "granted" && userLoc ? `lat ${userLoc.lat.toFixed(4)}, lng ${userLoc.lng.toFixed(4)}`
              : locStatus === "denied"  ? "Location blocked — enable in browser settings, then click to retry"
              : locStatus === "asking"  ? "Asking for location…"
              : "Click to share your location"
            }
          >
            <span className="dot" />
            {locStatus === "granted" ? "located"
             : locStatus === "asking" ? "locating…"
             : locStatus === "denied" ? "blocked"
             : "share location"}
          </button>
          <button className="header-chip" onClick={onNewSession} title="Start a fresh conversation">
            + new
          </button>
        </div>
      </header>

      <div className="chat-log thin-scroll" ref={logRef}>
        {turns.length === 0 && candidates.length === 0 && (
          <div className="chat-starter">
            <div className="spark" aria-hidden />
            <h4>How can I help?</h4>
            <p>
              Ask in plain language — I'll search venues on the map, check
              availability, and place a hold once you confirm.
            </p>
            <div className="starter-chips">
              {STARTERS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="starter-chip"
                  onClick={() => sendExample(ex)}
                  disabled={status !== "connected"}
                  title={status !== "connected" ? `waiting on backend (${status})` : undefined}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((it) => {
          if (it.kind === "user") {
            return <div key={`u-${it.seq}`} className="bubble user">{it.text}</div>;
          }
          const r = it.reply;
          if (r.role === "system") {
            const note = String((r.content as { note?: unknown }).note || "");
            if (!note) return null;
            return <div key={`s-${r.seq}`} className="bubble system">{note}</div>;
          }
          const say = String((r.content as { say?: unknown }).say || "");
          if (!say) return null;
          return <div key={`a-${r.seq}`} className="bubble agent">{say}</div>;
        })}

        {candidates.length > 0 && !action && (
          <div className="inline-results">
            {candidates.map((c, i) => (
              <button
                key={`${c.name}-${i}`}
                type="button"
                className={`inline-result ${activeName === c.name ? "active" : ""}`}
                onClick={() => onPickCandidate(c)}
              >
                <span className="marker">{String.fromCharCode(65 + i)}</span>
                <div className="body">
                  <div className="name">{c.name}</div>
                  <div className="meta">
                    {c.platform && <span className="platform-badge">{c.platform}</span>}
                    {c.category && <span>{c.category}</span>}
                    {c.neighborhood && <span className="sep">· {c.neighborhood}</span>}
                    {c.price && <span className="price">· {c.price}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {action?.kind === "offer_slots" && action.slots.length > 0 && (
          <div className="inline-action">
            <div className="action-head">Tap to confirm{action.business_name ? ` at ${action.business_name}` : ""}</div>
            <div className="slot-row">
              {action.slots.map((slot) => {
                const d = new Date(slot);
                const ok = !Number.isNaN(d.getTime());
                const when = ok ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : slot;
                const day  = ok ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
                return (
                  <button
                    key={slot}
                    type="button"
                    className="slot-chip"
                    onClick={() => onPickSlot?.(slot)}
                    disabled={!onPickSlot || status !== "connected"}
                  >
                    <div className="when">{when}</div>
                    {day && <div className="day">{day}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {action?.kind === "booking_confirmed" && (
          <div className="inline-action confirmed">
            <div className="tag">Confirmed</div>
            <div className="title">{action.business_name}</div>
            <div className="meta">{action.slot} · id {action.booking_id}</div>
          </div>
        )}

        {action?.kind === "booking_failed" && (
          <div className="inline-action failed">
            <div className="tag">Didn't go through</div>
            <div className="meta">{action.reason}</div>
          </div>
        )}

        {thinking && (
          <div className="bubble agent thinking">
            <span className="pulse" aria-hidden><span /><span /><span /></span>
            <span className="text">thinking…</span>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            status === "connected"   ? "Ask anything — find a place, book a table…"
            : status === "connecting" ? "connecting to backend…"
            : status === "error"      ? "agent offline — is uvicorn running on :8080?"
            : status === "closed"     ? "reconnecting…"
            : "starting…"
          }
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="send"
          disabled={!draft.trim() || status !== "connected"}
          aria-label="Send"
          title={status !== "connected" ? `cannot send — status: ${status}` : "Send"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>

      <Link to="/console" className="console-link">operator console →</Link>
    </aside>
  );
}
