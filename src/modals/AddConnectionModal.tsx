import { useEffect, useRef, useState } from "react";
import { tierForProvider, PROVIDER_CATALOG, type Account, type Connection, type Project } from "../store";
import { Button } from "@heroui/react";
import { Segmented } from "../ui";
import { inputClass, selectClass } from "../app/styles";
import { Modal } from "../app/common";

type SaveInput = { provider: string; target: string; detail: string; tone: Connection["tone"]; method: Connection["method"]; authState: Connection["authState"]; projectRef?: string; url?: string; accountId?: string };
type PickedProject = { ref: string; name: string; region?: string | null };

/** What a service provides, and its tint, come from the catalog, not from the
 *  developer: they were free-text and color fields that carried no meaning. */
function defaultsFor(provider: string): { detail: string; tone: Connection["tone"] } {
  const tags = PROVIDER_CATALOG.find((entry) => entry.provider.toLowerCase() === provider.toLowerCase())?.tags ?? [];
  return { detail: tags.length ? tags.join(" · ") : "Resource", tone: provider === "Supabase" ? "green" : provider === "Clerk" ? "violet" : "blue" };
}

/** Bind one account and resource to a project. Supabase defaults to browser
 *  approval then a project pick; every other service is a short manual form. */
export function AddConnectionModal({ initialProvider, initialAccountId, projectId, projectName, environment, projects, accounts, onClose, onSave, onAuthorizeMcp, onConfirmMcp, onCancelMcp, onAbortMcp, onOpenServices }: {
  projectId: string;
  projectName: string;
  environment?: string;
  projects: Project[];
  initialProvider?: string;
  initialAccountId?: string;
  accounts: Account[];
  onClose: () => void;
  onSave: (input: SaveInput) => void;
  onAuthorizeMcp: (detail: string, accountId?: string) => Promise<{ connectionId: string; projects: PickedProject[]; listError?: string }>;
  onConfirmMcp: (projectId: string, connectionId: string, choice: PickedProject) => void;
  onCancelMcp: (projectId: string, connectionId: string) => void;
  onAbortMcp: () => void;
  onOpenServices?: () => void;
}) {
  const [provider, setProvider] = useState(initialProvider ?? "Supabase");
  const [method, setMethod] = useState<"manual" | "mcp">((initialProvider ?? "Supabase") === "Supabase" ? "mcp" : "manual");
  const [target, setTarget] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mcpPhase, setMcpPhase] = useState<"auth" | "pick">("auth");
  const [mcpConnectionId, setMcpConnectionId] = useState("");
  const [mcpProjects, setMcpProjects] = useState<PickedProject[]>([]);
  const [mcpListError, setMcpListError] = useState("");
  const [pickedRef, setPickedRef] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  // Unmount/close guards: never setState on a closed modal, and never leave
  // the browser-approval poll running without a modal to report back to.
  const cancelledRef = useRef(false);
  const authInFlight = useRef(false);
  const abortRef = useRef(onAbortMcp);
  abortRef.current = onAbortMcp;
  useEffect(() => {
    cancelledRef.current = false; // StrictMode runs the cleanup once on mount; re-arm on the real mount
    return () => {
      cancelledRef.current = true;
      if (authInFlight.current) abortRef.current();
    };
  }, []);

  const matchingAccounts = accounts.filter((a) => a.provider.toLowerCase() === provider.toLowerCase());
  const [accountId, setAccountId] = useState(() => (initialAccountId && matchingAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : matchingAccounts[0]?.id ?? ""));
  // A selected id that no longer exists falls back instead of submitting a stale id.
  useEffect(() => {
    if (accountId && !matchingAccounts.some((a) => a.id === accountId)) setAccountId(matchingAccounts[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, provider]);

  const isSupabase = provider === "Supabase";
  const providerTier = provider.trim() ? tierForProvider(provider) : "self-added";
  const [selfAddedConfirm, setSelfAddedConfirm] = useState(false);
  useEffect(() => { setSelfAddedConfirm(false); }, [provider]);
  const sharedWith = accountId
    ? projects.filter((p) => p.id !== projectId && (p.connections ?? []).some((c) => c.provider.toLowerCase() === provider.toLowerCase() && (c.accountId ?? c.account) === accountId))
    : [];
  const canSaveManual = provider.trim().length > 0 && target.trim().length > 0 && (!isSupabase || (projectRef.trim().length > 0 && url.trim().length > 0)) && (providerTier !== "self-added" || selfAddedConfirm);
  const picking = method === "mcp" && mcpPhase === "pick";
  const services = Array.from(new Set([...PROVIDER_CATALOG.map((p) => p.provider), ...accounts.map((a) => a.provider), "Other"]));

  function changeProvider(next: string) {
    setProvider(next);
    setMethod(next === "Supabase" ? "mcp" : "manual");
    setMcpPhase("auth");
    setError("");
    setAccountId(accounts.find((a) => a.provider.toLowerCase() === next.toLowerCase())?.id ?? "");
  }

  function saveManual() {
    const { detail, tone } = defaultsFor(provider.trim());
    onSave({ provider: provider.trim(), target: target.trim(), detail, tone, method: "manual", authState: "not_connected", projectRef: projectRef.trim() || undefined, url: url.trim() || undefined, accountId: accountId || undefined });
  }

  async function authorize() {
    setBusy(true); setError(""); setMcpListError("");
    authInFlight.current = true;
    try {
      const { connectionId, projects: found, listError } = await onAuthorizeMcp(defaultsFor("Supabase").detail, accountId || undefined);
      if (cancelledRef.current) return;
      setMcpConnectionId(connectionId);
      setMcpProjects(found);
      setMcpListError(listError ?? "");
      setPickedRef(found.length === 1 ? found[0].ref : "");
      setManualEntry(found.length === 0);
      setMcpPhase("pick");
    } catch (caught) {
      if (cancelledRef.current) return;
      // An abort-driven cancel already cleaned up the pending connection; not a failure.
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError("Could not start the connection. Check your network connection and try again.");
    } finally {
      authInFlight.current = false;
      if (!cancelledRef.current) setBusy(false);
    }
  }

  function cancelAuthorize() {
    if (mcpConnectionId) onCancelMcp(projectId, mcpConnectionId);
    onClose();
  }
  // Closing mid-approval must abort the poll so App removes the pending connection.
  function closeWhileAuthorizing() {
    onAbortMcp();
    onClose();
  }
  function confirmPick() {
    if (manualEntry || pickedRef.startsWith("manual:")) {
      const ref = projectRef.trim();
      if (!ref) { setError("Enter the project reference."); return; }
      onConfirmMcp(projectId, mcpConnectionId, { ref, name: target.trim() || ref });
      return;
    }
    const choice = mcpProjects.find((p) => p.ref === pickedRef);
    if (!choice) { setError("Choose one of your Supabase projects."); return; }
    onConfirmMcp(projectId, mcpConnectionId, choice);
  }

  const onModalClose = method === "mcp" ? (mcpPhase === "pick" ? cancelAuthorize : (busy ? closeWhileAuthorizing : onClose)) : onClose;
  const canConfirmPick = !busy && (manualEntry || pickedRef.startsWith("manual:") ? projectRef.trim().length > 0 && target.trim().length > 0 : pickedRef.length > 0);
  const env = environment ?? "development";

  return (
    <Modal
      title={picking ? "Pick your Supabase project" : `Add a binding to ${projectName}`}
      description={picking ? `Approval saved. Which project belongs to ${projectName}?` : "Bind one account and resource so agents here reach the right service."}
      onClose={onModalClose}
    >
      <div className="flex flex-col gap-3">
        {!picking && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="nx-field">
                Service
                <select value={provider} onChange={(e) => changeProvider(e.target.value)} className={selectClass}>
                  {services.map((service) => <option key={service} value={service}>{service}</option>)}
                </select>
              </label>
              <label className="nx-field">
                Account
                {matchingAccounts.length === 0 ? (
                  <span className="flex min-h-10 items-center rounded-[10px] bg-(--raised) px-3 text-[12px] text-(--muted)">None linked yet</span>
                ) : (
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
                    <option value="">Select an account…</option>
                    {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
                  </select>
                )}
              </label>
            </div>
            {matchingAccounts.length === 0 && (
              <p className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.5] text-(--muted)">
                Link a {provider} account under Services first, then pick it here. Saving now stores the binding without one.
                {onOpenServices && <Button size="sm" variant="outline" onPress={onOpenServices}>Open Services</Button>}
              </p>
            )}
            {sharedWith.length > 0 && (
              <div className="rounded-[10px] bg-(--orange-bg) px-3 py-2 text-[12px] leading-[1.5] text-(--orange)">This account is also bound by {sharedWith.map((p) => p.name).join(", ")}. Sharing it widens what one credential can reach.</div>
            )}
          </>
        )}

        {isSupabase && !picking && (
          <Segmented label="How to connect" value={method} onChange={(value) => { setMethod(value); setError(""); }} options={[{ value: "mcp", label: "Browser approval" }, { value: "manual", label: "Enter details" }]} />
        )}

        {method === "mcp" && mcpPhase === "auth" && (
          <div className="rounded-[12px] border border-(--line) px-3.5 py-3 text-[12.5px] leading-[1.7] text-(--muted)">
            <p className="text-(--text)">Nexus opens Supabase in your browser.</p>
            <ol className="mt-1 list-decimal pl-5">
              <li>Sign in to Supabase</li>
              <li>Approve Nexus access</li>
              <li>Pick your project here. Ref and URL fill in by themselves.</li>
            </ol>
          </div>
        )}

        {method === "manual" && (
          <div className="flex flex-col gap-3">
            <label className="nx-field">
              Resource
              <input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus placeholder={isSupabase ? "nabdh-development" : "nabdh-auth"} className={`${inputClass} nx-mono`} />
              <span className="text-[11.5px] text-(--muted-2)">{isSupabase ? "A name for this Supabase project." : `The ${provider} instance this project uses.`}</span>
            </label>
            {isSupabase && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="nx-field">Project reference<input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="abcdefghijklmnop" className={`${inputClass} nx-mono`} /></label>
                <label className="nx-field">Project URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://….supabase.co" className={`${inputClass} nx-mono`} /></label>
              </div>
            )}
            {providerTier === "self-added" && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-(--raised) p-3 text-[12px] leading-[1.55] text-(--muted)">
                <input type="checkbox" checked={selfAddedConfirm} onChange={(e) => setSelfAddedConfirm(e.target.checked)} className="mt-1 accent-(--text)" />
                <span>“{provider}” is unreviewed and fail-closed. Agents get nothing from this binding until I explicitly allow calls.</span>
              </label>
            )}
          </div>
        )}

        {picking && (
          <>
            {mcpListError && <p className="text-[12px] text-(--red)" role="alert">{mcpListError} Enter the details manually. Your approval is still saved.</p>}
            {mcpProjects.length > 0 && (
              <div className="max-h-[260px] overflow-y-auto rounded-[12px] border border-(--line)" role="radiogroup" aria-label="Supabase project">
                {mcpProjects.map((p, index) => (
                  <label key={p.ref} className="flex cursor-pointer items-center gap-3 px-3 py-2.5" style={{ ...(index > 0 ? { borderTop: "1px solid var(--line-soft)" } : {}), ...(pickedRef === p.ref ? { background: "var(--raised)" } : {}) }}>
                    <input type="radio" name="supabase-project" value={p.ref} checked={pickedRef === p.ref} onChange={(e) => { setPickedRef(e.target.value); setManualEntry(false); }} className="accent-(--text)" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <strong className="text-[13px] font-medium text-(--text)">{p.name}</strong>
                      <span className="nx-mono text-(--muted)">{p.ref}{p.region ? ` · ${p.region}` : ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {mcpProjects.length === 0 && <p className="text-[12.5px] text-(--muted)">No projects came back from Supabase. Enter the details manually instead.</p>}
            {(mcpProjects.length === 0 || manualEntry) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="nx-field">Project reference<input value={projectRef} onChange={(e) => { setProjectRef(e.target.value); setPickedRef(`manual:${e.target.value}`); }} placeholder="abcdefghijklmnop" className={`${inputClass} nx-mono`} /></label>
                <label className="nx-field">Display name<input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="nabdh-development" className={`${inputClass} nx-mono`} /></label>
              </div>
            )}
            {mcpProjects.length > 0 && !manualEntry && (
              <button type="button" onClick={() => setManualEntry(true)} className="self-start text-[12px] text-(--muted) underline underline-offset-2 hover:text-(--text)">Can&apos;t find it? Enter the details manually</button>
            )}
          </>
        )}

        {!picking && <p className="text-[12px] text-(--muted)">Environment: <span className="text-(--text)">{env}</span> (from this project)</p>}
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-(--line-soft) pt-3">
          {picking ? (
            <>
              <Button size="sm" variant="outline" isDisabled={busy} onPress={cancelAuthorize}>Cancel</Button>
              <Button size="sm" isDisabled={!canConfirmPick} onPress={confirmPick}>{busy ? "Linking…" : "Link this project"}</Button>
            </>
          ) : method === "mcp" ? (
            <>
              <Button size="sm" variant="outline" onPress={busy ? closeWhileAuthorizing : onClose}>Cancel</Button>
              <Button size="sm" isDisabled={busy} onPress={() => void authorize()}>{busy ? "Waiting for browser…" : "Connect in browser"}</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" isDisabled={busy} onPress={onClose}>Cancel</Button>
              <Button size="sm" isDisabled={!canSaveManual || busy} onPress={saveManual}>Add binding</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
