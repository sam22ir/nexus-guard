// Nexus UI kit: thin, themed building blocks on top of HeroUI v3.
// HeroUI supplies Button (and later Modal/Tooltip/Switch); the rest are
// token-driven primitives so both themes stay correct by construction.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type Tone = "neutral" | "success" | "danger" | "warning" | "info" | "violet";

export function Badge({ tone = "neutral", dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className="nx-badge" data-tone={tone}>
      {dot && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Card({ children, flush = false, className = "" }: { children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`nx-card${flush ? " nx-card-flush" : ""} ${className}`.trim()}>{children}</section>;
}

export function CardHead({ eyebrow, title, action, padded = false }: { eyebrow?: string; title?: string; action?: ReactNode; padded?: boolean }) {
  return (
    <div className="nx-card-head" style={padded ? { padding: "16px 20px 0" } : undefined}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && <span className="nx-eyebrow">{eyebrow}</span>}
        {title && <h2 className="nx-card-title">{title}</h2>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="nx-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="nx-stats">{children}</div>;
}

export type StepState = "done" | "failed" | "skipped" | "pending";

/** One line of a list: status check, icon tile, title/subtitle, trailing slot. */
export function StepRow({
  state,
  icon,
  tone,
  title,
  sub,
  trailing,
  active,
  onPress,
}: {
  state?: StepState;
  icon?: IconName;
  tone?: Tone | "ink";
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  active?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      {state && (
        <span className="nx-check" data-state={state} aria-label={state}>
          {state === "done" && <Icon name="check" size={13} />}
          {state === "failed" && <Icon name="x" size={13} />}
        </span>
      )}
      {icon && (
        <span className="nx-tile" data-tone={tone}>
          <Icon name={icon} size={17} />
        </span>
      )}
      <span className="nx-row-body">
        <span className="nx-row-title">{title}</span>
        {sub && <span className="nx-row-sub">{sub}</span>}
      </span>
      {trailing}
    </>
  );
  return onPress ? (
    <button type="button" className="nx-row" data-active={active} onClick={onPress}>{body}</button>
  ) : (
    <div className="nx-row" data-active={active}>{body}</div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="nx-seg" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="nx-empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children, onDismiss }: { tone?: Tone; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="nx-notice" role="status">
      <span className="nx-badge mt-0.5" data-tone={tone} style={{ padding: 0, width: 8, height: 8, flexShrink: 0 }} aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="nx-muted" style={{ background: "none", border: 0, cursor: "pointer", lineHeight: 1 }}>
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}
