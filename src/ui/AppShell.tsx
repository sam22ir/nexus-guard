// App frame: icon rail (icon over label) + header (back, crumbs, title, status,
// actions) + scrolling main. Only the main region scrolls, never the page (paper §8).
import type { ReactNode } from "react";
import { Button } from "@heroui/react";
import { Icon, type IconName } from "./icons";

export type NavItem<Id extends string = string> = { id: Id; label: string; icon: IconName };

export function AppShell<Id extends string>({
  nav,
  active,
  onNavigate,
  railFooter,
  crumbs,
  title,
  status,
  actions,
  onBack,
  banner,
  fill = false,
  children,
}: {
  nav: NavItem<Id>[];
  active: Id;
  onNavigate: (id: Id) => void;
  railFooter?: ReactNode;
  crumbs: string[];
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  banner?: ReactNode;
  /** Fit the page to the viewport; only inner regions scroll (paper §8). */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="nx-app">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-(--text) focus:px-3 focus:py-2 focus:text-[13px] focus:text-(--canvas)">
        Skip to content
      </a>
      <aside className="nx-rail" aria-label="Primary">
        <button type="button" className="nx-brand" onClick={() => onNavigate(nav[0].id)} aria-label="Nexus Guard home">
          <img src="/nexus-symbol.png" alt="" />
        </button>
        <nav className="nx-nav" aria-label="Workspace">
          {nav.map((item) => (
            <button key={item.id} type="button" className="nx-nav-item" aria-current={item.id === active ? "page" : undefined} onClick={() => onNavigate(item.id)}>
              <Icon name={item.icon} size={20} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="nx-rail-spacer" />
        {railFooter}
      </aside>

      <div className="nx-column">
        <header className="nx-header">
          {onBack && (
            <Button isIconOnly variant="outline" size="sm" aria-label="Back" onPress={onBack}>
              <Icon name="back" size={16} />
            </Button>
          )}
          <div className="nx-header-titles">
            <nav className="nx-crumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="flex items-center gap-2">
                  <span>{crumb}</span>
                  <span aria-hidden="true">/</span>
                </span>
              ))}
            </nav>
            <h1 className="nx-title" style={{ margin: 0, fontFamily: "var(--font-sans)" }}>
              {title}
              {status}
            </h1>
          </div>
          {actions && <div className="nx-actions">{actions}</div>}
        </header>
        <main id="main" className="nx-main" data-fill={fill || undefined}>
          <div className="nx-page" data-fill={fill || undefined}>
            {banner}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
