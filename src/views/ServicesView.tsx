import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDER_CATALOG, remoteServiceUrl, tierForProvider, type Account, type CustomService, type Project } from "../store";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon, type Tone } from "../ui";
import { inputClass, selectClass } from "../app/styles";
import { Card, CardHeading } from "../app/common";
import { AddCustomServiceModal } from "../modals/AddCustomServiceModal";

type Service = { provider: string; tier: string; tags: string[] };
type TierFilter = "all" | "native" | "linked";

const tierTone = (tier: string): Tone => (tier === "native" ? "success" : tier === "curated" ? "info" : "warning");

function howReached(tier: string, signedInTo: string | null, custom: boolean): string {
  if (tier === "native") return "Native adapter: every operation is reviewed. Reads are allowed, and writes stay blocked until you allow them.";
  if (signedInTo) {
    return `${custom ? "Added by you and not reviewed by Nexus. " : ""}Nexus signs in to ${signedInTo} and runs only the tools the service labels read-only. Safe changes need you to switch on "Allow safe writes" for a binding; anything destructive or unlabelled is refused.`;
  }
  if (tier === "curated") return "Reached through generic MCP forwarding. Operations aren't individually reviewed, so every call stays fail-closed until you allow it.";
  return "Added by you and not reviewed by Nexus. Every call stays fail-closed until you reclassify it.";
}

/** Service catalog plus the accounts linked to each service. Linking happens
 *  inline in the detail panel; only "a service not in Nexus" uses a dialog. */
export function ServicesView({ projects, accounts, customServices, onAddCustomService, onRemoveCustomService, onAddAccount, onRemoveAccount, onOpenBindings }: {
  projects: Project[];
  accounts: Account[];
  customServices: CustomService[];
  onAddCustomService: (name: string, mcpUrl: string) => Promise<void>;
  onRemoveCustomService: (entry: CustomService) => void;
  onAddAccount: (input: { provider: string; label: string }) => void;
  onRemoveAccount: (id: string) => void;
  onOpenBindings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [customModal, setCustomModal] = useState(false);

  // Catalog entries plus any provider the developer added themselves.
  const services: Service[] = useMemo(() => {
    const known = new Set([...PROVIDER_CATALOG.map((p) => p.provider.toLowerCase()), ...customServices.map((c) => c.name.toLowerCase())]);
    const added = customServices.map((c) => ({ provider: c.name, tier: "self-added", tags: ["Custom"] }));
    const custom = [...new Set(accounts.map((a) => a.provider))].filter((name) => !known.has(name.toLowerCase())).map((name) => ({ provider: name, tier: "self-added", tags: ["Self-added"] }));
    return [...PROVIDER_CATALOG.map((p) => ({ provider: p.provider, tier: p.tier as string, tags: p.tags })), ...added, ...custom];
  }, [accounts, customServices]);

  const accountsFor = (provider: string) => accounts.filter((a) => a.provider.toLowerCase() === provider.toLowerCase());
  const usedBy = (account: Account) => projects.filter((p) => (p.connections ?? []).some((c) => (c.accountId ?? c.account) === account.id));
  const sharedCount = accounts.filter((a) => usedBy(a).length > 1).length;
  const categories = ["All", ...[...new Set(services.flatMap((s) => s.tags))].sort()];

  const q = query.trim().toLowerCase();
  const visible = services.filter((s) =>
    (category === "All" || s.tags.includes(category)) &&
    (tierFilter === "all" || (tierFilter === "native" ? s.tier === "native" : accountsFor(s.provider).length > 0)) &&
    (!q || [s.provider, s.tier, ...s.tags].some((f) => f.toLowerCase().includes(q))));
  const current = services.find((s) => s.provider === selected) ?? visible[0] ?? services[0];

  return (
    <div className="app-view flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] text-(--muted)">
          <strong className="font-medium text-(--text)">{services.length}</strong> services · <strong className="font-medium text-(--text)">{accounts.length}</strong> account{accounts.length === 1 ? "" : "s"} linked · <strong className="font-medium text-(--text)">{sharedCount}</strong> shared across projects
        </p>
        <Button size="sm" variant="outline" onPress={() => setCustomModal(true)}><NxIcon name="plus" size={15} />Add a service not in Nexus</Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]" style={{ minHeight: 320 }}>
        <Card flush className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-4">
            <label className="flex items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
              <NxIcon name="search" size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search services" placeholder={`Search ${services.length} services`} className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={`${selectClass} !h-8 !w-auto !text-[12px]`}>
                {categories.map((name) => <option key={name} value={name}>{name === "All" ? "Category: all" : name}</option>)}
              </select>
              <div className="nx-seg" role="tablist" aria-label="Show">
                {([["all", "All"], ["native", "Native"], ["linked", "Linked"]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={tierFilter === value} onClick={() => setTierFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Services">
            {visible.map((service) => {
              const linked = accountsFor(service.provider).length;
              return (
                <button key={service.provider} type="button" role="option" aria-selected={current?.provider === service.provider} className="nx-row" data-active={current?.provider === service.provider} style={{ borderTop: "1px solid var(--line-soft)" }} onClick={() => setSelected(service.provider)}>
                  <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{service.provider.slice(0, 2).toUpperCase()}</span>
                  <span className="nx-row-body">
                    <span className="nx-row-title">{service.provider}</span>
                    <span className="nx-row-sub">{service.tags.join(" · ")}</span>
                  </span>
                  {linked > 0 && <span className="text-[11.5px] text-(--muted)">{linked} linked</span>}
                  <Badge tone={tierTone(service.tier)}>{service.tier}</Badge>
                </button>
              );
            })}
            {visible.length === 0 && <Empty title="No services match">Try a different word, category or filter.</Empty>}
          </div>
        </Card>

        {current && (
          <ServiceDetail
            key={current.provider}
            service={current}
            accounts={accountsFor(current.provider)}
            usedBy={usedBy}
            projects={projects}
            onAddAccount={onAddAccount}
            onRemoveAccount={onRemoveAccount}
            onOpenBindings={onOpenBindings}
            customEntry={customServices.find((c) => c.name.toLowerCase() === current.provider.toLowerCase()) ?? null}
            onRemoveCustomService={onRemoveCustomService}
          />
        )}
      </div>

      {customModal && <AddCustomServiceModal onClose={() => setCustomModal(false)} onSave={async (name, mcpUrl) => { await onAddCustomService(name, mcpUrl); setCustomModal(false); setSelected(name); }} />}
    </div>
  );
}

function ServiceDetail({ service, accounts, usedBy, projects, onAddAccount, onRemoveAccount, onOpenBindings, customEntry, onRemoveCustomService }: {
  customEntry: CustomService | null;
  onRemoveCustomService: (entry: CustomService) => void;
  service: Service;
  accounts: Account[];
  usedBy: (account: Account) => Project[];
  projects: Project[];
  onAddAccount: (input: { provider: string; label: string }) => void;
  onRemoveAccount: (id: string) => void;
  onOpenBindings: () => void;
}) {
  const [linking, setLinking] = useState(false);
  const [label, setLabel] = useState("personal");
  const labelRef = useRef<HTMLInputElement>(null);
  const tier = tierForProvider(service.provider);
  useEffect(() => { if (linking) labelRef.current?.focus(); }, [linking]);

  const bindings = projects.flatMap((project) => (project.connections ?? [])
    .filter((c) => c.provider.toLowerCase() === service.provider.toLowerCase())
    .map((c) => ({ project, connection: c })));
  const shared = accounts.filter((a) => usedBy(a).length > 1);

  function link() {
    const trimmed = label.trim() || "personal";
    onAddAccount({ provider: service.provider, label: trimmed });
    setLinking(false);
    setLabel("personal");
  }

  return (
    <Card flush className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pt-4">
        <span className="nx-tile text-[12px] font-semibold" style={{ width: 38, height: 38 }} aria-hidden="true">{service.provider.slice(0, 2).toUpperCase()}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="text-[15px] font-semibold text-(--text)">{service.provider}</strong>
          <span className="truncate text-[12px] text-(--muted)">{service.tags.join(" · ")}</span>
        </span>
        <Badge tone={tierTone(tier)}>{tier}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
        <p className="text-[12.5px] leading-[1.6] text-(--muted)">{howReached(tier, remoteServiceUrl(service.provider) ? service.provider : null, !!customEntry)}</p>
        {customEntry && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] bg-(--raised) px-3 py-2 text-[12px] text-(--muted)">
            <span className="nx-mono min-w-0 flex-1 break-all text-(--text)">{customEntry.mcp_url}</span>
            <Button size="sm" variant="danger-soft" onPress={() => onRemoveCustomService(customEntry)}>Remove service</Button>
          </div>
        )}

        <div className="mt-4">
          <CardHeading
            eyebrow="Linked accounts"
            title={accounts.length === 0 ? "None yet" : `${accounts.length} linked`}
            action={!linking ? <Button size="sm" onPress={() => setLinking(true)}><NxIcon name="plus" size={15} />Link account</Button> : undefined}
          />
          {linking && (
            <form className="mb-3 flex flex-wrap items-end gap-2 rounded-[12px] bg-(--raised) p-3" onSubmit={(event) => { event.preventDefault(); link(); }}>
              <label className="nx-field min-w-[200px] flex-1">
                Account label
                <input ref={labelRef} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="personal" />
              </label>
              <Button type="submit" size="sm">Link account</Button>
              <Button size="sm" variant="outline" onPress={() => setLinking(false)}>Cancel</Button>
              {tier === "self-added" && <p className="w-full text-[11.5px] leading-[1.5] text-(--muted)">Nexus has not reviewed this service. Calls stay fail-closed until you bind it and allow them.</p>}
            </form>
          )}
          {accounts.length === 0 && !linking ? (
            <p className="rounded-[12px] border border-dashed border-(--line) px-4 py-5 text-center text-[12.5px] text-(--muted)">Link a {service.provider} account once, then bind it to projects from the Project page.</p>
          ) : (
            <div className="rounded-[12px] border border-(--line)">
              {accounts.map((account, index) => {
                const projectsUsing = usedBy(account);
                return (
                  <div key={account.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" style={index > 0 ? { borderTop: "1px solid var(--line-soft)" } : undefined}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] font-medium text-(--text)">{account.label}</span>
                      <span className="nx-mono truncate text-(--muted)" title={account.id}>{account.id}</span>
                    </span>
                    {projectsUsing.length > 1 && <Badge tone="warning">Shared by {projectsUsing.length}</Badge>}
                    <Button size="sm" variant="danger-soft" onPress={() => onRemoveAccount(account.id)}>Remove</Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {bindings.length > 0 && (
          <div className="mt-4">
            <span className="nx-eyebrow">Used by</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bindings.map(({ project, connection }) => (
                <span key={connection.id} className="nx-badge !px-3 !py-1.5 text-[12px]">{project.name} · <span className="nx-mono">{connection.resource ?? connection.target}</span></span>
              ))}
            </div>
          </div>
        )}

        {shared.length > 0 && (
          <div className="mt-4 rounded-[12px] bg-(--orange-bg) px-4 py-3 text-[12.5px] leading-[1.55] text-(--orange)">
            {shared.map((account) => `${account.label} is bound by ${usedBy(account).map((p) => p.name).join(" and ")}.`).join(" ")} One credential reaches all of them.
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-(--line-soft) px-5 py-3">
        <span className="min-w-0 flex-1 text-[12px] text-(--muted)">Next: bind an account and resource per project from the Project page.</span>
        <Button size="sm" variant="outline" onPress={onOpenBindings}>Open project bindings</Button>
      </div>
    </Card>
  );
}
