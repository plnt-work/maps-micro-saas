/**
 * Atlas — the consumer surface.
 *
 * Layout:
 *
 *   ┌─────────────────┬──────────────────────────────────┐
 *   │                 │                                   │
 *   │   Chat panel    │            Map                    │
 *   │   (left rail,   │                                   │
 *   │    always       │      ┌─PlaceCard─┐                │
 *   │    visible)     │      │  (when    │                │
 *   │                 │      │   active) │                │
 *   │                 │      └───────────┘                │
 *   │                 │                                   │
 *   └─────────────────┴──────────────────────────────────┘
 *
 * The chat panel is the primary interface. Candidates returned by the agent
 * render inline in the chat (not as a separate sidebar). The PlaceCard
 * floats over the map only when the user has selected one and there's a
 * structured action (slots, confirmation, failure) to act on.
 *
 * The agent's intermediate trace (classify_intent, resolve_business, …) is
 * not rendered as bubbles — only the synthesizer's `say` reply hits the
 * conversation. Trace bubbles drive UI side-effects (candidates, thinking
 * pill, place card) instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import MapCanvas, { type MapPin } from "../components/atlas/MapCanvas";
import PlaceCard, { type PlaceAction } from "../components/atlas/PlaceCard";
import ChatPanel, { type Candidate } from "../components/atlas/ChatPanel";
import { useWsChat, type TimelineItem } from "../hooks/useWsChat";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const DEFAULT_TENANT =
  (import.meta.env.VITE_DEFAULT_TENANT as string | undefined) || "demo";

export default function Atlas() {
  const tenantId = DEFAULT_TENANT;
  const userId = stableId("atlas_user_id", "web-user");
  const [sessionId, setSessionId] = useState(stableId("atlas_session_id", null));

  const newSession = () => {
    const fresh = `web-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("atlas_session_id", fresh);
    setSessionId(fresh);
    setActiveName(null);
  };

  const { status, items, send: rawSend } = useWsChat({ tenantId, sessionId, userId });

  const [activeName, setActiveName] = useState<string | null>(null);

  // Best-effort: attach the user's coords to outgoing messages once granted.
  // Lets resolve_business handle "near me" intents accurately.
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const requestLocation = () => {
    if (!navigator.geolocation || locStatus === "asking") return;
    setLocStatus("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocStatus("granted"); },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  };
  useEffect(() => { requestLocation(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const send = (text: string) => {
    const decorated = userLoc
      ? `${text} [@${userLoc.lat.toFixed(5)},${userLoc.lng.toFixed(5)}]`
      : text;
    return rawSend(decorated);
  };

  const { candidates, action } = useMemo(
    () => deriveFromTimeline(items),
    [items],
  );

  // First candidate becomes active so the place card opens to something useful.
  useEffect(() => {
    if (!activeName && candidates.length > 0) setActiveName(candidates[0]!.name);
  }, [candidates, activeName]);

  // Thinking: between the last user turn and the next `say` / `system` reply.
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

  // Pins from candidates, projected into the SVG viewBox / GMap bounds.
  const pins: MapPin[] = useMemo(() => {
    if (candidates.length === 0) return [];
    const positions = [
      { x: 35, y: 38 }, { x: 52, y: 50 }, { x: 28, y: 56 },
      { x: 60, y: 36 }, { x: 42, y: 64 }, { x: 22, y: 42 },
    ];
    return candidates.slice(0, positions.length).map((c, i) => ({
      x: positions[i]!.x,
      y: positions[i]!.y,
      label: c.name,
      primary: c.name === activeName,
    }));
  }, [candidates, activeName]);

  const active = candidates.find((c) => c.name === activeName) || null;

  const pickSlot = (slot: string) => send(`yes book ${slot}`);
  const pickCandidate = (c: Candidate) => {
    setActiveName(c.name);
    send(`book ${c.name}${c.neighborhood ? ` in ${c.neighborhood}` : ""}`);
  };

  return (
    <div className="atlas-page">
      <ChatPanel
        tenantId={tenantId}
        status={status}
        items={items}
        thinking={thinking}
        candidates={candidates}
        activeName={activeName}
        action={action}
        locStatus={locStatus}
        userLoc={userLoc}
        onSend={send}
        onPickCandidate={pickCandidate}
        onPickSlot={pickSlot}
        onNewSession={newSession}
        onRequestLocation={requestLocation}
      />

      <section className="atlas-map">
        {MAPS_KEY ? <GoogleMapHost pins={pins} userLoc={userLoc} /> : <MapCanvas pins={pins} />}

        {(active || action) && (
          <PlaceCard
            place={active}
            action={action}
            onClose={() => setActiveName(null)}
            onPickSlot={pickSlot}
          />
        )}

        <div className="map-controls" aria-hidden>
          <button title="Zoom in">+</button>
          <button title="Zoom out">−</button>
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

interface DerivedState {
  candidates: Candidate[];
  action: PlaceAction;
}

function deriveFromTimeline(items: TimelineItem[]): DerivedState {
  let action: PlaceAction = null;
  let candidates: Candidate[] = [];

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "reply") continue;
    const r = it.reply;

    if (r.role === "say") {
      const a = (r.content as { action?: unknown }).action as Record<string, unknown> | null;
      if (a && !action) {
        const kind = String(a.kind || "");
        if (kind === "offer_slots") {
          action = { kind, slots: Array.isArray(a.slots) ? (a.slots as unknown[]).map(String) : [] };
        } else if (kind === "booking_confirmed") {
          action = {
            kind,
            business_name: String(a.business_name || ""),
            slot: String(a.slot || ""),
            booking_id: String(a.booking_id || ""),
          };
        } else if (kind === "booking_failed") {
          action = { kind, reason: String(a.reason || "unknown error") };
        } else if (kind === "show_candidates" && candidates.length === 0) {
          const list = Array.isArray(a.candidates) ? a.candidates as Record<string, unknown>[] : [];
          candidates = list.map(toCandidate);
        }
      }
    } else if (r.role === "resolve_business" && candidates.length === 0) {
      const c = r.content as Record<string, unknown>;
      const list = Array.isArray(c.candidates) ? c.candidates as Record<string, unknown>[] : [];
      if (list.length > 0) candidates = list.map(toCandidate);
      else if (c.name) candidates = [toCandidate(c)];
    }
  }

  return { candidates, action };
}

function toCandidate(c: Record<string, unknown>): Candidate {
  return {
    name: String(c.name || "(unknown)"),
    neighborhood: c.neighborhood ? String(c.neighborhood)
                  : c.city ? String(c.city)
                  : c.address ? String(c.address) : undefined,
    price: c.price ? String(c.price) : undefined,
    category: c.category ? String(c.category)
              : c.type ? String(c.type) : undefined,
    platform: c.platform ? String(c.platform)
              : c.source ? String(c.source) : undefined,
  };
}

function stableId(key: string, fallback: string | null): string {
  const existing = sessionStorage.getItem(key) || localStorage.getItem(key);
  if (existing) return existing;
  const fresh = fallback || `web-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, fresh);
  return fresh;
}

/* ─────── Google Map host (mounted only when VITE_GOOGLE_MAPS_KEY is set) ─────── */

/**
 * Pins arrive in the same 0..100 viewBox coordinate system as the SVG
 * fallback uses; we project that onto a tight bounds rectangle around the
 * map center so a 6-pin spread fits on screen. Markers are stable across
 * re-renders (diffed by label).
 */
function GoogleMapHost({
  pins,
  userLoc,
}: {
  pins: MapPin[];
  userLoc: { lat: number; lng: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

  useEffect(() => {
    if (!MAPS_KEY || !ref.current) return;
    let cancelled = false;
    (async () => {
      const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
      setOptions({ key: MAPS_KEY!, v: "weekly" });
      const { Map: GMap } = await importLibrary("maps");
      if (cancelled || !ref.current) return;
      mapRef.current = new GMap(ref.current, {
        center: userLoc || { lat: 19.0760, lng: 72.8777 },
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter + drop a blue "you are here" dot when geolocation resolves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLoc) return;
    map.panTo(userLoc);
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(userLoc);
    } else {
      userMarkerRef.current = new google.maps.Marker({
        position: userLoc,
        map,
        title: "Your location",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: "#1A73E8",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 3,
          scale: 8,
        },
        zIndex: 9999,
      });
    }
  }, [userLoc]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    if (!center) return;
    const lat0 = center.lat();
    const lng0 = center.lng();
    const span = 0.014;
    const projectLat = (y: number) => lat0 + (50 - y) * (span / 100);
    const projectLng = (x: number) => lng0 + (x - 50) * (span / 100);

    const seen = new Set<string>();
    let activePos: google.maps.LatLngLiteral | null = null;
    for (const p of pins) {
      seen.add(p.label);
      const pos = { lat: projectLat(p.y), lng: projectLng(p.x) };
      const iconSize = p.primary ? 36 : 28;
      const iconUrl = p.primary ? PIN_ICON_PRIMARY : PIN_ICON_DEFAULT;
      const icon = {
        url: iconUrl,
        scaledSize: new google.maps.Size(iconSize, iconSize),
        anchor: new google.maps.Point(iconSize / 2, iconSize),
      };
      const existing = markersRef.current.get(p.label);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
      } else {
        markersRef.current.set(p.label, new google.maps.Marker({ position: pos, map, title: p.label, icon }));
      }
      if (p.primary) activePos = pos;
    }
    for (const [label, marker] of markersRef.current) {
      if (!seen.has(label)) { marker.setMap(null); markersRef.current.delete(label); }
    }
    if (activePos) map.panTo(activePos);
  }, [pins]);

  return <div className="gmap-host"><div ref={ref} /></div>;
}

const PIN_ICON_DEFAULT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">
       <circle cx="14" cy="14" r="6" fill="#0E1116" stroke="#FBF7EE" stroke-width="2"/>
     </svg>`,
  );
const PIN_ICON_PRIMARY =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
       <defs>
         <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
           <stop offset="0" stop-color="#1A73E8"/>
           <stop offset=".55" stop-color="#A672E0"/>
           <stop offset="1" stop-color="#E26478"/>
         </linearGradient>
       </defs>
       <circle cx="18" cy="18" r="14" fill="none" stroke="url(#g)" stroke-width="1.4" opacity=".45"/>
       <circle cx="18" cy="18" r="8"  fill="url(#g)" stroke="#FBF7EE" stroke-width="2.5"/>
     </svg>`,
  );
