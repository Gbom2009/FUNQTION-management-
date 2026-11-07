import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Segmented control: 2–4 options in one rounded pill. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="fq-card flex gap-1 p-1">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[14px] transition-colors ${value === o.v ? "bg-fq-primary text-[#040404]" : "text-fq-text"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS-style switch row: label (+ hint) left, switch right. Whole row is tappable. */
export function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-4 py-1">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-fq-strong">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-fq-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-8 w-[52px] shrink-0 rounded-full bg-fq-line transition-colors peer-checked:bg-fq-primary peer-focus-visible:outline-2 peer-focus-visible:outline-fq-primary
        after:absolute after:left-1 after:top-1 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

/** Collapsible settings section. */
export function Section({ icon, title, summary, children, defaultOpen = false }: {
  icon: ReactNode; title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fq-card overflow-hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex min-h-16 w-full items-center gap-3 px-4 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fq-bg text-fq-primary">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] text-fq-strong">{title}</span>
          {summary && <span className="block truncate text-[12px] text-fq-muted">{summary}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-fq-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-4 border-t border-fq-line px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}
