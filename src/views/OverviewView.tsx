import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { manifestAccountFor, tierForProvider, type Account, type Connection, type Project } from "../store";
import { accountGroupKey, blastRadiusWarningsFor } from "../accounts";
import { agentDisplayName } from "../topology";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon, type Tone } from "../ui";
import { type NavTarget, type FolderInspection } from "../app/types";
import { StatusDot, Card, CardHeading } from "../app/common";
import { timeAgo, useAuditLog, AuditRow } from "../app/audit";

export function Overview({ project, projects, accounts, onView, onAddConnection, onConnectAgent }: { project: Project; projects: Project[]; accounts: Account[]; onView: (view: NavTarget) => void; onAddConnection: () => void; onConnectAgent: () => void }) {
  const { entries } = useAuditLog(projects);
  const [diskCheck, setDiskCheck] = useState<FolderInspection | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [overwriting, setOverwriting] = useState(false);
  const [liveCheck, setLiveCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [liveChecking, setLiveChecking] = useState(false);
  const connected = project.connections.filter((c) => c.authState === "connected");
  const pending = project.connections.filter((c) => c.authState === "pending");
  const mine = entries.filter((e) => e.project === project.name || (e.project_id && e.project_id === project.id));
  const allowed = mine.filter((e) => e.decision === "allow").length;
  const blocked = mine.filter((e) => e.decision !== "allow").length;
  const last = mine.length > 0 ? mine[mine.length - 1] : null;
  const agentsSeen = [...mine].reverse().reduce<{ name: string; last?: string | null; calls: number }[]>((list, entry) => {
    if (!entry.agent) return list;
    const found = list.find((a) => a.name === entry.agent);
    if (found) found.calls += 1; else list.push({ name: entry.agent, last: entry.ts, calls: 1 });
    return list;
  }, []);
  // Setup is done when an agent has really called Nexus; binding a service is optional.
  const setupDone = agentsSeen.length > 0;
  const live = connected.find((c) => c.provider === "Supabase" && c.projectRef);
  const protectedNow = connected.length > 0;
  // Guard copy: approval_required reads as denied (blocked/denied wording).
  const decisionLabel = (d?: string | null) => (d === "approval_required" ? "denied" : (d ?? "unknown"));
  // Per-project shared-account warning (accounts.ts helper; Services-first).
  const blastWarnings = blastRadiusWarningsFor(project.id, projects, accounts);

  async function verifyOnDisk() {
    if (!desktopAvailable()) return;
    setVerifying(true);
    try {
      const result = await invoke<FolderInspection>("inspect_project_folder", { workspacePath: project.path });
      setDiskCheck(result);
    } catch {
      setDiskCheck(null);
    } finally {
      setVerifying(false);
    }
  }
  useEffect(() => { setDiskCheck(null); setLiveCheck(null); }, [project.id]);

  // Surface-and-ask: compare what agents on disk resolve vs what is shown
  // here. Rendered as a Keep disk / Overwrite disk / Dismiss panel below
  // (not display-only).
  const hereSummary = project.connections.length === 0
    ? "no bindings"
    : project.connections.map((c) => {
        const manifested = manifestAccountFor(c, accounts);
        return `${c.provider}:${c.resource ?? c.target}@${manifested.account ?? manifested.accountId ?? "Not linked"}`;
      }).join(" · ");
  const diskSummary = !diskCheck
    ? ""
    : !(diskCheck.nexus_project_id || (diskCheck.nexus_connections ?? []).length > 0)
      ? "no project file"
      : `${diskCheck.nexus_project ?? "?"} · ${diskCheck.nexus_environment ?? "?"} · ${((diskCheck.nexus_connections ?? []).length === 0 ? "no bindings" : (diskCheck.nexus_connections ?? []).map((c) => `${c.provider}:${c.resource ?? c.target ?? "?"}@${c.account ?? "—"}`).join(" · "))}`;
  const diskDiffers = !!diskCheck && (
    (diskCheck.nexus_project != null && diskCheck.nexus_project !== project.name) ||
    (diskCheck.nexus_project_id != null && diskCheck.nexus_project_id !== project.id) ||
    (diskCheck.nexus_environment != null && diskCheck.nexus_environment !== project.environment) ||
    ((diskCheck.nexus_connections ?? []).length !== project.connections.length) ||
    (diskCheck.nexus_connections ?? []).some((d) => !project.connections.some((c) => {
      const manifested = manifestAccountFor(c, accounts);
      const hereAccount = manifested.accountId ?? manifested.account ?? "";
      return c.provider.toLowerCase() === d.provider.toLowerCase() &&
        (c.resource ?? c.target) === (d.resource ?? d.target) &&
        hereAccount === (d.account ?? "");
    }))
  );

  async function overwriteDisk() {
    if (!desktopAvailable() || project.connections.length === 0) return;
    if (!window.confirm(`Replace the project file in the folder for “${project.name}” with what is shown here?\n\nHere: ${project.name} · ${project.environment} · ${hereSummary}\nAgents will then use these details.`)) return;
    setOverwriting(true);
    try {
      for (const c of project.connections) {
        const manifested = manifestAccountFor(c, accounts);
        await invoke<string>("write_nexus_project_file", {
          workspacePath: project.path,
          projectId: project.id,
          projectName: project.name,
          provider: c.provider,
          target: c.target,
          projectRef: c.projectRef ?? null,
          connectionId: c.id,
          method: c.method ?? "manual",
          status: c.authState ?? "not_connected",
          environment: project.environment ?? "development",
          repo: project.repo && project.repo !== "Not connected" ? project.repo : null,
          branch: project.branch ?? null,
          account: manifested.account ?? c.account ?? null,
          accountId: manifested.accountId ?? c.accountId ?? null,
        });
      }
      await verifyOnDisk();
    } catch {
      // Keep the panel open so the mismatch stays visible for retry.
    } finally {
      setOverwriting(false);
    }
  }

  async function runGuardedRead() {
    if (!live || !desktopAvailable()) return;
    setLiveChecking(true);
    setLiveCheck(null);
    try {
      const answer = await invoke<{ name: string; status?: string | null; region?: string | null }>("verify_supabase_connection", { projectId: project.id, connectionId: live.id, projectRef: live.projectRef });
      setLiveCheck({ ok: true, text: `${answer.name}${answer.status ? ` · ${answer.status}` : ""}${answer.region ? ` · ${answer.region}` : ""}` });
    } catch (error) {
      const message = "Could not reach Supabase. Check your network connection, then try again.";
      setLiveCheck({ ok: false, text: message });
    } finally {
      setLiveChecking(false);
    }
  }

  const steps = [
    { done: true, label: "Folder registered", detail: project.path },
    { done: agentsSeen.length > 0, label: agentsSeen.length > 0 ? `${agentsSeen.map((a) => agentDisplayName(a.name)).join(", ")} reached Nexus` : "Connect an agent", detail: agentsSeen.length > 0 ? "Its calls show up under Activity" : "One click writes the config. Then restart the agent and ask it which Nexus project it is in." },
    { done: connected.length > 0, label: connected.length > 0 ? `${connected.length} service${connected.length === 1 ? "" : "s"} bound` : "Bind a service (optional)", detail: connected.length > 0 ? connected.map((c) => `${c.provider} → ${c.resource ?? c.target}`).join(" · ") : "Tell Nexus which exact resource this project uses. Browser approval, nothing to type." },
  ];

  const sharedKeys = new Set(blastWarnings.map((w) => w.accountKey));
  const isShared = (c: Connection) => { const key = accountGroupKey(c.provider, c); return !!key && sharedKeys.has(key); };
  const stepsDone = steps.filter((s) => s.done).length;
  const statusTone: Tone = protectedNow ? "success" : pending.length > 0 ? "info" : "warning";
  const statusLabel = protectedNow ? "Protected" : pending.length > 0 ? "Approval in browser" : setupDone ? "Agent connected" : "Almost set up";
  const headline = protectedNow ? `Every call resolves to ${connected[0].resource ?? connected[0].target}` : pending.length > 0 ? "Finish the approval waiting in your browser" : setupDone ? "Bind a service so calls resolve to the right resource" : "Connect an agent to see Nexus working";
  const tierTone = (tier: string): Tone => (tier === "native" ? "success" : tier === "curated" ? "info" : "warning");

  return (
    <div className="app-view flex min-h-0 w-full flex-1 flex-col gap-3">
      <Card className="shrink-0 !py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="nx-tile" data-tone={statusTone} style={{ width: 40, height: 40 }}><NxIcon name="shield" size={20} /></span>
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center gap-2 text-[11.5px] font-medium" style={{ color: `var(--${statusTone === "success" ? "green" : statusTone === "info" ? "blue" : "orange"})` }}>
              <StatusDot tone={statusTone === "success" ? "green" : statusTone === "info" ? "blue" : "orange"} />{statusLabel}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-(--text)">{headline}</h2>
            <p className="mt-0.5 truncate text-[12px] text-(--muted)"><span className="nx-mono">{project.path}</span> · {project.environment}</p>
          </div>
          <dl className="flex gap-5 text-[12px] text-(--muted)">
            <div><dt>Project file</dt><dd className="font-medium text-(--text)">{diskCheck ? (diskCheck.nexus_project_id ? "Found" : "Missing") : "Not checked"}</dd></div>
            <div><dt>Last call</dt><dd className="font-medium text-(--text)">{last ? `${decisionLabel(last.decision)} ${timeAgo(last.ts)}` : "never"}</dd></div>
            <div><dt>Calls</dt><dd className="font-medium text-(--text)">{mine.length === 0 ? "0" : `${allowed} allowed · ${blocked} blocked`}</dd></div>
          </dl>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" isDisabled={verifying || !desktopAvailable()} onPress={() => void verifyOnDisk()}>{verifying ? "Checking…" : "Check project file"}</Button>
            <Button size="sm" onPress={setupDone && !protectedNow ? onAddConnection : onConnectAgent}>{setupDone && !protectedNow ? "Bind a service" : "Connect agent"}</Button>
          </div>
        </div>
      </Card>

      {(blastWarnings.length > 0 || (diskCheck && !diskDiffers)) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {blastWarnings.length > 0 && (
            <button type="button" className="nx-badge cursor-pointer !px-3 !py-1.5 text-[12px]" data-tone="warning" onClick={() => onView("services")} title={blastWarnings.map((w) => `${w.provider} · ${w.accountLabel} is also bound by ${w.projectIds.filter((id) => id !== project.id).map((id) => projects.find((p) => p.id === id)?.name ?? id).join(", ") || "another project"}`).join("\n")}>
              {blastWarnings.length} account{blastWarnings.length === 1 ? " is" : "s are"} shared with other projects · Review
            </button>
          )}
          {diskCheck && !diskDiffers && (
            <span className="nx-badge !px-3 !py-1.5 text-[12px]" data-tone="success">
              Folder matches the project file
              <button type="button" aria-label="Dismiss" className="ml-1 opacity-70 hover:opacity-100" onClick={() => setDiskCheck(null)}><NxIcon name="x" size={12} /></button>
            </span>
          )}
        </div>
      )}

      {diskCheck && diskDiffers && (
        <Card className="shrink-0 !py-3" >
          <div className="flex flex-wrap items-center gap-4">
            <span className="nx-tile" data-tone="danger"><NxIcon name="alert" size={17} /></span>
            <div className="min-w-[260px] flex-1">
              <div className="text-[13.5px] font-semibold text-(--text)">The project file in your folder differs from what Nexus shows here. Which should agents use?</div>
              <p className="truncate text-[12px] text-(--muted)" title={diskSummary}>In the folder: <span className="nx-mono">{diskSummary}</span></p>
              <p className="truncate text-[12px] text-(--muted)" title={`${project.name} · ${project.environment} · ${hereSummary}`}>Here: <span className="nx-mono">{project.name} · {project.environment} · {hereSummary}</span></p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onPress={() => setDiskCheck(null)}>Use the folder&apos;s file</Button>
              <Button size="sm" isDisabled={overwriting || project.connections.length === 0} onPress={() => void overwriteDisk()}>{overwriting ? "Saving…" : "Use what's shown here"}</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]" style={{ minHeight: 280 }}>
        <Card flush className="flex min-h-0 flex-col">
          <div className="shrink-0 px-5 pt-4">
            <CardHeading eyebrow={setupDone ? "Agents" : "Setup"} title={setupDone ? `${agentsSeen.length} seen on this project` : `${stepsDone} of 3`} />
            {!setupDone && <div className="-mt-1 mb-2 h-1 rounded-full bg-(--raised)"><div className="h-1 rounded-full bg-(--green)" style={{ width: `${(stepsDone / 3) * 100}%` }} /></div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!setupDone ? steps.map((step, i) => (
              <div key={step.label} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <span className="nx-check" data-state={step.done ? "done" : "pending"}>{step.done && <NxIcon name="check" size={13} />}</span>
                <span className="nx-row-body">
                  <span className="nx-row-title">{step.label}</span>
                  <span className="nx-row-sub" title={step.detail}>{step.detail}</span>
                </span>
                {i === 1 && !step.done && <Button size="sm" onPress={onConnectAgent}>Connect agent</Button>}
                {i === 2 && !step.done && <Button size="sm" variant="outline" onPress={onAddConnection}>Bind</Button>}
              </div>
            )) : agentsSeen.map((agent) => (
              <div key={agent.name} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <span className="nx-tile" data-tone="success"><NxIcon name="agents" size={16} /></span>
                <span className="nx-row-body"><span className="nx-row-title">{agentDisplayName(agent.name)}</span><span className="nx-row-sub">{agent.calls} call{agent.calls === 1 ? "" : "s"}</span></span>
                <span className="nx-mono nx-muted">{timeAgo(agent.last)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card flush className="flex min-h-0 flex-col">
          <div className="shrink-0 px-5 pt-4">
            <CardHeading
              eyebrow="Bindings"
              title={project.connections.length === 0 ? "None yet" : `${connected.length}/${project.connections.length} connected`}
              action={<span className="flex gap-1.5">{live && <Button size="sm" variant="ghost" isDisabled={liveChecking} onPress={() => void runGuardedRead()}>{liveChecking ? "Testing…" : "Test connection"}</Button>}<Button size="sm" variant="outline" onPress={() => onView("bindings")}>Manage</Button></span>}
            />
            {liveCheck && <p className="-mt-2 mb-2 text-[12px]" style={{ color: liveCheck.ok ? "var(--green)" : "var(--red)" }}>{liveCheck.ok ? "Connected · " : ""}{liveCheck.text}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {project.connections.length === 0 ? (
              <Empty title="Nothing bound yet" action={<Button size="sm" onPress={onAddConnection}>Add a binding</Button>}>Approve in your browser, pick the account and resource, and the rest fills in.</Empty>
            ) : project.connections.map((connection) => {
              const tier = tierForProvider(connection.provider);
              const ok = connection.authState === "connected";
              return (
                <div key={connection.id} className="nx-row" style={{ borderTop: "1px solid var(--line-soft)" }}>
                  <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{connection.short}</span>
                  <span className="nx-row-body">
                    <span className="nx-row-title">{connection.provider}</span>
                    <span className="nx-row-sub nx-mono" title={connection.resource ?? connection.target}>{connection.resource ?? connection.target}</span>
                  </span>
                  {isShared(connection) && <Badge tone="warning">Shared</Badge>}
                  <Badge tone={ok ? "success" : connection.authState === "pending" ? "warning" : tierTone(tier)} dot={ok}>{ok ? "Connected" : connection.authState === "pending" ? "Pending" : tier}</Badge>
                </div>
              );
            })}
          </div>
        </Card>

        <Card flush className="flex min-h-0 flex-col">
          <div className="shrink-0 px-5 pt-4">
            <CardHeading eyebrow="Activity" title={mine.length === 0 ? "No calls yet" : `${allowed} allowed · ${blocked} blocked`} action={<Button size="sm" variant="ghost" onPress={() => onView("activity")}>View all</Button>} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mine.length === 0 ? (
              <Empty title="Quiet">Allowed and blocked calls appear here, each with its reason.</Empty>
            ) : [...mine].slice(-8).reverse().map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} inset />)}
          </div>
        </Card>
      </div>
    </div>
  );
}
