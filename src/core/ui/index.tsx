import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { MemberId, Stage } from '../types';
import { useI18n } from '../i18n';

const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

export function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src={logoUrl} width={size} height={size} alt="Team Funqtion" />;
}

const paths: Record<string, string> = {
  today: 'M3 12h4l3-8 4 16 3-8h4',
  enquiries: 'M4 4h16v12H7l-3 3z',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  contacts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  tasks: 'M5 12l4 4 10-10',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 8 7 7 5 11l2 1v0l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4z',
  hub: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  phone: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  nav: 'M3 11l18-8-8 18-2-8z',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10',
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" aria-hidden="true">
      <path d={paths[name] ?? paths.more} />
    </svg>
  );
}

export function StagePill({ stage }: { stage: Stage }) {
  const { t } = useI18n();
  return <span className={`pill st-${stage}`} style={{ color: `var(--st-${stage})` }}>{t(`stage.${stage}`)}</span>;
}

export function MemberChips({ ids }: { ids: (MemberId | 'both')[] }) {
  const list = ids.flatMap((i) => (i === 'both' ? (['gijs', 'coen'] as MemberId[]) : [i]));
  if (!list.length) return null;
  return (
    <span className="row" style={{ gap: 4 }}>
      {list.map((m) => <span key={m} className={`member ${m}`} title={m === 'gijs' ? 'Gijs' : 'Coen'}>{m === 'gijs' ? 'G' : 'C'}</span>)}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted tiny">{hint}</small>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} />;
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} />;

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Chips<T extends string>({ options, value, onChange, label, multi }: {
  options: { value: T; label: string }[]; value: T | T[]; onChange: (v: T) => void; label?: string; multi?: boolean;
}) {
  const sel = (v: T) => (multi ? (value as T[]).includes(v) : value === v);
  return (
    <div className="field" role="group" aria-label={label}>
      {label && <span>{label}</span>}
      <div className="chips">
        {options.map((o) => (
          <button type="button" key={o.value} className="chip" aria-pressed={sel(o.value)} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 'var(--s4)' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="stack">{children}</div>
        {footer && <div className="row end" style={{ marginTop: 'var(--s5)' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Section({ title, actions, children, id }: { title?: string; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 'var(--s3)' }}>
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Eq() {
  return <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>;
}
