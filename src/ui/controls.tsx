import type { ReactNode } from 'react';

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: { id: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg${small ? ' seg-sm' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? 'on' : ''} aria-pressed={o.id === value} title={o.title} disabled={o.disabled} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button type="button" className={`switch${checked ? ' on' : ''}`} role="switch" aria-checked={checked} aria-label={label} title={title ?? label} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {hint && <div className="row-hint">{hint}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}
