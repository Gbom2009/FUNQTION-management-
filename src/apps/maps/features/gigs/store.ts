import { create } from "zustand";
import type { Place } from "../../nav/geocode";
import { save, uid } from "../../../../core/repo";
import type { Venue as SuiteVenue } from "../../../../core/types";
import { gigChanges, gigDayId, venueChanges } from "../shared/mapping";
import { queueWrite } from "../shared/writer";
import { suiteVenue, syncPhotos } from "../shared/sync";

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
  /** photo URLs (suite venuePhotos); new ones arrive as small JPEG data URLs */
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
  /** Suite venues (App 1) as Maps venues. Filled by features/shared/sync.ts. */
  venues: Venue[];
  /** Suite gigs (App 1 + Gig Day) as Maps gigs. Created and renamed in Bookings, not here. */
  gigs: Gig[];
  /** true once the shared database has been read since Maps opened */
  loaded: boolean;
  /** map pin-picking: the next map tap sets this venue field */
  picking: { venueId: string; field: PinField } | null;
  /** venue whose pins are shown on the map (open in the editor) */
  focusVenueId: string | null;
  setFocusVenue: (id: string | null) => void;

  addVenue: (v?: Partial<Venue>) => string;
  updateVenue: (id: string, p: Partial<Venue>) => void;
  /** load-in time, set-up buffer, traffic margin and the computed route */
  updateGig: (id: string, p: Partial<Gig>) => void;
  startPicking: (venueId: string, field: PinField) => void;
  finishPicking: (pin: Pin | null) => void;
}

// Gigs and venues are the suite's (one source, entered once). Device-only
// state (picking, focus) stays here; every edit goes to the shared database.
export const useGigs = create<GigState>()((set, get) => ({
  venues: [],
  gigs: [],
  loaded: false,
  picking: null,
  focusVenueId: null,
  setFocusVenue: (focusVenueId) => set({ focusVenueId }),

  addVenue: (v) => {
    const id = uid();
    const venue: Venue = { id, name: v?.name ?? "Nieuwe venue", photos: [], ...v };
    set({ venues: [...get().venues, venue] });
    void save<SuiteVenue>("venues", { id, name: venue.name, ...venueChanges(v ?? {}) });
    return id;
  },
  updateVenue: (id, p) => {
    const before = get().venues.find((v) => v.id === id);
    set({ venues: get().venues.map((v) => (v.id === id ? { ...v, ...p } : v)) });
    if (p.photos && before) void syncPhotos(id, before.photos, p.photos);
    const { photos: _p, ...rest } = p;
    const changes = venueChanges(rest, suiteVenue(id));
    if (Object.keys(changes).length) queueWrite("venues", id, changes);
  },
  updateGig: (id, p) => {
    set({ gigs: get().gigs.map((g) => (g.id === id ? { ...g, ...p } : g)) });
    const { gig, day } = gigChanges(p);
    if (Object.keys(gig).length) queueWrite("gigs", id, gig);
    if (Object.keys(day).length) queueWrite("gigDays", gigDayId(id), day, { gigId: id });
  },
  startPicking: (venueId, field) => set({ picking: { venueId, field } }),
  finishPicking: (pin) => {
    const p = get().picking;
    if (p && pin) get().updateVenue(p.venueId, { [p.field]: pin });
    set({ picking: null });
  },
}));

/** Where to route to for a venue: load-in door if set, else the address. */
export function venueTarget(v: Venue): Pin | undefined {
  return v.loadInDoor ?? (v.address ? { lat: v.address.lat, lon: v.address.lon } : undefined);
}
