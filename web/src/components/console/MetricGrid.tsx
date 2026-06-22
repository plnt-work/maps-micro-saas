/**
 * MetricGrid — the editorial metric tiles + recent sessions block.
 */
import type { TenantMetrics, PlacesStatus } from "../../api/admin";

interface Props {
  metrics: TenantMetrics | null;
  places: PlacesStatus | null;
}

export default function MetricGrid({ metrics, places }: Props) {
  if (!metrics) {
    return (
      <p style={{ color: "var(--coal-mute)", marginTop: 28, fontStyle: "italic", fontFamily: "Instrument Serif, serif", fontSize: 18 }}>
        Loading metrics…
      </p>
    );
  }

  const lastSeen = metrics.last_activity_ts
    ? new Date(metrics.last_activity_ts * 1000).toLocaleString()
    : "—";

  const totalCalls = Object.values(metrics.micro_agent_calls).reduce((a, b) => a + b, 0);
  const totalBookings = Object.values(metrics.bookings).reduce((a, b) => a + b, 0);

  const callsBreak = Object.entries(metrics.micro_agent_calls)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.padEnd(22)} ${v}`)
    .join("\n") || "—";

  const bookingsBreak = Object.entries(metrics.bookings)
    .map(([k, v]) => `${k.padEnd(14)} ${v}`)
    .join("\n") || "—";

  return (
    <>
      <div className="metric-grid">
        <Tile label="Conversations" value={metrics.conversation_count} />
        <Tile label="Memory turns"   value={metrics.memory_turns} />
        <Tile label="Micro-agent calls" value={totalCalls} breakdown={callsBreak} iri />
        <Tile label="Bookings"       value={totalBookings} breakdown={bookingsBreak} />
      </div>

      <div className="places-strip">
        <span className={`dot ${places?.enabled ? "on" : "off"}`} />
        <span>
          <b>Places API</b> · {places?.enabled
            ? <>enabled · {places.cache.text_search_rows} cached query{places.cache.text_search_rows === 1 ? "" : "ies"}</>
            : <>disabled · falling back to LLM world knowledge</>}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>
          last seen · {lastSeen}
        </span>
      </div>

      {metrics.recent_sessions.length > 0 && (
        <>
          <div className="section-head">
            <h3>Recent sessions</h3>
            <span className="label">{metrics.recent_sessions.length} live</span>
          </div>
          <div className="session-grid">
            {metrics.recent_sessions.map((s) => (
              <div key={s.session_id} className="session-row">
                <div style={{ minWidth: 0 }}>
                  <div className="sid">{s.session_id}</div>
                  <div className="meta">
                    user {s.user_id || "—"} · {s.message_count} calls · {s.roles.join(", ")}
                  </div>
                </div>
                <div className="ts">{new Date(s.last_ts * 1000).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Tile({
  label, value, breakdown, iri,
}: {
  label: string;
  value: string | number;
  breakdown?: string;
  iri?: boolean;
}) {
  return (
    <div className={`metric-tile ${iri ? "iri" : ""}`}>
      <div className="label">{label}</div>
      <div className={`value ${typeof value === "string" ? "small" : ""}`}>{value}</div>
      {breakdown && <div className="break">{breakdown}</div>}
    </div>
  );
}
