import { useEffect, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { Icon as NxIcon } from "../ui";

export function StatusDot({ tone = "green" }: { tone?: string }) {
  const color = tone === "green" ? "var(--green)" : tone === "orange" || tone === "yellow" ? "var(--orange)" : tone === "red" ? "var(--red)" : tone === "blue" ? "var(--blue)" : "var(--muted)";
  return <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 9999, background: color, flexShrink: 0 }} />;
}

/** The shell header already names the screen; this row only carries the
 *  screen's one-line explanation and its primary actions. */
export function PageTitle({ description, action }: { eyebrow?: string; title?: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <p className="max-w-[72ch] text-[13px] leading-[1.6] text-(--muted)">{description}</p>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Card({ children, flush = false, className = "" }: { children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`nx-card${flush ? " nx-card-flush" : ""} ${className}`}>{children}</section>;
}

export function CardHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="nx-card-head shrink-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="nx-eyebrow">{eyebrow}</span>
        <h2 className="nx-card-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-start gap-2.5 rounded-[12px] bg-(--raised) p-3 text-[12px] leading-[1.6] text-(--muted)">
      <span className="mt-0.5 text-(--muted)"><NxIcon name="shield" size={15} /></span>
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

export function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--backdrop, rgb(0 0 0 / 0.5))" }} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[18px] border border-(--line) bg-(--panel) p-6"
        style={{ boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-(--text)">{title}</h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-(--muted)">{description}</p>
          </div>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Close" onPress={onClose}><NxIcon name="x" size={16} /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}
