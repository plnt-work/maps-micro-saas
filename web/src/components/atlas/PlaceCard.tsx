/**
 * PlaceCard — the floating place detail popover.
 *
 * Three action states driven by the latest `synthesize_response.action`:
 *
 *   offer_slots         → slot chips; user must explicitly tap to confirm
 *   booking_confirmed   → confirmation with booking id
 *   booking_failed      → failure reason
 *
 * Explicit confirm-before-mutation is the rule (GPT-5 prompting guidance:
 * agents must list the action and require yes before mutating).
 */
import type { Candidate } from "./ChatPanel";

export type PlaceAction =
  | { kind: "offer_slots"; slots: string[] }
  | { kind: "booking_confirmed"; business_name: string; slot: string; booking_id: string }
  | { kind: "booking_failed"; reason: string }
  | null;

interface Props {
  place: Candidate | null;
  action: PlaceAction;
  onClose: () => void;
  onPickSlot: (slot: string) => void;
}

function splitWhen(iso: string): { when: string; day: string } {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { when: iso, day: "" };
    const when = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const day  = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return { when, day };
  } catch {
    return { when: iso, day: "" };
  }
}

export default function PlaceCard({ place, action, onClose, onPickSlot }: Props) {
  if (!place && !action) return null;

  const name = action && action.kind === "booking_confirmed"
    ? action.business_name || place?.name || "Selected place"
    : place?.name || "Selected place";

  return (
    <section className="place-card" role="dialog" aria-label={name}>
      <div className="place-card-head">
        <div>
          <h3>{name}</h3>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {(place?.platform || place?.category || place?.neighborhood || place?.price) && (
        <div className="meta">
          {place?.platform && <><span className="platform-badge">{place.platform}</span></>}
          {place?.category && <><span className="dot" /><span>{place.category}</span></>}
          {place?.neighborhood && <><span className="dot" /><span>{place.neighborhood}</span></>}
          {place?.price && <><span className="dot" /><span className="price">{place.price}</span></>}
        </div>
      )}

      <div className="place-card-body thin-scroll">
        {action?.kind === "offer_slots" && action.slots.length > 0 && (
          <section className="place-section">
            <h4>Available — tap to confirm</h4>
            <div className="slot-grid">
              {action.slots.map((slot) => {
                const { when, day } = splitWhen(slot);
                return (
                  <button
                    key={slot}
                    className="slot-chip"
                    onClick={() => onPickSlot(slot)}
                  >
                    <div className="when">{when}</div>
                    <div className="day">{day}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {action?.kind === "booking_confirmed" && (
          <section className="place-section">
            <h4>Booking</h4>
            <div className="confirm-card">
              <div className="tag">Confirmed</div>
              <div className="when">{splitWhen(action.slot).when} · {splitWhen(action.slot).day}</div>
              <div className="bid">id · {action.booking_id}</div>
            </div>
          </section>
        )}

        {action?.kind === "booking_failed" && (
          <section className="place-section">
            <h4>Booking</h4>
            <div className="fail-card">
              <div className="tag">Didn't go through</div>
              {action.reason}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
