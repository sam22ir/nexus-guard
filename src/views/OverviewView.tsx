import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { manifestAccountFor, type Account, type Project } from "../store";
import { blastRadiusWarningsFor } from "../accounts";
import { Button } from "@heroui/react";
import { Icon as NxIcon } from "../ui";
import { type View, type FolderInspection } from "../app/types";
import { GUARD_VISIBLE, primaryBtn, secondaryBtn, smallBtn, ghostLink, badgeStyle } from "../app/styles";
import { StatusDot, PageTitle, Card, CardHeading } from "../app/common";
import { timeAgo, useAuditLog, AuditRow } from "../app/audit";
import { ConnectionRow } from "../app/ConnectionRow";

export function Overview({ project, projects, accounts, onView, onAddConnection, onConnectAgent }: { project: Project; projects: Project[]; accounts: Account[]; onView: (view: View) => void; onAddConnection: () => void; onConnectAgent: () => void }) {
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
  const lastBlock = [...mine].reverse().find((e) => e.decision !== "allow");
  const live = connected.find((c) => c.provider === "Supabase" && c.projectRef);
  const protectedNow = connected.length > 0;
  const setupDone = connected.length > 0 && !!diskCheck?.nexus_project_id;
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
    if (!window.confirm(`Overwrite the on-disk project file for “${project.name}” with what is shown here?\n\nHere: ${project.name} · ${project.environment} · ${hereSummary}\nAgents will then resolve these details.`)) return;
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
    { done: connected.length > 0, label: connected.length > 0 ? `${connected.length} resource${connected.length === 1 ? "" : "s"} connected` : "Connect a resource", detail: connected.length > 0 ? connected.map((c) => `${c.provider} → ${c.resource ?? c.target}`).join(" · ") : "Browser approval, nothing to type" },
    { done: !!diskCheck?.nexus_project_id, label: "Agents resolve it", detail: diskCheck ? (diskCheck.nexus_project_id ? `On disk as ${diskCheck.nexus_project}${(diskCheck.nexus_connections ?? []).length > 0 ? ` · ${(diskCheck.nexus_connections ?? []).map((c) => `${c.provider}:${c.resource ?? c.target ?? "?"}`).join(" · ")}` : ""}` : "No project file in that folder yet") : "Verify what agents opening the folder get" },
  ];

  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        description={`${project.path} → ${project.name} · ${project.environment}`}
        action={
          <>
            <Button size="sm" onPress={protectedNow ? onConnectAgent : onAddConnection}>
              {protectedNow ? "Connect agent" : "Connect a service"}
            </Button>
            <Button size="sm" variant="outline" onPress={() => onView("bindings")}>Bindings</Button>
          </>
        }
      />

      <Card className="shrink-0">
        <div className="flex flex-wrap items-center gap-5">
          <span className="nx-tile" data-tone={protectedNow ? "success" : pending.length > 0 ? "info" : "warning"} style={{ width: 44, height: 44 }}>
            <NxIcon name="shield" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[12px] font-semibold">
              <StatusDot tone={protectedNow ? "green" : pending.length > 0 ? "blue" : "orange"} />
              <span style={{ color: protectedNow ? "var(--green)" : pending.length > 0 ? "var(--blue)" : "var(--orange)" }}>
                {protectedNow ? "Protected" : pending.length > 0 ? "Approval in browser" : "Setup needed"}
              </span>
            </p>
            <h2 className="mt-1 text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-(--text)">
              {protectedNow ? `Every call resolves to ${connected[0].resource ?? connected[0].target}` : pending.length > 0 ? "Finish the approval waiting in your browser" : "Connect one resource to guard this folder"}
            </h2>
            <p className="mt-1 max-w-[65ch] text-[13px] leading-[1.6] text-(--muted)">
              {protectedNow ? "Agents on this folder get this resource only. Anything else is blocked before it reaches the provider." : "Two minutes: approve in the browser, pick the project, done."}
            </p>
          </div>
          <div className="flex min-w-[170px] flex-col gap-1 border-l border-(--line-soft) pl-5 text-[12px] tabular-nums text-(--muted)">
            <span>Identity</span>
            <strong className="font-semibold text-(--text)">{diskCheck?.nexus_project_id ? "On disk" : "Unverified"}</strong>
            <span>Last guard call: {last ? `${decisionLabel(last.decision)} ${timeAgo(last.ts)}` : "never"}</span>
          </div>
        </div>
      </Card>

      {blastWarnings.length > 0 && (
        <details className="nx-card shrink-0 !py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">
            Shared account warning — {blastWarnings.length} login{blastWarnings.length === 1 ? "" : "s"} used by other projects
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-[12px] leading-[1.6] tabular-nums text-(--muted)">
            {blastWarnings.map((entry) => (
              <li key={entry.accountKey}>
                {entry.provider} · {entry.accountLabel} — also bound by {entry.projectIds.filter((id) => id !== project.id).map((id) => projects.find((p) => p.id === id)?.name ?? id).join(", ") || "another project"}.
                A compromised credential here reaches multiple workspaces.
              </li>
            ))}
          </ul>
        </details>
      )}

      {diskCheck && (
        <Card className="shrink-0">
          <CardHeading
            eyebrow="Verify on disk"
            title={diskDiffers ? "Folder differs — choose which wins" : "On disk matches"}
            action={<button type="button" onClick={() => setDiskCheck(null)} className={ghostLink}>Dismiss</button>}
          />
          <div className="flex flex-col gap-2 text-[13px] leading-[1.6]">
            <p className="tabular-nums text-(--text)">On disk: <span className="text-(--muted)">{diskSummary}</span></p>
            <p className="tabular-nums text-(--text)">Here: <span className="text-(--muted)">{project.name} · {project.environment} · {hereSummary}</span></p>
            {diskDiffers
              ? <p className="text-[12px] text-(--muted)">Agents opening this folder resolve the on-disk file until re-saved. Keep the disk version, or overwrite it with what is shown here.</p>
              : <p className="text-[12px] text-(--muted)">Agents opening this folder resolve exactly what is shown here.</p>}
          </div>
          {diskDiffers && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={() => setDiskCheck(null)} className={secondaryBtn}>Keep disk</button>
              <button type="button" onClick={() => void overwriteDisk()} disabled={overwriting || project.connections.length === 0} className={primaryBtn}>
                {overwriting ? "Overwriting…" : "Overwrite disk"}
              </button>
            </div>
          )}
        </Card>
      )}

      {!setupDone && (
        <Card className="flex min-h-[280px] shrink-0 flex-col overflow-visible">
          <CardHeading eyebrow="Setup" title={`${steps.filter((s) => s.done).length} of 3`} />
          <ol className="flex flex-col gap-1">
            {steps.map((step, i) => (
              <li key={step.label} className="flex items-center gap-3 border-t border-(--line) py-3 first:border-t-0 first:pt-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--raised) text-[11px] font-semibold tabular-nums text-(--muted)">{i + 1}</span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(step.done ? "green" : "pending")}>
                  {step.done ? "Done" : "Next"}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {step.label}
                  <small className="block truncate text-[12px] font-normal tabular-nums text-(--muted)">{step.detail}</small>
                </span>
                {i === 1 && !step.done && <button type="button" onClick={onAddConnection} className={smallBtn}>Connect</button>}
                {i === 2 && !step.done && <button type="button" onClick={() => void verifyOnDisk()} disabled={verifying} className={smallBtn}>{verifying ? "Checking…" : "Verify"}</button>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid shrink-0 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeading
            eyebrow="Guard"
            title={mine.length === 0 ? "No calls yet" : `${allowed} allowed · ${blocked} blocked`}
            action={GUARD_VISIBLE ? <button type="button" onClick={() => onView("guard")} className={ghostLink}>Open guard →</button> : undefined}
          />
          {lastBlock ? (
            <div className="flex flex-col gap-2"><AuditRow entry={lastBlock} /></div>
          ) : (
            <p className="text-[13px] leading-[1.6] text-(--muted)">
              {mine.length === 0 ? "Nothing mediated yet. Route an agent through Nexus and the verdicts land here." : "No blocks — every mediated call was allowed."}
            </p>
          )}
          {live && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-(--line) pt-4">
              <button type="button" onClick={() => void runGuardedRead()} disabled={liveChecking} className={smallBtn}>
                {liveChecking ? "Asking Supabase…" : liveCheck ? "Re-check approval live" : "Check approval live"}
              </button>
              {liveCheck && <small className="text-[12px] tabular-nums" style={{ color: liveCheck.ok ? "var(--green)" : "var(--red)" }}>{liveCheck.ok ? "✓ " : ""}{liveCheck.text}</small>}
            </div>
          )}
        </Card>
        <Card>
          <CardHeading
            eyebrow="Recent decisions"
            title={mine.length === 0 ? "Quiet" : `${mine.length} total`}
            action={<button type="button" onClick={() => onView("activity")} className={ghostLink}>View all →</button>}
          />
          {mine.length === 0 ? (
            <p className="text-[13px] leading-[1.6] text-(--muted)">Allowed, blocked, denied — each mediated call shows here with its reason.</p>
          ) : (
            <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto">{[...mine].slice(-4).reverse().map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} />)}</div>
          )}
        </Card>
      </div>

      <Card flush className="flex shrink-0 flex-col">
        <div className="px-5 pt-4"><CardHeading
          eyebrow="Bindings"
          title={project.connections.length === 0 ? "None yet — Supabase first" : `${connected.length}/${project.connections.length} connected`}
          action={<Button size="sm" variant="ghost" onPress={() => onView("bindings")}>Manage</Button>}
        /></div>
        {project.connections.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] leading-[1.6] text-(--muted)">
            No resources yet.{" "}
            <button type="button" onClick={onAddConnection} className="font-medium text-(--text) underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)">
              Connect a service in your browser
            </button>{" "}
            — pick the account and resource, the rest fills in.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col">{project.connections.map((connection) => <ConnectionRow key={connection.id} connection={connection} accounts={accounts} />)}</div>
        )}
      </Card>
    </div>
  );
}
