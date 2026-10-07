import { type ReactNode } from "react";
import { type ConnectionsTab } from "../app/types";
import { Segmented } from "../ui";

/** Things that are not tied to one project: your linked accounts and the
 *  service catalog, and the agents on this machine. Replaces the separate
 *  Services and Agents tabs. */
export function ConnectionsPage({ tab, onTab, children }: { tab: ConnectionsTab; onTab: (tab: ConnectionsTab) => void; children: ReactNode }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="shrink-0">
        <Segmented label="Accounts and agents section" value={tab} onChange={onTab} options={[{ value: "accounts", label: "Accounts & services" }, { value: "agents", label: "Agents" }]} />
      </div>
      {children}
    </div>
  );
}
