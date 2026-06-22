/**
 * DebugChat — right pane in /console. Lets an operator impersonate a
 * session against any tenant and see EVERY reply (not just the synthesizer's
 * say). All internal trace bubbles are rendered for diagnostics.
 */
import { useEffect, useRef, useState } from "react";

import { useWsChat, type Reply } from "../../hooks/useWsChat";

interface Props {
  tenantId: string;
  /** Bumped to start a fresh ConversationWorkflow. */
  resetVersion: number;
  onReset: () => void;
}

export default function DebugChat({ tenantId, resetVersion, onReset }: Props) {
  const sessionId = `debug-${resetVersion}`;
  const userId = "operator";
  const { status, items, send } = useWsChat({ tenantId, sessionId, userId });

  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [items]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (send(text)) setDraft("");
  };

  return (
    <aside className="debug-rail">
      <div className="head">
        <div>
          <div className="label">Live debug</div>
          <h4>{tenantId}</h4>
        </div>
        <button onClick={onReset} title="Start a fresh ConversationWorkflow">+ new</button>
      </div>

      <div className="debug-log thin-scroll" ref={logRef}>
        {items.length === 0 && (
          <div className="dbg-msg system">
            Send any prompt to start a Workflow. Every trace bubble shows here.
          </div>
        )}
        {items.map((it) => {
          if (it.kind === "user") {
            return <div key={`u-${it.seq}`} className="dbg-msg user">{it.text}</div>;
          }
          return <TraceBubble key={`r-${it.reply.seq}`} reply={it.reply} />;
        })}
        {status !== "connected" && (
          <div className="dbg-msg system">status · {status}</div>
        )}
      </div>

      <form className="debug-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={status === "connected" ? "send a turn…" : status}
          disabled={status !== "connected"}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={status !== "connected" || !draft.trim()} aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </aside>
  );
}

function TraceBubble({ reply }: { reply: Reply }) {
  const { role, content } = reply;
  if (role === "say") {
    const say = String((content as { say?: unknown }).say || "");
    return (
      <div className="dbg-msg agent">
        <span className="dbg-role">say</span>
        {say}
      </div>
    );
  }
  return (
    <div className="dbg-msg agent">
      <span className="dbg-role">{role}</span>
      <pre className="dbg-json">{JSON.stringify(content, null, 2)}</pre>
    </div>
  );
}
