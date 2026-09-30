import { useState } from "react";
import { desktopAvailable } from "../vault";
import { type Project } from "../store";
import { Button } from "@heroui/react";
import { Empty, Icon as NxIcon, Segmented } from "../ui";
import { type AuditEntry, type ErrorRecord } from "../app/types";
import { PageTitle, Card, CardHeading } from "../app/common";
import { timeAgo, useAuditLog, AuditRow } from "../app/audit";

export function ActivityView({ projects, errorLog, onClearErrors, onRetryError }: { projects: Project[]; errorLog: ErrorRecord[]; onClearErrors: () => void; onRetryError: (record: ErrorRecord) => void }) {
  const { entries, loaded, busy, refresh } = useAuditLog(projects);
  const [filter, setFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"all" | "allowed" | "blocked">("all");
  const desktop = desktopAvailable();
  const query = filter.trim().toLowerCase();
  const matching = (entry: AuditEntry) => {
    if (decisionFilter === "allowed" && entry.decision !== "allow") return false;
    if (decisionFilter === "blocked" && entry.decision === "allow") return false;
    return !query || [entry.agent, entry.project, entry.environment, entry.provider, entry.resource, entry.operation, entry.decision, entry.reason, entry.session].some((field) => (field ?? "").toLowerCase().includes(query));
  };
  const recent = entries.filter(matching).slice(-50).reverse();
  const errors = [...errorLog].reverse();
  const allowedCount = entries.filter((e) => e.decision === "allow").length;
  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description="A record of what Nexus handled: session, project, resource, operation and decision. No secrets."
        action={<Button size="sm" variant="outline" isDisabled={busy} onPress={() => void refresh()}><NxIcon name="refresh" size={15} />{busy ? "Refreshing…" : "Refresh"}</Button>}
      />
      {desktop && entries.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented label="Decision filter" value={decisionFilter} onChange={setDecisionFilter} options={[{ value: "all", label: `All ${entries.length}` }, { value: "allowed", label: `Allowed ${allowedCount}` }, { value: "blocked", label: `Blocked ${entries.length - allowedCount}` }]} />
          <label className="flex min-w-[240px] items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
            <NxIcon name="search" size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity" placeholder="Project, operation, reason…" className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
          </label>
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card flush className="flex min-h-[280px] flex-col lg:max-h-[640px]">
          <div className="px-5 pt-4"><CardHeading eyebrow="Activity log" title={!desktop ? "Desktop only" : !loaded ? "Loading" : recent.length === 0 ? "No recorded activity" : `${recent.length} recent decision${recent.length === 1 ? "" : "s"}`} /></div>
          {!loaded && desktop ? (
            <ul className="flex flex-col gap-2 px-5 pb-5" aria-label="Loading activity">
              {[0, 1, 2, 3].map((i) => <li key={i} className="h-[52px] animate-pulse rounded-[10px] bg-(--raised)" />)}
            </ul>
          ) : recent.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{recent.map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} inset />)}</div>
          ) : (
            <Empty title={query || decisionFilter !== "all" ? "No decisions match that filter" : "No activity recorded"}>
              {!desktop ? "Open the desktop app to read the local activity log. Nexus does not track commands run outside the app." : query || decisionFilter !== "all" ? "Clear the filter to see everything." : "No agent has used Nexus yet. Connect one from Agents and its calls will show up here."}
            </Empty>
          )}
        </Card>
        <Card flush className="flex min-h-[200px] flex-col lg:max-h-[640px]">
          <div className="px-5 pt-4">
            <CardHeading
              eyebrow="App errors"
              title={errors.length === 0 ? "No errors kept" : `${errors.length} kept`}
              action={errors.length > 0 ? <Button size="sm" variant="ghost" onPress={onClearErrors}>Clear</Button> : undefined}
            />
          </div>
          {errors.length > 0 ? (
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {errors.map((record) => (
                <li key={record.id} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <span className="nx-tile" data-tone="danger"><NxIcon name="alert" size={16} /></span>
                  <span className="nx-row-body">
                    <span className="nx-row-title">{record.where}</span>
                    <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{record.message}</span>
                    {record.debug && <span className="nx-row-sub nx-mono" title="Error class for debugging (no secrets)">{record.debug}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="nx-mono nx-muted" title={new Date(record.ts).toLocaleString()}>{timeAgo(record.ts)}</span>
                    {record.retry && <Button size="sm" variant="outline" onPress={() => onRetryError(record)}>Retry</Button>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">Failures to save, link, or remove stay here with what to retry. Nothing has failed yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
