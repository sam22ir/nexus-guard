import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { ThemeToggle } from "../onboarding";
import { Button } from "@heroui/react";
import { Badge, Icon as NxIcon } from "../ui";
import { PageTitle, Card, CardHeading } from "../app/common";

export function SettingsView({ projects, savedKeys, onReset }: { projects: Project[]; savedKeys: Record<string, boolean>; onReset: () => void }) {
  const desktop = desktopAvailable();

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle description="Appearance, saved approvals, and local data." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeading eyebrow="Appearance" title="Theme" />
          <p className="mb-3 text-[13px] leading-[1.6] text-(--muted)">System follows your operating system. Your choice is remembered on this device.</p>
          <ThemeToggle />
        </Card>
        <Card>
          <CardHeading eyebrow="Saved approvals" title={desktop ? "Kept in your system keychain" : "Open Nexus Guard on your desktop"} />
          <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
            {desktop ? "Service logins and keys are stored in your computer's keychain, never in project files. Agents never receive them." : "This browser preview never accepts or stores keys. Use the desktop app to manage them."}
          </p>
          {desktop && <SavedItems projects={projects} savedKeys={savedKeys} />}
        </Card>
      </div>
      <Card className="shrink-0">
        <CardHeading eyebrow="Danger zone" title="Reset local data" />
        <p className="max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
          Projects, accounts, setup progress, and the kept error log are cleared from this app. Folders on disk and OS-keychain approvals are untouched.
        </p>
        <Button size="sm" variant="danger-soft" className="mt-4" onPress={onReset}>Reset local data</Button>
      </Card>
    </div>
  );
}

export function SavedItems({ projects, savedKeys }: { projects: Project[]; savedKeys: Record<string, boolean> }) {
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
