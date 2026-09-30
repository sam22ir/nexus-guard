import { useEffect, useRef, useState } from "react";
import { tierForProvider, type Account, type Connection, PROVIDER_CATALOG } from "../store";
import { primaryBtn, secondaryBtn, smallBtn, ghostLink, inputClass, selectClass } from "../app/styles";
import { Note, Modal } from "../app/common";

export function AddConnectionModal({ initialProvider, initialAccountId, projectId, projectName, accounts, onClose, onSave, onAuthorizeMcp, onConfirmMcp, onCancelMcp, onAbortMcp, onOpenServices }: { projectId: string; initialProvider?: string; initialAccountId?: string; projectName: string; accounts: Account[]; onClose: () => void; onSave: (input: { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string; accountId?: string }) => void; onAuthorizeMcp: (detail: string, accountId?: string) => Promise<{ connectionId: string; projects: { ref: string; name: string; region?: string | null }[]; listError?: string }>; onConfirmMcp: (projectId: string, connectionId: string, choice: { ref: string; name: string; region?: string | null }) => void; onCancelMcp: (projectId: string, connectionId: string) => void; onAbortMcp: () => void; onOpenServices?: () => void }) {
  const [provider, setProvider] = useState(initialProvider ?? "Supabase");
  const [method, setMethod] = useState<"choose" | "manual" | "mcp">("choose");
  const [target, setTarget] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [url, setUrl] = useState("");
  const [detail, setDetail] = useState("Database and services");
  const [tone, setTone] = useState<Connection["tone"]>("green");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mcpPhase, setMcpPhase] = useState<"auth" | "pick">("auth");
  const [mcpConnectionId, setMcpConnectionId] = useState("");
  const [mcpProjects, setMcpProjects] = useState<{ ref: string; name: string; region?: string | null }[]>([]);
  const [mcpListError, setMcpListError] = useState("");
  const [pickedRef, setPickedRef] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  // Unmount/close guards: never setState on a closed modal, and never leave
  // the browser-approval poll running without a modal to report back to.
  const cancelledRef = useRef(false);
  const authInFlight = useRef(false);
  const abortRef = useRef(onAbortMcp);
  abortRef.current = onAbortMcp;
  useEffect(() => () => {
    cancelledRef.current = true;
    if (authInFlight.current) abortRef.current();
  }, []);
  const matchingAccounts = accounts.filter((a) => a.provider.toLowerCase() === provider.toLowerCase());
  const [accountId, setAccountId] = useState(() => (initialAccountId && matchingAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : matchingAccounts[0]?.id ?? ""));
  // Re-sync when the registry changes under an open modal: a selected id
  // that no longer exists falls back instead of submitting a stale id. A
  // blank (unlinked) choice is always kept as-is.
  useEffect(() => {
    if (accountId && !matchingAccounts.some((a) => a.id === accountId)) {
      setAccountId(matchingAccounts[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, provider]);
  const isSupabase = provider === "Supabase";
  // Paper: an "Other" (self-added) service needs an explicit 2-step confirm —
  // fail-closed restated, explicit confirm click before manual save.
  const providerTier = provider.trim() ? tierForProvider(provider) : "self-added";
  const [selfAddedConfirm, setSelfAddedConfirm] = useState(false);
  useEffect(() => { setSelfAddedConfirm(false); }, [provider]);
  // An account is optional: saving without one stores the binding unlinked,
  // and the confirm step warns so it can be linked later under Bindings.
  const canSaveManual = provider.trim().length > 0 && target.trim().length > 0 && (!isSupabase || (projectRef.trim().length > 0 && url.trim().length > 0)) && (providerTier !== "self-added" || selfAddedConfirm);

  function changeProvider(nextProvider: string) {
    setProvider(nextProvider);
    const first = accounts.find((a) => a.provider.toLowerCase() === nextProvider.toLowerCase());
    setAccountId(first?.id ?? "");
    if (nextProvider !== "Supabase") {
      setDetail(nextProvider === "Clerk" ? "Authentication" : "Resource");
      setTone(nextProvider === "Clerk" ? "violet" : "blue");
    } else {
      setDetail("Database and services");
      setTone("green");
    }
  }

  function saveManual() {
    onSave({ provider: provider.trim(), target: target.trim(), detail: detail.trim(), tone, method: "manual", authState: "not_connected", projectRef: projectRef.trim() || undefined, url: url.trim() || undefined, accountId: accountId || undefined });
  }

  async function authorize() {
    setBusy(true); setError(""); setMcpListError("");
    authInFlight.current = true;
    try {
      const { connectionId, projects, listError } = await onAuthorizeMcp(detail, accountId || undefined);
      if (cancelledRef.current) return;
      setMcpConnectionId(connectionId);
      setMcpProjects(projects);
      setMcpListError(listError ?? "");
      setPickedRef(projects.length === 1 ? projects[0].ref : "");
      setManualEntry(projects.length === 0);
      setMcpPhase("pick");
    } catch (caught) {
      if (cancelledRef.current) return;
      // Abort-driven cancel already cleaned up the pending connection; don't
      // surface it as a failure.
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError("Could not start the connection. Check your network connection and try again.");
    }
    finally {
      authInFlight.current = false;
      if (!cancelledRef.current) setBusy(false);
    }
  }

  function cancelAuthorize() {
    if (mcpConnectionId) onCancelMcp(projectId, mcpConnectionId);
    onClose();
  }

  // Closing mid-approval must run the cancel path: abort the poll (App
  // removes the pending connection) instead of stranding it as "pending".
  function closeWhileAuthorizing() {
    onAbortMcp();
    onClose();
  }

  function confirmPick() {
    const choice = mcpProjects.find((p) => p.ref === pickedRef);
    if (!choice) { setError("Choose one of your Supabase projects."); return; }
    onConfirmMcp(projectId, mcpConnectionId, choice);
  }

  const services = Array.from(new Set([...PROVIDER_CATALOG.map((p) => p.provider), ...accounts.map((a) => a.provider), "Other"]));
  const tones = ["green", "violet", "blue", "orange"] as const;

  return (
    <Modal title={`Add a connection to ${projectName}`} description="Choose how Nexus should connect to this service." onClose={method === "mcp" ? (mcpPhase === "pick" ? cancelAuthorize : (busy ? closeWhileAuthorizing : onClose)) : onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Service</span>
          <select value={provider} onChange={(e) => changeProvider(e.target.value)} disabled={method === "mcp" && mcpPhase === "pick"} className={selectClass}>
            {services.map((service) => <option key={service} value={service}>{service}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Account (from Services)</span>
          {matchingAccounts.length === 0 ? (
            <small className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.6] text-(--muted)">
              <span>No {provider} account linked yet — link one under Services first, then pick it here. Saving now stores the binding without an account.</span>
              {onOpenServices && <button type="button" onClick={onOpenServices} className={smallBtn}>Open Services</button>}
            </small>
          ) : (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={method === "mcp" && mcpPhase === "pick"} className={selectClass}>
              <option value="">Select an account…</option>
              {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
            </select>
          )}
        </label>
        {method === "choose" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMethod("manual")}
              className="flex min-h-[150px] cursor-pointer flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--panel) p-4 text-left transition-[transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
            >
              <strong className="text-[13px] font-semibold">Add manually</strong>
              <small className="text-[12px] leading-[1.6] text-(--muted)">Enter the project details and save a key in the desktop vault.</small>
              <span className="mt-auto pt-2 text-[12px] font-semibold">Choose manual →</span>
            </button>
            {provider === "Supabase" ? (
              <button
                type="button"
                onClick={() => setMethod("mcp")}
                className="flex min-h-[150px] cursor-pointer flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--panel) p-4 text-left transition-[transform,opacity] duration-200 hover:-translate-y-0.5 hover:border-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)"
              >
                <strong className="text-[13px] font-semibold">Connect with MCP</strong>
                <small className="text-[12px] leading-[1.6] text-(--muted)">Sign in in your browser, pick your project, done. No typing refs or URLs.</small>
                <span className="mt-auto pt-2 text-[12px] font-semibold">Choose MCP →</span>
              </button>
            ) : (
              <div className="flex min-h-[150px] flex-col items-start gap-2 rounded-[10px] border border-(--line) bg-(--canvas) p-4 opacity-70">
                <strong className="text-[13px] font-semibold">Connect with MCP</strong>
                <small className="text-[12px] leading-[1.6] text-(--muted)">Browser approval is Supabase-only for now. {provider} saves as manual details.</small>
              </div>
            )}
          </div>
        )}
        {method === "manual" && (
          <>
            <button type="button" onClick={() => setMethod("choose")} className={ghostLink} style={{ alignSelf: "flex-start" }}>← Choose another method</button>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">{isSupabase ? "Display name" : "Project or account name"}</span>
              <input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus placeholder={isSupabase ? "koupa-development" : "For example, koupa-auth"} className={inputClass} required />
            </label>
            {isSupabase && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project reference</span>
                  <input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="abcdefghijklmnop" className={inputClass} required />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project URL</span>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://...supabase.co" className={inputClass} required />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">What it provides</span>
                <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Database · Auth" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-(--text)">Color</span>
                <select value={tone} onChange={(e) => setTone(e.target.value as Connection["tone"])} className={selectClass}>
                  {tones.map((toneOption) => <option key={toneOption} value={toneOption}>{toneOption[0].toUpperCase() + toneOption.slice(1)}</option>)}
                </select>
              </label>
            </div>
            <Note>Only project details are saved now. Secret keys are never saved in the browser.</Note>
            {providerTier === "self-added" && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-(--line) bg-(--canvas) p-3 text-[12px] leading-[1.6] text-(--muted)">
                <input type="checkbox" checked={selfAddedConfirm} onChange={(e) => setSelfAddedConfirm(e.target.checked)} className="mt-1 accent-(--text)" />
                <span>“{provider}” is unreviewed and fail-closed — agents get nothing from this binding until I explicitly allow calls.</span>
              </label>
            )}
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button>
              <button type="button" onClick={saveManual} disabled={!canSaveManual || busy} className={primaryBtn}>Save project details</button>
            </div>
          </>
        )}
        {method === "mcp" && mcpPhase === "auth" && (
          <>
            <button type="button" onClick={() => setMethod("choose")} className={ghostLink} style={{ alignSelf: "flex-start" }}>← Choose another method</button>
            <div className="rounded-[8px] border border-(--line) bg-(--canvas) p-4 text-[12px] leading-[1.6] text-(--muted)">
              <p className="mb-1 text-[13px] font-semibold text-(--text)">Browser approval</p>
              <p>Click below. Nexus opens Supabase in your browser — sign in, approve, then pick which of <em>your</em> projects links to {projectName}. Ref and URL fill in by themselves.</p>
              <ol className="mt-2 list-decimal pl-5 tabular-nums">
                <li>Sign in to Supabase</li>
                <li>Approve Nexus access</li>
                <li>Pick your project here</li>
              </ol>
            </div>
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={busy ? closeWhileAuthorizing : onClose} className={secondaryBtn}>Cancel</button>
              <button type="button" onClick={() => void authorize()} disabled={busy} className={primaryBtn}>{busy ? "Waiting for browser…" : "Connect in browser"}</button>
            </div>
          </>
        )}
        {method === "mcp" && mcpPhase === "pick" && (
          <>
            <div className="rounded-[8px] border border-(--line) bg-(--canvas) p-4 text-[12px] leading-[1.6] text-(--muted)">
              <p className="mb-1 text-[13px] font-semibold text-(--text)">Pick your Supabase project</p>
              <p>Approval saved. Which project belongs to {projectName}?</p>
            </div>
            {mcpListError && <p className="text-[12px] text-(--red)" role="alert">{mcpListError} Enter the details manually — your approval is still saved.</p>}
            {mcpProjects.length === 0 ? (
              <Note>No projects came back from Supabase. Enter the details manually instead.</Note>
            ) : (
              <fieldset>
                <legend className="sr-only">Supabase project</legend>
                <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
                  {mcpProjects.map((p) => (
                    <label key={p.ref} className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-(--line) px-3 py-2.5 transition-[transform,opacity] duration-200 hover:-translate-y-px" style={pickedRef === p.ref ? { borderColor: "var(--text)" } : undefined}>
                      <input type="radio" name="supabase-project" value={p.ref} checked={pickedRef === p.ref} onChange={(e) => setPickedRef(e.target.value)} className="accent-(--text)" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <strong className="text-[13px] font-semibold text-(--text)">{p.name}</strong>
                        <small className="text-[11px] tabular-nums text-(--muted)">{p.ref}{p.region ? ` · ${p.region}` : ""}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(mcpProjects.length === 0 || manualEntry) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Project reference</span>
                  <input value={projectRef} onChange={(e) => { setProjectRef(e.target.value); setPickedRef(`manual:${e.target.value}`); }} placeholder="abcdefghijklmnop" className={inputClass} required />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-(--text)">Display name</span>
                  <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="koupa-development" className={inputClass} required />
                </label>
              </div>
            )}
            {mcpProjects.length > 0 && !manualEntry && <button type="button" onClick={() => setManualEntry(true)} className={ghostLink} style={{ alignSelf: "flex-start" }}>Can&apos;t find it? Enter details manually</button>}
            {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
              <button type="button" onClick={cancelAuthorize} disabled={busy} className={secondaryBtn}>Cancel</button>
              <button
                type="button"
                onClick={() => {
                  if (manualEntry || pickedRef.startsWith("manual:")) {
                    const ref = projectRef.trim(); const displayName = target.trim() || ref;
                    if (!ref) { setError("Enter the project reference."); return; }
                    onConfirmMcp(projectId, mcpConnectionId, { ref, name: displayName });
                  } else confirmPick();
                }}
                disabled={busy || (!pickedRef && !(manualEntry && projectRef.trim() && target.trim()))}
                className={primaryBtn}
              >
                {busy ? "Linking…" : "Link this project"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
