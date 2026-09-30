import { useState, type FormEvent } from "react";
import { desktopAvailable, lockVault, unlockVault } from "../vault";
import { type Project } from "../store";
import { ThemeToggle } from "../onboarding";
import { Button } from "@heroui/react";
import { Badge, Icon as NxIcon } from "../ui";
import { inputClass } from "../app/styles";
import { PageTitle, Card, CardHeading } from "../app/common";

export function SettingsView({ projects, savedKeys, vaultUnlocked, onUnlocked, onLocked, onReset }: { projects: Project[]; savedKeys: Record<string, boolean>; vaultUnlocked: boolean; onUnlocked: () => void; onLocked: () => void; onReset: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (error) {
      setMessage("Could not unlock the vault. Check the password and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    setMessage("");
    try {
      await lockVault();
      onLocked();
    } catch (error) {
      setMessage("Could not lock the vault. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const desktop = desktopAvailable();

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle description="Appearance, the desktop vault, and local data." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeading eyebrow="Appearance" title="Theme" />
          <p className="mb-3 text-[13px] leading-[1.6] text-(--muted)">System follows your operating system. Your choice is remembered on this device.</p>
          <ThemeToggle />
        </Card>
        <Card>
          <CardHeading eyebrow="Desktop vault" title={!desktop ? "Open Nexus Guard on your desktop" : vaultUnlocked ? "Vault unlocked" : "Unlock or create your vault"} action={desktop ? <Badge tone={vaultUnlocked ? "success" : "warning"} dot>{vaultUnlocked ? "Unlocked" : "Locked"}</Badge> : undefined} />
          <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
            {!desktop ? "This browser preview never accepts or stores keys. Use the desktop app to manage them." : vaultUnlocked ? "Your secure system keychain is ready. Keys are kept out of project files." : "Enter a password with at least 12 characters to unlock your vault, or to create it the first time."}
          </p>
          {desktop && !vaultUnlocked && (
            <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">Vault password</span>
                <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required placeholder="At least 12 characters" className={inputClass} />
              </label>
              {message && <p className="text-[12px] text-(--red)" role="alert">{message}</p>}
              <Button type="submit" size="sm" isDisabled={busy || password.length < 12} className="self-start">{busy ? "Opening vault…" : "Open vault"}</Button>
            </form>
          )}
          {desktop && vaultUnlocked && (
            <div className="mt-4"><Button size="sm" variant="outline" isDisabled={busy} onPress={() => void lock()}>{busy ? "Locking…" : "Lock vault"}</Button></div>
          )}
          {message && vaultUnlocked && <p className="mt-2 text-[12px] text-(--red)" role="alert">{message}</p>}
          {desktop && vaultUnlocked && <VaultItems projects={projects} savedKeys={savedKeys} />}
        </Card>
      </div>
      <Card className="shrink-0">
        <CardHeading eyebrow="Danger zone" title="Reset local data" />
        <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
          Projects, setup progress, and the kept error log return to starter examples. Folders on disk and OS-keychain approvals are untouched.
        </p>
        <Button size="sm" variant="danger-soft" className="mt-4" onPress={onReset}>Reset local data</Button>
      </Card>
    </div>
  );
}

export function VaultItems({ projects, savedKeys }: { projects: Project[]; savedKeys: Record<string, boolean> }) {
  const items = projects.flatMap((item) => item.connections.flatMap((connection) => {
    const publishable = connection.provider === "Supabase" && (connection.keySaved || savedKeys[connection.id]);
    const mcp = connection.authState === "connected";
    if (!publishable && !mcp) return [];
    return [{ project: item.name, service: connection.provider, target: connection.target, kind: publishable ? "Publishable key" : "MCP approval" }];
  }));
  return (
    <div className="mt-5 border-t border-(--line-soft) pt-4">
      <span className="nx-eyebrow">Stored items</span>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-(--muted)">No keys or approvals are saved yet.</p>
      ) : (
        <ul className="mt-2 flex max-h-[280px] flex-col overflow-y-auto">
          {items.map((item) => (
            <li key={`${item.project}-${item.service}-${item.kind}`} className="nx-row" style={{ paddingInline: 0 }}>
              <span className="nx-tile" data-tone="success"><NxIcon name="key" size={16} /></span>
              <span className="nx-row-body">
                <span className="nx-row-title">{item.service} · {item.project}</span>
                <span className="nx-row-sub">{item.kind} · {item.target}</span>
              </span>
              <Badge tone="success" dot>Saved</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
