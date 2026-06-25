/**
 * Agent registry — the small fixed set of micro-agents the right rail can
 * mount per business. Each business's vertical maps to a default agent in
 * features/places/verticals.ts; the AgentStrip surfaces the rest as a
 * segmented control so the user can pivot mid-conversation.
 *
 * The `slug` is what gets serialized into the outgoing message envelope
 *   `[biz:<place_id> agent:<slug>] <user text>`
 * so the backend MA stream can route to the right micro-agent worker. Keep
 * the slug stable across UI rewrites.
 */
import type { Vertical } from "../places/types";

export type AgentSlug =
  | "reservations"
  | "appointments"
  | "menu"
  | "inventory"
  | "membership"
  | "concierge";

export interface AgentDef {
  slug: AgentSlug;
  label: string;
  /** One-line description shown in the strip tooltip. */
  hint: string;
  /** Which verticals this agent applies to. */
  verticals: Vertical[];
}

export const AGENTS: AgentDef[] = [
  {
    slug: "reservations",
    label: "Reservations",
    hint: "Check availability, hold tables, confirm bookings.",
    verticals: ["restaurant"],
  },
  {
    slug: "menu",
    label: "Menu",
    hint: "Browse dishes, prices, dietary tags. No mutation.",
    verticals: ["restaurant"],
  },
  {
    slug: "appointments",
    label: "Appointments",
    hint: "Find slots and book with the practitioner / stylist.",
    verticals: ["doctor", "salon"],
  },
  {
    slug: "inventory",
    label: "Inventory",
    hint: "Stock check, refill requests, prescription handoff.",
    verticals: ["pharmacy"],
  },
  {
    slug: "membership",
    label: "Membership",
    hint: "Plans, day-passes, class sign-ups.",
    verticals: ["gym"],
  },
  {
    slug: "concierge",
    label: "Concierge",
    hint: "Open-ended questions: hours, location, recommendations.",
    verticals: ["restaurant", "doctor", "salon", "pharmacy", "gym"],
  },
];

const BY_SLUG: Record<AgentSlug, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.slug, a]),
) as Record<AgentSlug, AgentDef>;

export function agentsFor(vertical: Vertical): AgentDef[] {
  return AGENTS.filter((a) => a.verticals.includes(vertical));
}

export function agentBySlug(slug: AgentSlug): AgentDef {
  return BY_SLUG[slug];
}
