import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { usePlan } from "../../store/plan";
import { useT } from "../../i18n";
import { decodeRoute, encodeRoute, parseFqRoute, stopsFromGpx, toFqRoute, toGpx } from "../../features/handoff/routeCode";
import { applyPayload, currentPayload } from "../../features/handoff/apply";
import { saveFile, safeFileName } from "../../features/handoff/files";

/** Camera QR scanner (getUserMedia + jsQR). */
function Scanner({ onCode, onClose }: { onCode: (s: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (v.readyState < 2) return;
          canvas.width = v.videoWidth; canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data.includes("FQR")) { cancelAnimationFrame(raf); onCode(code.data); }
        };
        tick();
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [onCode]);
  return (
    <div className="space-y-2">
      <video ref={video} playsInline muted className="aspect-square w-full bg-black object-cover" />
      {err && <div className="text-[12px] text-fq-danger">{t("handoff.cameraError")} ({err})</div>}
      <button onClick={onClose} className="fq-btn h-10 w-full text-[12px]">{t("venue.cancel")}</button>
    </div>
  );
}

export function HandoffPanel() {
  const t = useT();
  const { stops, routes, selected } = usePlan();
  const [qr, setQr] = useState<{ img: string; chars: number } | null>(null);
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const canExport = stops.length >= 2;
  const name = () => safeFileName(stops[stops.length - 1]?.name ?? "route");

  const showQr = async () => {
    const code = await encodeRoute(currentPayload());
    const img = await QRCode.toDataURL(code, { errorCorrectionLevel: "M", margin: 2, width: 512, color: { dark: "#040404", light: "#ffffff" } });
    setQr({ img, chars: code.length });
  };

  const received = async (text: string) => {
    setScan(false);
    try { applyPayload(await decodeRoute(text)); setMsg(t("handoff.loaded")); }
    catch (e) { setMsg(`${t("handoff.badCode")} (${(e as Error).message})`); }
  };

  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      if (/\.gpx$/i.test(f.name) || text.trimStart().startsWith("<")) {
        const { stops: s, simplified } = stopsFromGpx(text);
        applyPayload({ v: 1, stops: s, o: 0 });
        setMsg(simplified ? t("handoff.gpxSimplified") : t("handoff.loaded"));
      } else {
        applyPayload(parseFqRoute(text).plan);
        setMsg(t("handoff.loaded"));
      }
    } catch (e) { setMsg(`${t("handoff.badFile")} (${(e as Error).message})`); }
  };

  const shape = routes[selected]?.shape;
  const res = (r: string) => setMsg(r === "failed" ? t("share.failed") : null);

  return (
    <div className="space-y-2 border-t border-fq-line pt-3">
      <div className="text-[11px] uppercase tracking-widest text-fq-muted">{t("handoff.title")}</div>
      <div className="grid grid-cols-2 gap-2">
        <button disabled={!canExport} onClick={showQr} className="fq-btn h-10 text-[12px] disabled:opacity-40">{t("handoff.showQr")}</button>
        <button onClick={() => { setQr(null); setScan(true); }} className="fq-btn h-10 text-[12px]">{t("handoff.scanQr")}</button>
        <button disabled={!canExport} onClick={async () => res(await saveFile(`${name()}.fqroute`, toFqRoute(currentPayload(), shape), "application/json"))}
          className="fq-btn h-10 text-[12px] disabled:opacity-40">.fqroute</button>
        <button disabled={!canExport} onClick={async () => res(await saveFile(`${name()}.gpx`, toGpx(currentPayload(), shape, stops.map((s) => s.name).join(" → ")), "application/gpx+xml"))}
          className="fq-btn h-10 text-[12px] disabled:opacity-40">.gpx</button>
        <button onClick={() => file.current?.click()} className="fq-btn col-span-2 h-10 text-[12px]">{t("handoff.import")}</button>
      </div>
      <input ref={file} type="file" accept=".fqroute,.gpx,application/json,application/gpx+xml" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
      {qr && (
        <div className="space-y-1 bg-white p-3 text-center">
          <img src={qr.img} alt="Route QR" className="mx-auto w-full max-w-64" />
          <div className="text-[11px] text-[#040404]">{t("handoff.qrHint")}</div>
          <button onClick={() => setQr(null)} className="h-9 text-[12px] text-[#555]">{t("gig.done")}</button>
        </div>
      )}
      {scan && <Scanner onCode={received} onClose={() => setScan(false)} />}
      {msg && <div className="text-[11px] text-fq-muted">{msg}</div>}
    </div>
  );
}
