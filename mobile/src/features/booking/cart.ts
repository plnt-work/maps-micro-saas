// Booking cart — single global cart (one venue at a time). Persisted
// to AsyncStorage via zustand's persist middleware so a navigation
// away mid-flow recovers the user's selections.
//
// Switching to a different venue (setPlace with a different placeId)
// hard-resets services / pro / slot — the cart is per-venue.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ServiceRef {
  id: string;
  name: string;
  duration_min: number;
  price_cents: number;
}

export type ProSelection = string | "no-preference";

interface CartState {
  placeId: string | null;
  services: ServiceRef[];
  proId: ProSelection | null;
  /** ISO "HH:mm" slot on the picked date. */
  slot: string | null;
  /** ISO "YYYY-MM-DD" date for the slot. */
  date: string | null;

  setPlace(placeId: string): void;
  addService(s: ServiceRef): void;
  removeService(id: string): void;
  toggleService(s: ServiceRef): void;
  setPro(id: ProSelection): void;
  setSlot(date: string, slot: string): void;
  reset(): void;
}

const initial: Omit<CartState, "setPlace" | "addService" | "removeService" | "toggleService" | "setPro" | "setSlot" | "reset"> = {
  placeId: null,
  services: [],
  proId: null,
  slot: null,
  date: null,
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...initial,
      setPlace(placeId) {
        const cur = get();
        if (cur.placeId === placeId) return;
        // Different venue → wipe everything else so a stale slot can't
        // bleed across venues.
        set({ ...initial, placeId });
      },
      addService(s) {
        const services = get().services;
        if (services.some((x) => x.id === s.id)) return;
        set({ services: [...services, s] });
      },
      removeService(id) {
        set({ services: get().services.filter((s) => s.id !== id) });
      },
      toggleService(s) {
        const services = get().services;
        if (services.some((x) => x.id === s.id)) {
          set({ services: services.filter((x) => x.id !== s.id) });
        } else {
          set({ services: [...services, s] });
        }
      },
      setPro(id) {
        set({ proId: id });
      },
      setSlot(date, slot) {
        set({ date, slot });
      },
      reset() {
        set({ ...initial });
      },
    }),
    {
      name: "plnt.cart",
      storage: createJSONStorage(() => AsyncStorage),
      // Drop hooks from persisted snapshot.
      partialize: (s) => ({
        placeId: s.placeId,
        services: s.services,
        proId: s.proId,
        slot: s.slot,
        date: s.date,
      }),
    },
  ),
);

/** Derived total in cents — kept as a selector so the persisted snapshot
 *  isn't bloated with a redundant field. */
export function totalCents(s: { services: ServiceRef[] }): number {
  return s.services.reduce((acc, x) => acc + x.price_cents, 0);
}

/** Derived total duration in minutes. */
export function totalMinutes(s: { services: ServiceRef[] }): number {
  return s.services.reduce((acc, x) => acc + x.duration_min, 0);
}

/** State machine: which step can we advance to from `current`? */
export type BookingStep = "services" | "professional" | "time" | "confirm";

export function canAdvanceFrom(
  step: BookingStep,
  s: { services: ServiceRef[]; proId: ProSelection | null; slot: string | null },
): boolean {
  switch (step) {
    case "services":
      return s.services.length > 0;
    case "professional":
      return s.proId !== null;
    case "time":
      return s.slot !== null;
    case "confirm":
      return s.services.length > 0 && s.proId !== null && s.slot !== null;
  }
}
