/**
 * Atlas — the consumer surface.
 *
 * Layout (FE-P2):
 *
 *   ┌────────────────────────────────────┬──────────────────┐
 *   │                                    │ BusinessHeader   │
 *   │   <Map> from @vis.gl/react-google- │                  │
 *   │   maps fills the left column.      │ AgentStrip       │
 *   │                                    │                  │
 *   │   Floating MapSearch panel pinned  │ ChatPanel        │
 *   │   top-left (search + chips).       │  (scoped to biz  │
 *   │                                    │   + agent)       │
 *   │   AdvancedMarker per Business,     │                  │
 *   │   Pin colored by vertical.         │ SessionBar       │
 *   └────────────────────────────────────┴──────────────────┘
 *
 * Right rail is fixed-width (420px); the map gets every remaining pixel.
 *
 * One WS connection lives at this level so swapping the selected business
 * or agent doesn't tear down replies; the envelope on each send is what
 * tells the backend "this turn is about biz X, agent Y".
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import MapSurface from "../features/places/MapSurface";
import MapSearch from "../features/places/MapSearch";
import BusinessHeader from "../features/places/BusinessHeader";
import EmptyState from "../features/places/EmptyState";
import AgentStrip from "../features/agents/AgentStrip";
import ChatPanel, { type ChatAction } from "../features/chat/ChatPanel";
import SessionBar, { type LocStatus } from "../features/chat/SessionBar";
import { useWsChat, type TimelineItem } from "../features/chat/useWsChat";

import { SAMPLE_BUSINESSES } from "../features/places/sample-businesses";
import type { Business, Vertical } from "../features/places/types";
import { metaFor } from "../features/places/verticals";
import { agentBySlug, agentsFor, type AgentSlug } from "../features/agents/registry";

const DEFAULT_TENANT =
  (import.meta.env.VITE_DEFAULT_TENANT as string | undefined) || "demo";

export default function Atlas() {
  const tenantId = DEFAULT_TENANT;

  // ─── identity ──────────────────────────────────────────────────────
  // `useState` with a lazy initializer is React's pure way to do
  // mount-time work; we don't write to refs during render or mutate
  // sessionStorage outside of it.
  const [userId] = useState<string>(() => readOrCreateId("atlas_user_id"));
  const [sessionId, setSessionId] = useState<string>(() =>
    readOrCreateId("atlas_session_id"),
  );

  // ─── selection ─────────────────────────────────────────────────────
  // Selection lives near the top so callbacks declared below can clear it
  // without forward-referencing the setter.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentSelection, setAgentSelection] = useState<AgentSlug | null>(null);

  const newSession = useCallback(() => {
    const fresh = freshId();
    sessionStorage.setItem("atlas_session_id", fresh);
    setSessionId(fresh);
    setSelectedId(null);
  }, []);

  // ─── ws ────────────────────────────────────────────────────────────
  const { status, items, send: rawSend } = useWsChat({ tenantId, sessionId, userId });

  // ─── geolocation ───────────────────────────────────────────────────
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>("idle");

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocStatus("denied");
      return;
    }
    setLocStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus("granted");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // Mount-once geolocation request. We call the browser API directly inside
  // the effect (no setState in the sync body) so the
  // react-hooks/set-state-in-effect rule stays satisfied — only the async
  // permission callbacks touch React state.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus("granted");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // ─── filters ───────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [verticalFilter, setVerticalFilter] = useState<Vertical | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_BUSINESSES.filter((b) => {
      if (verticalFilter && b.vertical !== verticalFilter) return false;
      if (q && !b.display_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, verticalFilter]);

  // Effective selection: the user's selectedId, clamped to whatever's
  // currently in the filtered list. Derived in render (no effect) so the
  // selection auto-clears when chip changes hide it but doesn't leak a
  // stale ref into state.
  const selected: Business | null = useMemo(() => {
    if (!selectedId) return null;
    return filtered.find((b) => b.place_id === selectedId) || null;
  }, [filtered, selectedId]);

  // Effective agent: the user's pick, clamped to the agents valid for the
  // selected business's vertical; default-for-vertical if their pick is
  // stale. Also derived; the underlying `agentSelection` state only holds
  // intent.
  const agentSlug: AgentSlug | null = useMemo(() => {
    if (!selected) return null;
    const valid = agentsFor(selected.vertical);
    if (agentSelection && valid.some((a) => a.slug === agentSelection)) {
      return agentSelection;
    }
    return metaFor(selected.vertical).defaultAgent;
  }, [selected, agentSelection]);

  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  // ─── inline action (booking flow) derived from replies ─────────────
  const action = useMemo(() => deriveAction(items), [items]);

  // Thinking: between the last user turn and the next say/system reply.
  const thinking = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "reply") {
        if (it.reply.role === "say" || it.reply.role === "system") return false;
      } else if (it.kind === "user") {
        return true;
      }
    }
    return false;
  }, [items]);

  const onSendRaw = useCallback(
    (text: string) => {
      const decorated = userLoc
        ? `${text} [@${userLoc.lat.toFixed(5)},${userLoc.lng.toFixed(5)}]`
        : text;
      return rawSend(decorated);
    },
    [rawSend, userLoc],
  );

  const pickSlot = (slot: string) => {
    if (!selected || !agentSlug) return;
    onSendRaw(`[biz:${selected.place_id} agent:${agentSlug}] yes book ${slot}`);
  };

  return (
    <div className="h-full grid grid-cols-[1fr_420px] bg-paper-100 overflow-hidden">
      {/* ─── LEFT: map ─── */}
      <section className="relative min-w-0 bg-[var(--color-map-land)] overflow-hidden">
        <MapSurface
          businesses={filtered}
          selectedId={selectedId}
          onSelect={onSelect}
          userLoc={userLoc}
        />
        <MapSearch
          query={query}
          onQueryChange={setQuery}
          vertical={verticalFilter}
          onVerticalChange={setVerticalFilter}
          resultCount={filtered.length}
        />
      </section>

      {/* ─── RIGHT: 420px rail ─── */}
      <aside className="flex flex-col min-h-0 bg-white border-l border-paper-500/60">
        {selected && agentSlug ? (
          <>
            <BusinessHeader business={selected} />
            <AgentStrip
              vertical={selected.vertical}
              active={agentSlug}
              onPick={setAgentSelection}
            />
            <ChatPanel
              business={selected}
              agent={agentBySlug(agentSlug)}
              status={status}
              items={items}
              thinking={thinking}
              action={action}
              onSendRaw={onSendRaw}
              onPickSlot={pickSlot}
            />
          </>
        ) : (
          <EmptyState />
        )}

        <SessionBar
          tenantId={tenantId}
          status={status}
          locStatus={locStatus}
          userLoc={userLoc}
          onNewSession={newSession}
          onRequestLocation={requestLocation}
        />
      </aside>
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function freshId(): string {
  // crypto.randomUUID is pure under React's rules; Math.random isn't.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID().slice(0, 8)}`;
  }
  // Fallback for ancient environments — still pure across renders because
  // we only call this in event handlers, not in render bodies.
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return `web-${Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function readOrCreateId(key: string): string {
  const existing = sessionStorage.getItem(key) || localStorage.getItem(key);
  if (existing) return existing;
  const fresh = freshId();
  sessionStorage.setItem(key, fresh);
  return fresh;
}

function deriveAction(items: TimelineItem[]): ChatAction {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "reply") continue;
    const r = it.reply;
    if (r.role !== "say") continue;
    const a = (r.content as { action?: unknown }).action as Record<string, unknown> | null;
    if (!a) continue;
    const kind = String(a.kind || "");
    if (kind === "offer_slots") {
      return {
        kind,
        slots: Array.isArray(a.slots) ? (a.slots as unknown[]).map(String) : [],
        business_name: a.business_name ? String(a.business_name) : undefined,
      };
    }
    if (kind === "booking_confirmed") {
      return {
        kind,
        business_name: String(a.business_name || ""),
        slot: String(a.slot || ""),
        booking_id: String(a.booking_id || ""),
      };
    }
    if (kind === "booking_failed") {
      return { kind, reason: String(a.reason || "unknown error") };
    }
  }
  return null;
}
