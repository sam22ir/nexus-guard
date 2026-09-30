import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../vault";
import { type Project } from "../store";
import { agentDisplayName, projectDisplayName } from "../topology";
import { Badge, Icon as NxIcon, type StepState, type Tone } from "../ui";
import { type AuditEntry } from "./types";

export async function readAuditLogs(projects: Project[], limit = 50): Promise<AuditEntry[]> {
  if (!desktopAvailable()) return [];
  const settled = await Promise.allSettled(projects.map(async (item) => {
    const entries = await invoke<AuditEntry[]>("read_audit_log", { workspacePath: item.path, limit });
    return entries.map((entry) => ({ ...entry, workspace: item.path }));
  }));
  const merged = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return merged.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "unknown time";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function useAuditLog(projects: Project[]) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  // Stable identity: only workspace membership drives refetch. Editing names,
  // connections, or other fields on every keystroke-save must not re-hit
  // `read_audit_log` for every project.
  const workspacesKey = projects.map((item) => `${item.id}:${item.path}`).join("|");
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setEntries(await readAuditLogs(projectsRef.current)); } catch { setEntries([]); }
    finally { setBusy(false); setLoaded(true); }
  }, []);
  useEffect(() => {
    // Debounced so rapid folder edits collapse into a single read.
    const timer = window.setTimeout(() => { void refresh(); }, 150);
    return () => window.clearTimeout(timer);
  }, [workspacesKey, refresh]);
  return { entries, loaded, busy, refresh };
}

export function AuditRow({ entry, inset = false }: { entry: AuditEntry; inset?: boolean }) {
  const when = timeAgo(entry.ts);
  const full = entry.ts ? new Date(entry.ts).toLocaleString() : "Unknown time";
  // Paper: approval_required reads as denied (Blocked/denied wording).
  const decision = entry.decision === "approval_required" ? "denied" : (entry.decision ?? "unknown");
  const state: StepState = decision === "allow" ? "done" : decision === "block" ? "failed" : "skipped";
  const tone: Tone = decision === "allow" ? "success" : decision === "block" ? "danger" : "warning";
  return (
    <div className="nx-row" style={inset ? undefined : { paddingInline: 0 }}>
      <span className="nx-check" data-state={state} aria-label={decision}>
        {state === "done" && <NxIcon name="check" size={13} />}
        {state === "failed" && <NxIcon name="x" size={13} />}
      </span>
      <span className="nx-row-body">
        <span className="nx-row-title">{entry.operation ?? "unknown operation"}</span>
        <span className="nx-row-sub">{entry.agent ? `${agentDisplayName(entry.agent)} · ` : ""}{projectDisplayName(entry.project)} · {entry.environment ?? "?"} · {entry.resource ?? entry.provider ?? "?"}</span>
        {entry.reason && <span className="nx-row-sub" style={{ whiteSpace: "normal" }}>{entry.reason}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={tone}>{decision}</Badge>
        <span className="nx-mono nx-muted" title={full}>{when}</span>
      </span>
    </div>
  );
}
