import { useState } from "react";
import { desktopAvailable } from "../vault";
import { starterAccounts, tierForProvider, accountLabelForConnection, type Account, type Connection } from "../store";
import { Button } from "@heroui/react";
import { Badge } from "../ui";

export function ConnectionRow({ connection, accounts, keySaved, onSaveKey, onRemove, onEdit }: { connection: Connection; accounts?: Account[]; keySaved?: boolean; onSaveKey?: () => void; onRemove?: () => void; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);
  const eligible = connection.provider === "Supabase" && !!connection.projectRef && !!connection.url;
  const methodLabel = connection.method === "mcp" ? "Browser approval" : "Manual details";
  const connected = connection.authState === "connected";
  const accountLabel = accountLabelForConnection(connection, accounts ?? starterAccounts);
  const resourceLabel = connection.resource ?? connection.target;
  const stateLabel = connected ? "Connected" : connection.authState === "pending" ? "Pending" : keySaved ? "Key saved" : "Not verified";
  const stateTone = connected ? "success" : connection.authState === "pending" ? "warning" : keySaved ? "info" : "neutral";
  const tier = tierForProvider(connection.provider);
  function copyRef() {
    if (!connection.projectRef) return;
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(connection.projectRef).then(done).catch(() => undefined);
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-(--line-soft) px-5 py-3 first:border-t-0">
      <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{connection.short}</span>
      <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="text-[13.5px] font-semibold text-(--text)">{connection.provider}</strong>
          <Badge tone={tier === "native" ? "success" : tier === "curated" ? "info" : "warning"}>{tier}</Badge>
        </span>
        <span className="nx-mono truncate text-(--text)">{resourceLabel}</span>
        <span className="truncate text-[12px] text-(--muted)">
          {accountLabel ?? "Not linked"}{connection.environment ? ` · ${connection.environment}` : ""} · {methodLabel}
          {connection.projectRef && (
            <>
              {" · "}<span className="nx-mono">{connection.projectRef}</span>{" "}
              <button type="button" aria-label="Copy project reference" onClick={copyRef} className="underline underline-offset-2 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">{copied ? "Copied" : "Copy"}</button>
            </>
          )}
        </span>
      </span>
      <Badge tone={stateTone} dot>{stateLabel}</Badge>
      <span className="flex shrink-0 gap-1.5">
        {onSaveKey && eligible && (
          <Button size="sm" variant="outline" isDisabled={!desktopAvailable()} onPress={desktopAvailable() ? onSaveKey : undefined}>
            {!desktopAvailable() ? "Desktop only" : keySaved ? "Manage key" : "Save key"}
          </Button>
        )}
        {onEdit && <Button size="sm" variant="outline" onPress={onEdit}>Edit</Button>}
        {onRemove && <Button size="sm" variant="danger-soft" onPress={onRemove}>Remove</Button>}
      </span>
    </div>
  );
}
