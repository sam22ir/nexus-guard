import { useState } from "react";
import { type Account, type Connection, type Project } from "../store";
import { blastRadiusWarningsFor } from "../accounts";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon } from "../ui";
import { inputClass } from "../app/styles";
import { PageTitle, Card, Note } from "../app/common";
import { ConnectionRow } from "../app/ConnectionRow";

export function BindingsView({ project, projects, accounts, onAdd, vaultUnlocked, savedKeys, onSaveKey, onRemove, onEdit, onOpenServices }: { project: Project; projects?: Project[]; accounts: Account[]; onAdd: () => void; vaultUnlocked: boolean; savedKeys: Record<string, boolean>; onSaveKey: (connection: Connection) => void; onRemove: (connection: Connection) => void; onEdit: (connection: Connection) => void; onOpenServices?: () => void }) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const visible = project.connections.filter((c) => !query || [c.provider, c.target, c.resource, c.accountId, c.account, c.environment, c.detail, c.authState, c.method].some((field) => (field ?? "").toLowerCase().includes(query)));
  const unlinked = project.connections.filter((c) => !c.accountId && !c.account);
  // Per-project shared-account warning (accounts.ts helper).
  const blastWarnings = blastRadiusWarningsFor(project.id, projects ?? [project], accounts);
  return (
    <div className="app-view flex w-full flex-col gap-4">
      <PageTitle
        description="Link a login once under Services, then bind one account and resource per project here. Bindings are per-project pairs, never raw secrets."
        action={<Button size="sm" onPress={onAdd}><NxIcon name="plus" size={15} />Add binding</Button>}
      />
      {blastWarnings.length > 0 && (
        <details className="nx-card shrink-0 !py-3">
          <summary className="cursor-pointer text-[13px] font-medium text-(--text)">
            <Badge tone="warning">Shared</Badge>{" "}{blastWarnings.length} login{blastWarnings.length === 1 ? "" : "s"} also bound elsewhere
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-[1.6] text-(--muted)">
            {blastWarnings.map((entry) => (
              <li key={entry.accountKey}>
                <strong className="font-medium text-(--text)">{entry.provider} · {entry.accountLabel}</strong> is also bound by {(projects ?? [project]).filter((p) => p.id !== project.id && entry.projectIds.includes(p.id)).map((p) => p.name).join(", ") || "another project"}.
                A compromised credential here reaches multiple workspaces.
              </li>
            ))}
          </ul>
        </details>
      )}
      {unlinked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[12px] bg-(--orange-bg) px-4 py-3 text-[12.5px] leading-[1.5] text-(--orange)">
          <span className="min-w-0 flex-1">{unlinked.length} binding{unlinked.length === 1 ? "" : "s"} without a linked account. Link the login under Services first, then Edit the binding to pick it.</span>
          {onOpenServices && <Button size="sm" variant="outline" onPress={onOpenServices}>Open Services</Button>}
        </div>
      )}
      {project.connections.length > 3 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter bindings" placeholder="Filter bindings…" className={inputClass} style={{ maxWidth: 340 }} />
      )}
      <Card flush className="flex min-h-0 flex-col">
        {visible.length === 0 ? (
          <Empty title={project.connections.length === 0 ? "Nothing bound yet" : "No bindings match that filter"} action={project.connections.length === 0 ? <Button size="sm" onPress={onAdd}>Add the first binding</Button> : undefined}>
            {project.connections.length === 0 ? "Bind one account and resource so agents in this project reach the right service." : "Try a different word."}
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {visible.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} accounts={accounts} keySaved={connection.keySaved || (vaultUnlocked && savedKeys[connection.id])} onSaveKey={() => onSaveKey(connection)} onRemove={() => onRemove(connection)} onEdit={() => onEdit(connection)} />
            ))}
          </div>
        )}
      </Card>
      <Note><strong className="font-semibold text-(--text)">Bindings are not services.</strong> A binding is this project&apos;s account and resource pair. A saved publishable key stays in this desktop vault. Agents receive guarded tools.</Note>
    </div>
  );
}
