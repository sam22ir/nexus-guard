import { useState } from "react";
import { tierForProvider, PROVIDER_CATALOG, type Account, type Project } from "../store";
import { detectBlastRadius } from "../accounts";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon, type Tone } from "../ui";
import { PageTitle, Card, CardHeading } from "../app/common";
import { AddAccountModal } from "../modals/AddAccountModal";

export function ServicesView({ projects, accounts, onAddAccount, onRemoveAccount }: { projects: Project[]; accounts: Account[]; onAddAccount: (input: { provider: string; label: string }) => void; onRemoveAccount: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [accountModal, setAccountModal] = useState(false);
  const blastRadius = detectBlastRadius(projects, accounts);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const q = query.trim().toLowerCase();
  const categories = ["All", ...[...new Set(PROVIDER_CATALOG.flatMap((p) => p.tags))].sort()];
  const visibleAccounts = accounts.filter((a) => !q || [a.provider, a.label, a.id, a.authState].some((f) => (f ?? "").toLowerCase().includes(q)));
  const visibleCatalog = PROVIDER_CATALOG.filter((p) => (category === "All" || p.tags.includes(category)) && (!q || [p.provider, p.tier, ...p.tags].some((f) => f.toLowerCase().includes(q))));
  const tierTone = (tier: string): Tone => (tier === "native" ? "success" : tier === "curated" ? "info" : "warning");

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description="Link provider accounts once, then bind one account and resource per project under Bindings. Unreviewed services stay fail-closed until you allow them."
        action={<Button size="sm" onPress={() => setAccountModal(true)}><NxIcon name="plus" size={15} />Link account</Button>}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
          <NxIcon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter services" placeholder="Search services…" className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          {categories.map((name) => (
            <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className="nx-badge cursor-pointer !px-3 !py-1.5 text-[12px]" data-tone={category === name ? "success" : undefined} style={category === name ? { background: "var(--text)", color: "var(--canvas)" } : undefined}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Card flush className="flex min-h-[320px] flex-col lg:max-h-[620px]">
          <div className="px-5 pt-4"><CardHeading eyebrow="Service catalog" title={`${visibleCatalog.length} known`} /></div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visibleCatalog.map((entry) => (
              <li key={entry.provider} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{entry.provider.slice(0, 2).toUpperCase()}</span>
                <span className="nx-row-body">
                  <span className="nx-row-title">{entry.provider}</span>
                  <span className="nx-row-sub">{entry.tags.join(" · ")}</span>
                </span>
                <Badge tone={tierTone(entry.tier)}>{entry.tier}</Badge>
              </li>
            ))}
            {visibleCatalog.length === 0 && <li><Empty title="No services match">Try a different word or category.</Empty></li>}
          </ul>
          <p className="shrink-0 border-t border-(--line-soft) px-5 py-3 text-[12px] leading-[1.6] text-(--muted)">Anything outside this list can be linked as self-added. Every action stays fail-closed until you reclassify it.</p>
        </Card>
        <div className="flex min-h-0 flex-col gap-4">
          <Card flush className="flex flex-col">
            <div className="px-5 pt-4"><CardHeading eyebrow="Account registry" title={`${visibleAccounts.length} account${visibleAccounts.length === 1 ? "" : "s"}`} /></div>
            {visibleAccounts.length === 0 ? (
              <Empty title="No accounts match">Link a login to bind it to projects.</Empty>
            ) : (
              <ul className="max-h-[360px] overflow-y-auto">
                {visibleAccounts.map((account) => {
                  const inUse = projects.filter((p) => (p.connections ?? []).some((c) => (c.accountId ?? c.account) === account.id)).length;
                  const tier = tierForProvider(account.provider);
                  return (
                    <li key={account.id} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{account.provider.slice(0, 2).toUpperCase()}</span>
                      <span className="nx-row-body">
                        <span className="nx-row-title">{account.provider} · {account.label}</span>
                        <span className="nx-row-sub"><span className="nx-mono" title={account.id}>{account.id}</span>{inUse > 0 ? ` · bound by ${inUse}` : ""}</span>
                      </span>
                      <Badge tone={tierTone(tier)}>{tier}</Badge>
                      <Button size="sm" variant="danger-soft" onPress={() => onRemoveAccount(account.id)}>Remove</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card flush>
            <div className="px-5 pt-4"><CardHeading eyebrow="Blast radius" title={blastRadius.length === 0 ? "No shared accounts" : `${blastRadius.length} shared account${blastRadius.length === 1 ? "" : "s"}`} /></div>
            {blastRadius.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">Each account is used by a single project. Sharing one login across projects widens what a compromised credential can reach.</p>
            ) : (
              <ul>
                {blastRadius.map((entry) => (
                  <li key={entry.accountKey} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                    <Badge tone="warning">Shared</Badge>
                    <span className="nx-row-body">
                      <span className="nx-row-title">{entry.provider} · {entry.accountLabel}</span>
                      <span className="nx-row-sub">{entry.projectIds.map(projectName).join(" · ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {accountModal && <AddAccountModal onClose={() => setAccountModal(false)} onSave={(input) => { onAddAccount(input); setAccountModal(false); }} />}
    </div>
  );
}
