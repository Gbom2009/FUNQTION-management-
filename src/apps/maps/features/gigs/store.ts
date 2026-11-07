import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";
import type { Place } from "../../nav/geocode";

export interface Pin { lat: number; lon: number }

export interface Venue {
  id: string;
  name: string;
  /** public address (search result) */
  address?: Place;
  /** where the gear goes in — the route goes here when set */
  loadInDoor?: Pin;
  trailerParking?: Pin;
  contactName?: string;
  contactPhone?: string;
  notes?: string;
  /** small JPEG data URLs (resized on import) */
  photos: string[];
}

export interface Gig {
  id: string;
  title: string;
  venueId?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  loadIn: string;
  setupBufferMin: number;
  trafficMarginPct: number;
  notes?: string;
  /** last computed drive time to the venue, with the profile at that time */
  route?: { seconds: number; meters: number; fromName: string; towing: boolean; computedAt: number };
}

export type PinField = "loadInDoor" | "trailerParking";

interface GigState {
  venues: Venue[];
  gigs: Gig[];
  /** map pin-picking: the next map tap sets this venue field */
  picking: { venueId: string; field: PinField } | null;
  /** venue whose pins are shown on the map (open in the editor) */
  focusVenueId: string | null;
  setFocusVenue: (id: string | null) => void;

  addVenue: (v?: Partial<Venue>) => string;
  updateVenue: (id: string, p: Partial<Venue>) => void;
  removeVenue: (id: string) => void;
  addGig: (g?: Partial<Gig>) => string;
  updateGig: (id: string, p: Partial<Gig>) => void;
  removeGig: (id: string) => void;
  startPicking: (venueId: string, field: PinField) => void;
  finishPicking: (pin: Pin | null) => void;
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const useGigs = create<GigState>()(
  persist(
    (set, get) => ({
      venues: [],
      gigs: [],
      picking: null,
      focusVenueId: null,
      setFocusVenue: (focusVenueId) => set({ focusVenueId }),

      addVenue: (v) => {
        const id = uid("venue");
        set({ venues: [...get().venues, { id, name: v?.name ?? "Nieuwe venue", photos: [], ...v }] });
        return id;
      },
      updateVenue: (id, p) => set({ venues: get().venues.map((v) => (v.id === id ? { ...v, ...p } : v)) }),
      removeVenue: (id) => set({
        venues: get().venues.filter((v) => v.id !== id),
        gigs: get().gigs.map((g) => (g.venueId === id ? { ...g, venueId: undefined } : g)),
      }),
      addGig: (g) => {
        const id = uid("gig");
        set({ gigs: [...get().gigs, { id, title: "Gig", date: todayIso(), loadIn: "18:00", setupBufferMin: 60, trafficMarginPct: 15, ...g }] });
        return id;
      },
      updateGig: (id, p) => set({ gigs: get().gigs.map((g) => (g.id === id ? { ...g, ...p } : g)) }),
      removeGig: (id) => set({ gigs: get().gigs.filter((g) => g.id !== id) }),
      startPicking: (venueId, field) => set({ picking: { venueId, field } }),
      finishPicking: (pin) => {
        const p = get().picking;
        if (p && pin) get().updateVenue(p.venueId, { [p.field]: pin });
        set({ picking: null });
      },
    }),
    { name: "fq-gigs", storage: lazyStorage, partialize: ({ venues, gigs }) => ({ venues, gigs }) },
  ),
);

/** Where to route to for a venue: load-in door if set, else the address. */
export function venueTarget(v: Venue): Pin | undefined {
  return v.loadInDoor ?? (v.address ? { lat: v.address.lat, lon: v.address.lon } : undefined);
}
