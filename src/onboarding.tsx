import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@heroui/react";
import { Icon } from "./ui";
import type { Account } from "./store";
import { PROVIDER_CATALOG } from "./store";
import { desktopAvailable } from "./vault";

export const NEXUS_HTTP_URL = "http://localhost:3939/mcp";

/* ---------- Theme (paper §11): system-follow + manual toggle ----------
 *
 * NOTE FOR APP WORKSTREAM: this file owns the theme helpers. Mount
 * <ThemeToggle /> in the App rail when ready (it is already mounted in
 * Home's header and in this modal's footer), and call initTheme() once at
 * boot (e.g. in main.tsx) — index.html's inline script already covers
 * first paint, initTheme() keeps runtime + OS-listener state in sync.
 * Preference order: localStorage "nexus-theme" > prefers-color-scheme >
 * dark. Stored values: "dark" | "light" | "system". */

export type NexusTheme = "dark" | "light";
export type NexusThemeChoice = NexusTheme | "system";

const THEME_KEY = "nexus-theme";

export function getThemeChoice(): NexusThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "system";
}

export function resolveTheme(choice: NexusThemeChoice): NexusTheme {
  if (choice === "dark" || choice === "light") return choice;
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch { /* ignore */ }
  return "dark";
}

/** Currently applied theme (resolved — never "system"). */
export function getTheme(): NexusTheme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return resolveTheme(getThemeChoice());
}

function applyTheme(theme: NexusTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#F6F5F1" : "#1A1A1A");
}

/** Persist a choice ("system" follows the OS) and apply it immediately. */
export function setTheme(choice: NexusThemeChoice): NexusTheme {
  try { window.localStorage.setItem(THEME_KEY, choice); } catch { /* ignore */ }
  const resolved = resolveTheme(choice);
  applyTheme(resolved);
  return resolved;
}

/** Apply the stored/OS theme. Call once at boot; returns the applied theme. */
export function initTheme(): NexusTheme {
  const resolved = resolveTheme(getThemeChoice());
  applyTheme(resolved);
  return resolved;
}

/** System-follow + manual toggle. Follows OS changes while on "system". */
export function ThemeToggle() {
  const [choice, setChoice] = useState<NexusThemeChoice>(getThemeChoice);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (getThemeChoice() === "system") applyTheme(resolveTheme("system"));
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const options: { value: NexusThemeChoice; label: string }[] = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];
  return (
    <span className="seg-control" role="group" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={choice === option.value}
          title={option.value === "system" ? "Follow the operating system" : `${option.label} theme`}
          onClick={() => { setTheme(option.value); setChoice(option.value); }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** One icon button that cycles System, Light, Dark. Compact stand-in for
 *  ThemeToggle in the app header; same persistence and OS-follow behavior. */
export function ThemeButton() {
  const [choice, setChoice] = useState<NexusThemeChoice>(getThemeChoice);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (getThemeChoice() === "system") applyTheme(resolveTheme("system"));
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const order: NexusThemeChoice[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(choice) + 1) % order.length];
  const name = (value: NexusThemeChoice) => (value === "system" ? "System" : value === "light" ? "Light" : "Dark");
  const icon = choice === "system" ? "monitor" : choice === "light" ? "sun" : "moon";
  return (
    <Button isIconOnly size="sm" variant="ghost" aria-label={`Theme: ${name(choice)}. Switch to ${name(next)}`} onPress={() => { setTheme(next); setChoice(next); }}>
      <Icon name={icon} size={17} />
    </Button>
  );
}

/** Bind the endpoint to one project. The bridge refuses a request that names no
 *  workspace, so each project gets its own registration against the same
 *  server. The query form works for every agent, including ones with no
 *  custom-header support. */
export function nexusHttpUrlFor(workspace: string) {
  const trimmed = workspace.trim();
  if (!trimmed) return NEXUS_HTTP_URL;
  return `${NEXUS_HTTP_URL}?workspace=${encodeURIComponent(trimmed)}`;
}
export function claudeHttpCommand(workspace: string) {
  return `claude mcp add --transport http nexus "${nexusHttpUrlFor(workspace)}"`;
}
export function codexHttpCommand(workspace: string) {
  return `codex mcp add nexus --url "${nexusHttpUrlFor(workspace)}"`;
}

/** Workspace-bound session mint for the proof moment and manual HTTP use.
 *  POST returns `{ token, expiresAt, workspace }` — send the token back as
 *  the `X-Nexus-Session` header (raw HTTP to /mcp or /context) or as the
 *  `session` argument of a nexus.context / nexus.request_access /
 *  nexus.execute tool call. Sessions expire after ~30 min of disuse. */
const NEXUS_SESSION_URL = NEXUS_HTTP_URL.replace(/\/mcp\/?$/, "/session");
export function sessionMintCommand(workspace: string) {
  const trimmed = workspace.trim() || "<project folder>";
  return `curl -s -X POST ${NEXUS_SESSION_URL} -H 'content-type: application/json' -d '{"workspace": ${JSON.stringify(trimmed)}}'`;
}

type ProveResult = {
  exists: boolean;
  is_dir: boolean;
  git_remote?: string | null;
  git_branch?: string | null;
  nexus_project?: string | null;
  nexus_project_id?: string | null;
  nexus_environment?: string | null;
  nexus_connections?: { provider: string; account?: string | null; resource?: string | null; target?: string | null }[] | null;
};

const STEPS = ["Register", "Link", "Connect", "Prove"];

const inputClass =
  "h-10 w-full rounded-[6px] border border-(--line) bg-(--panel) px-3 text-[13px] text-(--text) placeholder:text-(--muted-2) transition-[transform,opacity] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-1";

function CodeBlock({ title, command, copied, onCopy }: { title: string; command: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-(--line) bg-(--panel)">
      <div className="flex items-center justify-between border-b border-(--line) bg-(--canvas) px-3 py-2">
        <strong className="text-[11px] font-semibold uppercase tracking-[0.06em] text-(--muted)">{title}</strong>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-[6px] px-2 py-1 text-[12px] font-medium text-(--muted) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre px-3 py-3 font-mono text-[12px] leading-[1.6] tabular-nums text-(--text)">{command}</pre>
    </div>
  );
}

export function OnboardingModal({ onClose, onSave, onAddAccount, accounts, existingNames, onWatchPulse }: {
  onClose: () => void;
  onSave: (input: { name: string; path: string; repo: string; branch: string; environment?: string; binding?: { provider: string; accountId: string; resource: string } }) => void;
  onAddAccount: (input: { provider: string; label: string }) => void;
  accounts: Account[];
  existingNames: string[];
  /** Deep-link to the guided proof moment: close this modal and show the
   *  new graph pulsing on Home/Activity. Optional — falls back to finish().
   *  (App workstream: pass () => { dismiss; setView("home"); }.) */
  onWatchPulse?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [copied, setCopied] = useState("");
  const [proving, setProving] = useState(false);
  const [proveError, setProveError] = useState("");
  const [proveResult, setProveResult] = useState<ProveResult | null>(null);
  const [linkProvider, setLinkProvider] = useState("Supabase");
  const [linkAccountId, setLinkAccountId] = useState("");
  const [linkResource, setLinkResource] = useState("");
  const [newLabel, setNewLabel] = useState("personal");
  const linkAccounts = accounts.filter((a) => a.provider.toLowerCase() === linkProvider.toLowerCase());
  const linkAccount = linkAccounts.find((a) => a.id === linkAccountId) ?? null;
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());
  const canRegister = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;
  const diskConnections = proveResult?.nexus_connections ?? [];

  // Guided proof gate: the folder must resolve as a Nexus project on disk
  // (exists + is_dir + nexus_project_id) before finish unlocks. Fresh
  // folders with no project file yet use the explicit Skip path instead —
  // they prove later from Overview. (App workstream: persist
  // "nexus-guard.onboarded" only in onSave = proved, or onClose = explicit
  // Skip. ×/backdrop dismiss locally below and persist nothing.)
  const proved = !!proveResult?.exists && !!proveResult?.is_dir && !!proveResult?.nexus_project_id;

  // × and backdrop dismiss locally without persisting: only proof (finish)
  // or explicit Skip marks onboarding done.
  if (dismissed) return null;

  function dismissLocal() {
    setDismissed(true);
  }

  function copyText(kind: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(kind);
        window.setTimeout(() => setCopied(""), 1500);
      }).catch(() => undefined);
    }
  }

  async function prove() {
    if (!desktopAvailable()) { setProveError("Open the desktop app to inspect the folder."); return; }
    if (!path.trim()) { setProveError("Enter the project folder first."); return; }
    setProving(true); setProveError("");
    try {
      const result = await invoke<ProveResult>("inspect_project_folder", { workspacePath: path.trim() });
      setProveResult(result);
    } catch (error) {
      setProveResult(null);
      setProveError(error instanceof Error ? error.message : typeof error === "string" && error ? error : "Could not inspect that folder.");
    } finally {
      setProving(false);
    }
  }

  function finish() {
    if (canRegister) {
      onSave({
        name: name.trim(),
        path: path.trim(),
        repo: "",
        branch: "main",
        binding: linkAccount && linkResource.trim()
          ? { provider: linkProvider, accountId: linkAccount.id, resource: linkResource.trim() }
          : undefined,
      });
    } else onClose();
  }

  function watchPulse() {
    if (onWatchPulse) onWatchPulse();
    else finish();
  }

  return (
    <OnboardShell title="Set up Nexus Guard" description={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}. Register, link, connect, prove.`} onClose={dismissLocal}>
      <div className="flex flex-col gap-4">
        <ol className="flex flex-wrap items-center gap-2" aria-label="Setup steps">
          {STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]"
                style={index === step ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { background: "var(--raised)", color: "var(--muted)" }}
              >
                {index + 1} · {label}
              </span>
              {index < STEPS.length - 1 && <span className="text-(--muted-2)">→</span>}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Koupa" className={inputClass} required />
              {nameUsed && <span className="text-[12px] text-(--red)" role="alert">A project with this name already exists.</span>}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project folder</span>
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Projects/Koupa" className={inputClass} required />
            </label>
            <p className="rounded-[8px] border border-(--line) bg-(--canvas) px-3 py-2.5 text-[12px] leading-[1.6] text-(--muted)">
              Only project information is saved here. No passwords are requested.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <p className="rounded-[8px] border border-(--line) bg-(--canvas) px-3 py-2.5 text-[12px] leading-[1.6] text-(--muted)">
              Link this project to an <strong className="font-semibold text-(--text)">account</strong>, not a bare provider.
              Pick the login first, then name the exact resource inside it. The approval itself stays in the desktop vault.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Service</span>
              <select value={linkProvider} onChange={(e) => { setLinkProvider(e.target.value); setLinkAccountId(""); }} className={inputClass}>
                {PROVIDER_CATALOG.map((p) => <option key={p.provider} value={p.provider}>{p.provider}</option>)}
              </select>
            </label>
            {linkAccounts.length === 0 ? (
              <div className="flex flex-col gap-2 rounded-[8px] border border-(--line) p-3">
                <p className="text-[12px] leading-[1.6] text-(--muted)">No {linkProvider} login linked yet. Add one — it takes a label, no secrets.</p>
                <div className="flex gap-2">
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="personal" aria-label="Account label" className={inputClass} />
                  <button
                    type="button"
                    onClick={() => { onAddAccount({ provider: linkProvider, label: newLabel.trim() || "personal" }); setNewLabel("personal"); }}
                    className="shrink-0 rounded-[6px] bg-(--accent) px-4 py-2 text-[13px] font-medium text-(--accent-foreground) transition-[background-color,transform,opacity] duration-200 hover:bg-(--accent-hover) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2"
                  >
                    Add login
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">Login (from Services)</span>
                <select value={linkAccountId} onChange={(e) => setLinkAccountId(e.target.value)} className={inputClass}>
                  <option value="">Select a login…</option>
                  {linkAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Resource inside that login</span>
              <input value={linkResource} onChange={(e) => setLinkResource(e.target.value)} placeholder={linkProvider === "Supabase" ? "koupa-development" : "For example, koupa-auth"} className={inputClass} />
            </label>
            {linkAccount && linkResource.trim() && (
              <p className="text-[12px] leading-[1.6] tabular-nums text-(--muted)">
                This project will use <strong className="font-semibold text-(--text)">{linkProvider} → {linkAccount.label} → {linkResource.trim()}</strong>. Anything else gets refused before it reaches the provider.
              </p>
            )}
            <ul className="divide-y divide-(--line-soft) rounded-[8px] border border-(--line)">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]"
                    style={account.authState === "connected" ? { background: "var(--green-bg)", color: "var(--green)" } : { background: "var(--raised)", color: "var(--muted)" }}
                  >
                    {account.authState}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium tabular-nums text-(--text)">
                    {account.provider} · {account.label}
                    <small className="block font-mono text-[11px] font-normal text-(--muted-2)">id: {account.id}</small>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-[1.6] text-(--muted)">
              You approve the real account in the browser next (Supabase), then pick which project links here. Nothing to type.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-[12px] leading-[1.6] text-(--muted)">
              Connect the agent CLI to the local Nexus HTTP endpoint. Adjust the port to match <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">NEXUS_HTTP_PORT</kbd> (default 3939).
            </p>
            <CodeBlock title="Claude Code" command={claudeHttpCommand(path)} copied={copied === "claude"} onCopy={() => copyText("claude", claudeHttpCommand(path))} />
            <CodeBlock title="Codex" command={codexHttpCommand(path)} copied={copied === "codex"} onCopy={() => copyText("codex", codexHttpCommand(path))} />
            <CodeBlock title="Mint a session" command={sessionMintCommand(path)} copied={copied === "session"} onCopy={() => copyText("session", sessionMintCommand(path))} />
            <p className="text-[12px] leading-[1.6] tabular-nums text-(--muted)">
              Each command registers this project only: the endpoint is shared, the
              {" "}<kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">workspace</kbd> is what tells Nexus which project the agent is in. Run it again per project. A registration without a workspace (or the
              {" "}<kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">X-Nexus-Workspace</kbd> header) is refused rather than guessed.
              The session command returns a token: send it as the <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">X-Nexus-Session</kbd> header
              (raw HTTP) or the <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">session</kbd> argument
              of a <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">nexus.context</kbd> / <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">nexus.request_access</kbd> / <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">nexus.execute</kbd> tool call.
              Sessions are bound to this workspace and re-validated every request.
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-[12px] leading-[1.6] text-(--muted)">
              Prove the folder resolves: Nexus inspects it and reports the on-disk project, environment, and persisted account and resource pairs.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void prove()}
                disabled={proving || !path.trim()}
                className="rounded-[6px] border border-(--line) bg-(--panel) px-3 py-1.5 text-[12px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:-translate-y-px hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) disabled:cursor-not-allowed disabled:opacity-50"
              >
                {proving ? "Inspecting…" : proveResult ? "Re-run inspect" : "Run inspect"}
              </button>
            </div>
            {proveError && <p className="text-[12px] text-(--red)" role="alert">{proveError}</p>}
            {proveResult && (
              <ul className="divide-y divide-(--line-soft) rounded-[8px] border border-(--line)">
                <li className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]"
                    style={proveResult.exists && proveResult.is_dir ? { background: "var(--green-bg)", color: "var(--green)" } : { background: "var(--red-bg)", color: "var(--red)" }}
                  >
                    {proveResult.exists && proveResult.is_dir ? "folder ok" : "missing"}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium tabular-nums text-(--text)">
                    {path.trim()}
                    <small className="block text-[11px] font-normal text-(--muted)">
                      {proveResult.git_branch ? `git: ${proveResult.git_branch}` : "no git branch reported"}{proveResult.nexus_project ? ` · on disk as ${proveResult.nexus_project}` : " · no project file yet"}
                    </small>
                  </span>
                </li>
                {diskConnections.length === 0 ? (
                  <li className="px-3 py-2.5 text-[12px] text-(--muted)">No persisted connections on disk yet — they appear after the first binding save.</li>
                ) : (
                  diskConnections.map((connection) => (
                    <li key={connection.provider} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="rounded-full bg-(--green-bg) px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em] text-(--green)">
                        {connection.provider}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] font-medium tabular-nums text-(--text)">
                        {connection.resource ?? connection.target ?? "?"}
                        <small className="block text-[11px] font-normal text-(--muted)">account: {connection.account ?? "—"}</small>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
            {proved ? (
              <div className="flex flex-col gap-2 rounded-[8px] border border-(--line) bg-(--canvas) p-3">
                <p className="text-[12px] leading-[1.6] text-(--muted)">
                  <strong className="font-semibold text-(--text)">Proved.</strong> This folder resolves on disk as{" "}
                  <strong className="font-mono font-semibold text-(--text)">{proveResult?.nexus_project}</strong>.
                  Mint a session for this folder (<kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">POST /session</kbd>),
                  call <kbd className="rounded-[4px] border border-(--line) bg-(--raised) px-1.5 py-0.5 font-mono text-[11px] text-(--text)">nexus.context</kbd> with
                  that session, then watch the graph pulse:
                </p>
                <CodeBlock title="Workspace endpoint" command={nexusHttpUrlFor(path)} copied={copied === "endpoint"} onCopy={() => copyText("endpoint", nexusHttpUrlFor(path))} />
                <button
                  type="button"
                  onClick={watchPulse}
                  className="self-start rounded-[6px] px-2 py-1.5 text-[13px] font-medium text-(--green) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
                >
                  Watch it pulse on Home →
                </button>
              </div>
            ) : proveResult ? (
              <p className="rounded-[8px] border border-(--line) bg-(--canvas) px-3 py-2.5 text-[12px] leading-[1.6] text-(--muted)">
                Not proved yet — there is no Nexus project file in that folder. Save a binding first, or skip for now and prove it later from Overview.
              </p>
            ) : null}
          </>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-(--line) pt-4">
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] px-2 py-1.5 text-[13px] font-medium text-(--muted) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
            >
              Skip for now
            </button>
            <ThemeToggle />
          </span>
          <span className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-[6px] border border-(--line) bg-(--panel) px-4 py-2 text-[13px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:-translate-y-px hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2"
              >
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={nameUsed}
                className="rounded-[6px] bg-(--accent) px-4 py-2 text-[13px] font-medium text-(--accent-foreground) transition-[background-color,transform,opacity] duration-200 hover:bg-(--accent-hover) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={nameUsed || !proved}
                title={!proved ? "Run inspect above: the folder must resolve as a Nexus project, or Skip for now." : undefined}
                className="rounded-[6px] bg-(--accent) px-4 py-2 text-[13px] font-medium text-(--accent-foreground) transition-[background-color,transform,opacity] duration-200 hover:bg-(--accent-hover) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {canRegister ? "Register and finish" : "Finish"}
              </button>
            )}
          </span>
        </div>
      </div>
    </OnboardShell>
  );
}

function OnboardShell({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[12px] border border-(--line) bg-(--panel) p-6 shadow-[0_2px_8px_rgba(0,0,0,0.45)] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-(--text)">{title}</h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-(--muted)">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] px-2 py-1 text-[16px] leading-none text-(--muted) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
