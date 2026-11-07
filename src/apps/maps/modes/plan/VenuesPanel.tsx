import { useEffect, useRef, useState } from "react";
import { useGigs, type Venue, type PinField } from "../../features/gigs/store";
import { SearchBox } from "./SearchBox";
import { useT } from "../../i18n";

const field = "fq-input";
const label = "fq-label";
const MAX_PHOTOS = 4;

/** Downscale a photo to ≤ 900 px JPEG so venue cards stay small in storage. */
async function resizePhoto(file: File, max = 900): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

function VenueEditor({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  const t = useT();
  const { updateVenue, removeVenue, startPicking, picking } = useGigs();
  const file = useRef<HTMLInputElement>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const up = (p: Partial<Venue>) => updateVenue(venue.id, p);

  const pinRow = (f: PinField, name: string, badge: string) => {
    const pin = venue[f];
    const active = picking?.venueId === venue.id && picking.field === f;
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fq-primary text-[11px] text-[#040404]">{badge}</span>
        <div className="min-w-0 flex-1 text-[12px]">
          <div className="text-fq-strong">{name}</div>
          <div className="text-[11px] text-fq-muted">{pin ? `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` : t("venue.notSet")}</div>
        </div>
        <button onClick={() => startPicking(venue.id, f)} aria-pressed={active} className="fq-btn h-9 px-2 text-[11px]">
          {active ? t("venue.tapMap") : t("venue.pick")}
        </button>
        {pin && <button onClick={() => up({ [f]: undefined })} className="h-9 w-7 text-fq-muted hover:text-fq-danger" aria-label="clear">×</button>}
      </div>
    );
  };

  return (
    <div className="space-y-3 border border-fq-primary p-3">
      <label><span className={label}>{t("venue.name")}</span>
        <input className={field} value={venue.name} onChange={(e) => up({ name: e.target.value })} /></label>
      <div>
        <span className={label}>{t("venue.address")}</span>
        {venue.address && <div className="mb-1 text-[12px] text-fq-strong">{venue.address.name}<span className="text-fq-muted"> · {venue.address.detail}</span></div>}
        <SearchBox placeholder={t("venue.searchAddress")} onPick={(p) => up({ address: p, name: venue.name === t("venue.new") ? p.name : venue.name })} />
      </div>
      {pinRow("loadInDoor", t("venue.loadInDoor"), "D")}
      {pinRow("trailerParking", t("venue.trailerParking"), "P")}
      <div className="grid grid-cols-2 gap-2">
        <label><span className={label}>{t("venue.contact")}</span>
          <input className={field} value={venue.contactName ?? ""} onChange={(e) => up({ contactName: e.target.value })} /></label>
        <label><span className={label}>{t("venue.phone")}</span>
          <input type="tel" className={field} value={venue.contactPhone ?? ""} onChange={(e) => up({ contactPhone: e.target.value })} /></label>
      </div>
      {venue.contactPhone && <a href={`tel:${venue.contactPhone.replace(/\s/g, "")}`} className="text-[12px] text-fq-primary">📞 {venue.contactPhone}</a>}
      <label><span className={label}>{t("venue.notes")}</span>
        <textarea rows={3} className={field} value={venue.notes ?? ""} onChange={(e) => up({ notes: e.target.value })} /></label>
      <div>
        <span className={label}>{t("venue.photos")}</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {venue.photos.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="h-20 w-20 object-cover" />
              <button onClick={() => up({ photos: venue.photos.filter((_, j) => j !== i) })}
                className="absolute right-0 top-0 h-6 w-6 bg-[#040404]/80 text-[#f0f0f0]" aria-label="remove">×</button>
            </div>
          ))}
          {venue.photos.length < MAX_PHOTOS && (
            <button onClick={() => file.current?.click()} className="h-20 w-20 border border-dashed border-fq-line text-2xl text-fq-muted">+</button>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - venue.photos.length);
          e.target.value = "";
          try {
            const added = await Promise.all(files.map((f) => resizePhoto(f)));
            useGigs.getState().updateVenue(venue.id, { photos: [...venue.photos, ...added] });
            setPhotoMsg(null);
          } catch (err) { setPhotoMsg(String(err)); }
        }} />
        {photoMsg && <div className="text-[11px] text-fq-danger">{photoMsg}</div>}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="fq-btn h-10 flex-1 text-[12px]">{t("gig.done")}</button>
        <button onClick={() => { removeVenue(venue.id); onClose(); }} className="h-10 px-3 text-[12px] text-fq-muted hover:text-fq-danger">{t("venue.delete")}</button>
      </div>
    </div>
  );
}

export function VenuesPanel() {
  const t = useT();
  const { venues, addVenue, setFocusVenue, focusVenueId, finishPicking } = useGigs();
  const [open, setOpen] = useState<string | null>(focusVenueId);
  useEffect(() => { setFocusVenue(open); if (!open) finishPicking(null); }, [open, setFocusVenue, finishPicking]);
  useEffect(() => () => { setFocusVenue(null); finishPicking(null); }, [setFocusVenue, finishPicking]);

  return (
    <div className="space-y-2">
      {venues.map((v) => open === v.id ? (
        <VenueEditor key={v.id} venue={v} onClose={() => setOpen(null)} />
      ) : (
        <button key={v.id} onClick={() => setOpen(v.id)} className="flex w-full items-center gap-3 fq-card p-3 text-left hover:border-fq-muted">
          {v.photos[0] ? <img src={v.photos[0]} alt="" className="h-12 w-12 object-cover" /> : <span className="h-12 w-12 shrink-0 bg-fq-surface" />}
          <div className="min-w-0">
            <div className="truncate text-sm text-fq-strong">{v.name}</div>
            <div className="truncate text-[11px] text-fq-muted">
              {v.address?.detail ?? v.address?.name ?? t("venue.noAddress")}
              {v.loadInDoor ? ` · ${t("venue.door")} ✓` : ""}{v.trailerParking ? ` · P ✓` : ""}
            </div>
          </div>
        </button>
      ))}
      {!venues.length && <p className="text-[13px] text-fq-muted">{t("venue.empty")}</p>}
      <button onClick={() => setOpen(addVenue({ name: t("venue.new") }))} className="fq-btn h-12 w-full text-sm">+ {t("venue.add")}</button>
    </div>
  );
}
