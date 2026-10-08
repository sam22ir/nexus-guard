import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { tierForProvider, remoteServiceUrl, remoteServiceScope, type Account, type Connection, type Project } from "../store";
import { accountGroupKey } from "../accounts";
import { Button } from "@heroui/react";
import { Badge, Empty, Icon as NxIcon, type Tone } from "../ui";
import { inputClass, selectClass } from "../app/styles";
import { Card } from "../app/common";
import { useAuditLog, timeAgo } from "../app/audit";

type Patch = { target: string; detail: string; tone: Connection["tone"]; projectRef?: string; url?: string; accountId?: string };

/** Project bindings as a list plus a detail panel for the selected one.
 *  Editing is inline; saving goes through the same confirm-with-diff step the
 *  old Edit modal used (paper §8: binding edits need developer confirmation). */
export function BindingsView({ project, projects, accounts, onAdd, onUpdate, savedKeys, onSaveKey, onRemove, onOpenServices }: {
  project: Project;
  projects: Project[];
  accounts: Account[];
  onAdd: () => void;
  onUpdate: (projectId: string, connectionId: string, patch: Patch) => void;
  savedKeys: Record<string, boolean>;
  onSaveKey: (connection: Connection) => void;
  onRemove: (connection: Connection) => void;
  onOpenServices?: () => void;
}) {
  const { entries } = useAuditLog(projects);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = filter.trim().toLowerCase();
  const visible = project.connections.filter((c) => !query || [c.provider, c.target, c.resource, c.accountId, c.account, c.environment, c.detail, c.authState, c.method].some((field) => (field ?? "").toLowerCase().includes(query)));
  const selected = project.connections.find((c) => c.id === selectedId) ?? visible[0] ?? project.connections[0] ?? null;

  const sharedWith = (connection: Connection) => {
    const key = accountGroupKey(connection.provider, connection);
    if (!key) return [] as Project[];
    return projects.filter((p) => p.id !== project.id && (p.connections ?? []).some((c) => accountGroupKey(c.provider, c) === key));
  };
  const dotColor = (connection: Connection) =>
    sharedWith(connection).length > 0 ? "var(--orange)" : connection.authState === "connected" ? "var(--green)" : "var(--muted-2)";

  return (
    <div className="app-view flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-(--muted)">Link an account once in Accounts, then bind one account and resource per project here. Never raw secrets.</p>
        <Button size="sm" onPress={onAdd}><NxIcon name="plus" size={15} />Add binding</Button>
      </div>

      {project.connections.length === 0 ? (
        <Card><Empty title="Nothing bound yet" action={<Button size="sm" onPress={onAdd}>Add the first binding</Button>}>Bind one account and resource so agents in this project reach the right service.</Empty></Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]" style={{ minHeight: 320 }}>
          <Card flush className="flex min-h-0 flex-col">
            <div className="shrink-0 px-4 pb-2 pt-4">
              <label className="flex items-center gap-2 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-2 text-(--muted)">
                <NxIcon name="search" size={15} />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter bindings" placeholder="Filter bindings" className="min-w-0 flex-1 bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted-2)" />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Bindings">
              {visible.map((connection) => (
                <button key={connection.id} type="button" role="option" aria-selected={selected?.id === connection.id} className="nx-row" data-active={selected?.id === connection.id} style={{ borderTop: "1px solid var(--line-soft)" }} onClick={() => setSelectedId(connection.id)}>
                  <span className="nx-tile text-[11px] font-semibold" aria-hidden="true">{connection.short}</span>
                  <span className="nx-row-body">
                    <span className="nx-row-title">{connection.provider}</span>
                    <span className="nx-row-sub nx-mono">{connection.resource ?? connection.target}</span>
                  </span>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: dotColor(connection), flexShrink: 0 }} />
                </button>
              ))}
              {visible.length === 0 && <Empty title="No bindings match that filter">Try a different word.</Empty>}
            </div>
            <p className="shrink-0 border-t border-(--line-soft) px-4 py-2.5 text-[11.5px] text-(--muted-2)">Amber: shared account · green: connected · grey: not verified</p>
          </Card>

          {selected && (
            <BindingDetail
              key={selected.id}
              project={project}
              connection={selected}
              accounts={accounts}
              shared={sharedWith(selected)}
              entries={entries}
              keySaved={selected.keySaved || savedKeys[selected.id]}
              onUpdate={onUpdate}
              onSaveKey={onSaveKey}
              onRemove={onRemove}
              onOpenServices={onOpenServices}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BindingDetail({ project, connection, accounts, shared, entries, keySaved, onUpdate, onSaveKey, onRemove, onOpenServices }: {
  project: Project;
  connection: Connection;
  accounts: Account[];
  shared: Project[];
  entries: { ts?: string | null; project?: string | null; project_id?: string | null; provider?: string | null; resource?: string | null; decision?: string | null }[];
  keySaved: boolean | undefined;
  onUpdate: (projectId: string, connectionId: string, patch: Patch) => void;
  onSaveKey: (connection: Connection) => void;
  onRemove: (connection: Connection) => void;
  onOpenServices?: () => void;
}) {
  const locked = connection.method === "mcp"; // browser-approved: ref and URL stay as issued
  const isSupabase = connection.provider === "Supabase";
  const matching = accounts.filter((a) => a.provider.toLowerCase() === connection.provider.toLowerCase());
  const startAccount = matching.some((a) => a.id === (connection.accountId ?? connection.account))
    ? (connection.accountId ?? connection.account ?? "")
    : (matching.find((a) => a.label === (connection.accountId ?? connection.account))?.id ?? "");
  const [accountId, setAccountId] = useState(startAccount);
  const [accountTouched, setAccountTouched] = useState(false);
  const [target, setTarget] = useState(connection.target);
  const [projectRef, setProjectRef] = useState(connection.projectRef ?? "");
  const [url, setUrl] = useState(connection.url ?? "");
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  // "Allow safe writes" for services signed in with the generic flow. Saved in the app's own
  // folder (not the project folder), so an agent cannot switch it on for itself.
  const isRemote = !!remoteServiceUrl(connection.provider) && connection.method === "mcp";
  const [writesOn, setWritesOn] = useState(false);
  const [writesBusy, setWritesBusy] = useState(false);
  const [writesError, setWritesError] = useState("");
  useEffect(() => {
    setWritesOn(false); setWritesError("");
    if (!isRemote || !desktopAvailable()) return;
    let cancelled = false;
    invoke<boolean>("get_write_grant", { projectId: project.id, connectionId: connection.id }).then((on) => { if (!cancelled) setWritesOn(on); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [connection.id, project.id, isRemote]);
  // Limit this binding to one project / site / base, for services that name one.
  const scopeSpec = isRemote ? remoteServiceScope(connection.provider) : null;
  const [limit, setLimit] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState("");
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState("");
  useEffect(() => {
    setLimit(null); setLimitDraft(""); setLimitError("");
    if (!scopeSpec || !desktopAvailable()) return;
    let cancelled = false;
    invoke<string | null>("get_binding_scope", { projectId: project.id, connectionId: connection.id }).then((value) => { if (!cancelled) { setLimit(value); setLimitDraft(value ?? ""); } }).catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, project.id, isRemote]);
  async function saveLimit(value: string | null) {
    setLimitBusy(true); setLimitError("");
    try {
      await invoke("set_binding_scope", { projectId: project.id, connectionId: connection.id, value });
      setLimit(value); setLimitDraft(value ?? "");
    } catch (error) {
      setLimitError(typeof error === "string" && error ? error : "Could not save this setting. Try again.");
    } finally {
      setLimitBusy(false);
    }
  }
  async function toggleWrites() {
    const next = !writesOn;
    if (next && !window.confirm(`Let agents make changes in ${connection.provider}?\n\nOnly actions ${connection.provider} labels as safe, non-destructive changes will run. Anything that deletes or may be destructive, and anything in production, is still refused.\n\nYou can switch this off at any time.`)) return;
    setWritesBusy(true); setWritesError("");
    try {
      await invoke("set_write_grant", { projectId: project.id, connectionId: connection.id, allowed: next });
      setWritesOn(next);
    } catch {
      setWritesError("Could not save this setting. Try again.");
    } finally {
      setWritesBusy(false);
    }
  }
  useEffect(() => { setAccountId(startAccount); setAccountTouched(false); setTarget(connection.target); setProjectRef(connection.projectRef ?? ""); setUrl(connection.url ?? ""); setTest(null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id]);

  const dirty = (accountTouched && accountId !== startAccount) || target.trim() !== connection.target || (!locked && isSupabase && (projectRef !== (connection.projectRef ?? "") || url !== (connection.url ?? "")));
  const canSave = dirty && target.trim().length > 0 && (!isSupabase || locked || (projectRef.trim().length > 0 && url.trim().length > 0));
  const tier = tierForProvider(connection.provider);
  const tierTone: Tone = tier === "native" ? "success" : tier === "curated" ? "info" : "warning";
  const connected = connection.authState === "connected";
  const stateLabel = connected ? "Connected" : connection.authState === "pending" ? "Pending" : keySaved ? "Key saved" : "Not verified";
  const stateTone: Tone = connected ? "success" : connection.authState === "pending" ? "warning" : keySaved ? "info" : "neutral";
  const resource = connection.resource ?? connection.target;

  const mine = useMemo(() => entries.filter((e) =>
    (e.project === project.name || (e.project_id != null && e.project_id === project.id)) &&
    e.provider?.toLowerCase() === connection.provider.toLowerCase() &&
    (!e.resource || e.resource === resource || e.resource === connection.target)), [entries, project, connection, resource]);
  const allowed = mine.filter((e) => e.decision === "allow").length;
  const blocked = mine.length - allowed;

  function save() {
    if (!canSave) return;
    onUpdate(project.id, connection.id, {
      target: target.trim(),
      detail: connection.detail,
      tone: connection.tone,
      projectRef: projectRef.trim() || undefined,
      url: url.trim() || undefined,
      accountId: accountTouched ? accountId : (connection.accountId ?? connection.account ?? ""),
    });
  }
  function discard() { setAccountId(startAccount); setAccountTouched(false); setTarget(connection.target); setProjectRef(connection.projectRef ?? ""); setUrl(connection.url ?? ""); }
  function copyRef() {
    if (!connection.projectRef || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(connection.projectRef).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  }
  async function runTest() {
    if (!desktopAvailable() || !connection.projectRef) return;
    setTesting(true); setTest(null);
    try {
      const answer = await invoke<{ name: string; status?: string | null; region?: string | null }>("verify_supabase_connection", { projectId: project.id, connectionId: connection.id, projectRef: connection.projectRef });
      setTest({ ok: true, text: `${answer.name}${answer.status ? ` · ${answer.status}` : ""}${answer.region ? ` · ${answer.region}` : ""}` });
    } catch {
      setTest({ ok: false, text: "Could not reach Supabase. Check your network connection, then try again." });
    } finally { setTesting(false); }
  }

  return (
    <Card flush className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pt-4">
        <span className="nx-tile text-[12px] font-semibold" style={{ width: 38, height: 38 }} aria-hidden="true">{connection.short}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="text-[15px] font-semibold text-(--text)">{connection.provider}</strong>
          <span className="truncate text-[12px] text-(--muted)">{connection.detail}</span>
        </span>
        <Badge tone={tierTone}>{tier}</Badge>
        <Badge tone={stateTone} dot>{stateLabel}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <label className="nx-field">
            Account
            <select className={selectClass} value={accountId} onChange={(e) => { setAccountId(e.target.value); setAccountTouched(true); }}>
              <option value="">Not linked</option>
              {matching.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
            </select>
            {matching.length === 0 && (
              <span className="flex flex-wrap items-center gap-2 text-[11.5px] leading-[1.5]">No {connection.provider} account linked yet.{onOpenServices && <button type="button" onClick={onOpenServices} className="underline underline-offset-2 hover:text-(--text)">Open Accounts</button>}</span>
            )}
          </label>
          <div className="nx-field">
            Environment
            <span className="flex h-10 items-center rounded-[10px] bg-(--raised) px-3 text-[13px] text-(--text)">{connection.environment ?? project.environment}</span>
          </div>
          <label className="nx-field sm:col-span-2">
            Resource
            {locked ? (
              <span className="flex min-h-10 items-center justify-between gap-3 rounded-[10px] bg-(--raised) px-3 py-2 text-[12.5px] text-(--text)">
                <span className="nx-mono min-w-0 truncate">{resource}</span>
                <span className="shrink-0 text-[11.5px] text-(--muted)">Approved in the browser. Remove and reconnect to change.</span>
              </span>
            ) : (
              <input className={`${inputClass} nx-mono`} value={target} onChange={(e) => setTarget(e.target.value)} />
            )}
          </label>
          {isSupabase && (locked ? (
            <div className="nx-field sm:col-span-2">
              Project reference
              <span className="flex min-h-10 items-center justify-between gap-3 rounded-[10px] bg-(--raised) px-3 py-2 text-[12.5px] text-(--text)">
                <span className="nx-mono min-w-0 truncate">{connection.projectRef}</span>
                <button type="button" onClick={copyRef} className="shrink-0 text-[12px] text-(--muted) underline underline-offset-2 hover:text-(--text)">{copied ? "Copied" : "Copy"}</button>
              </span>
            </div>
          ) : (
            <>
              <label className="nx-field">Project reference<input className={`${inputClass} nx-mono`} value={projectRef} onChange={(e) => setProjectRef(e.target.value)} /></label>
              <label className="nx-field">Project URL<input className={`${inputClass} nx-mono`} value={url} onChange={(e) => setUrl(e.target.value)} /></label>
            </>
          ))}
        </div>

        {dirty && (
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onPress={discard}>Discard</Button>
            <Button size="sm" isDisabled={!canSave} onPress={save}>Save changes</Button>
          </div>
        )}

        {shared.length > 0 && (
          <div className="mt-4 rounded-[12px] bg-(--orange-bg) px-4 py-3 text-[12.5px] leading-[1.55] text-(--orange)">
            This account is also bound by {shared.map((p) => p.name).join(", ")}. Sharing it widens what one credential can reach.
          </div>
        )}

        <div className="mt-4">
          {isSupabase && connection.projectRef && connection.url && (
            <div className="nx-row" style={{ borderTop: "1px solid var(--line-soft)", paddingInline: 0 }}>
              <span className="nx-tile"><NxIcon name="key" size={16} /></span>
              <span className="nx-row-body"><span className="nx-row-title">Publishable key</span><span className="nx-row-sub">{keySaved ? "Saved in your system keychain." : "Stays in your system keychain. Not saved yet."}</span></span>
              <Button size="sm" variant="outline" isDisabled={!desktopAvailable()} onPress={() => onSaveKey(connection)}>{!desktopAvailable() ? "Desktop only" : keySaved ? "Manage key" : "Save key"}</Button>
            </div>
          )}
          {isSupabase && connection.projectRef && (
            <div className="nx-row" style={{ borderTop: "1px solid var(--line-soft)", paddingInline: 0 }}>
              <span className="nx-tile"><NxIcon name="refresh" size={16} /></span>
              <span className="nx-row-body">
                <span className="nx-row-title">Test connection</span>
                <span className="nx-row-sub" style={test ? { color: test.ok ? "var(--green)" : "var(--red)", whiteSpace: "normal" } : undefined}>{test ? test.text : "Ask Supabase for this project through Nexus."}</span>
              </span>
              <Button size="sm" variant="outline" isDisabled={testing || !desktopAvailable()} onPress={() => void runTest()}>{testing ? "Testing…" : "Test"}</Button>
            </div>
          )}
          {isRemote && connected && scopeSpec && (
            <div className="nx-row" style={{ borderTop: "1px solid var(--line-soft)", paddingInline: 0, alignItems: "flex-start" }}>
              <span className="nx-tile"><NxIcon name="folder" size={16} /></span>
              <span className="nx-row-body">
                <span className="nx-row-title">Limit to one {scopeSpec.label}</span>
                <span className="nx-row-sub" style={{ whiteSpace: "normal", ...(limitError ? { color: "var(--red)" } : {}) }}>
                  {limitError || (limit
                    ? `Limited to ${scopeSpec.label} “${limit}”. Tools that cannot be limited to a ${scopeSpec.label} are refused.`
                    : `Not limited: agents can reach every ${scopeSpec.label} in this ${connection.provider} account.`)}
                  {!scopeSpec.verified && " Not yet checked against a live sign-in, so some tools may be refused until it is."}
                </span>
                <span className="mt-1.5 flex gap-2">
                  <input value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} placeholder={`${scopeSpec.label} name or id`} aria-label={`Limit to one ${scopeSpec.label}`} className={`${inputClass} nx-mono`} />
                  <Button size="sm" isDisabled={limitBusy || !desktopAvailable() || !limitDraft.trim() || limitDraft.trim() === (limit ?? "")} onPress={() => void saveLimit(limitDraft.trim())}>{limitBusy ? "Saving…" : "Save"}</Button>
                  {limit && <Button size="sm" variant="outline" isDisabled={limitBusy} onPress={() => void saveLimit(null)}>Remove limit</Button>}
                </span>
              </span>
            </div>
          )}
          {isRemote && connected && (
            <div className="nx-row" style={{ borderTop: "1px solid var(--line-soft)", paddingInline: 0 }}>
              <span className="nx-tile"><NxIcon name="shield" size={16} /></span>
              <span className="nx-row-body">
                <span className="nx-row-title">Allow safe writes</span>
                <span className="nx-row-sub" style={{ whiteSpace: "normal", ...(writesError ? { color: "var(--red)" } : {}) }}>
                  {writesError || (writesOn
                    ? `On. Agents can run changes ${connection.provider} labels as safe. Deleting or unlabelled actions and anything in production stay refused.`
                    : `Off. Agents can read ${connection.provider} but cannot change anything.`)}
                </span>
              </span>
              <Button size="sm" variant={writesOn ? "primary" : "outline"} isDisabled={writesBusy || !desktopAvailable()} onPress={() => void toggleWrites()} aria-pressed={writesOn}>{writesBusy ? "Saving…" : writesOn ? "Turn off" : "Turn on"}</Button>
            </div>
          )}
          <div className="nx-row" style={{ borderTop: "1px solid var(--line-soft)", paddingInline: 0 }}>
            <span className="nx-tile"><NxIcon name="activity" size={16} /></span>
            <span className="nx-row-body">
              <span className="nx-row-title">Recent calls on this binding</span>
              <span className="nx-row-sub">{mine.length === 0 ? "No calls yet." : `${allowed} allowed · ${blocked} blocked · last ${timeAgo(mine[mine.length - 1].ts)}`}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--line-soft) px-5 py-3">
        <span className="text-[12px] text-(--muted)">Removing it cuts agents off from this resource.</span>
        <Button size="sm" variant="danger-soft" onPress={() => onRemove(connection)}>Remove binding</Button>
      </div>
    </Card>
  );
}

