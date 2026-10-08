import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { CENTRAL_TABLE, VOCAB, resolveOverride } from "../guard";
import { secondaryBtn, selectClass, badgeStyle } from "../app/styles";
import { PageTitle, Card, CardHeading, Note } from "../app/common";
import { useAuditLog, AuditRow } from "../app/audit";

export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[10px] border border-(--line) bg-(--panel) p-5 transition-[transform,opacity] duration-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-(--muted-2)">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-(--text)">{value}</p>
      <p className="mt-1.5 text-[12px] tabular-nums text-(--muted)">{detail}</p>
    </div>
  );
}

export function GuardView({ projects, onSetOverride }: { projects: Project[]; onSetOverride: (projectId: string, connectionId: string, override: string | null) => void }) {
  const { entries, loaded, busy, refresh } = useAuditLog(projects);
  const desktop = desktopAvailable();
  const allowed = entries.filter((e) => e.decision === "allow").length;
  const blocked = entries.filter((e) => e.decision === "block").length;
  const approvals = entries.filter((e) => e.decision === "approval_required").length;
  const recentBlocks = entries.filter((e) => e.decision !== "allow").slice(-5).reverse();
  const exampleOverride = resolveOverride({ serviceOverride: null, tagOverride: null, default: "review-each-time" });
  const vocabHelp: Record<string, string> = {
    read: "Reads, metadata",
    write: "Mutating writes",
    destructive: "Deletes, drops, revocations",
    sensitive: "Secrets, tokens, credentials",
  };
  return (
    <div className="app-view flex w-full min-h-0 flex-1 flex-col gap-4 overflow-visible">
      <PageTitle
        eyebrow="Monitor"
        title="Guard rules"
        description="Reads go through fast; writes and destructive actions are denied, and are refused in production. Per-binding rules are hidden in this build — values below are read-only."
        action={<button type="button" onClick={() => void refresh()} disabled={busy} className={secondaryBtn}>{busy ? "Refreshing…" : "Refresh"}</button>}
      />
      <div className="grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Allowed" value={loaded ? String(allowed) : "…"} detail="Low-risk reads via Nexus" />
        <Metric label="Blocked" value={loaded ? String(blocked) : "…"} detail="Writes · mismatches" />
        <Metric label="Denied" value={loaded ? String(approvals) : "…"} detail="Denied — expired or revoked auth" />
        <Metric label="Sessions seen" value={loaded ? String(new Set(entries.map((e) => e.session ?? "?")).size) : "…"} detail="Server-held sessions" />
      </div>
      <div className="app-columns flex min-h-0 flex-1 flex-col gap-6 overflow-visible lg:grid lg:grid-cols-2">
      <div className="app-column flex min-h-0 flex-col gap-6 overflow-visible lg:h-full">
      <details className="nx-card shrink-0 !py-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">How Guard classifies calls (reference)</summary>
        <div className="max-h-[30vh] overflow-y-auto pt-2">
        <ul className="divide-y divide-(--line-soft)">
          {VOCAB.map((term) => (
            <li key={term} className="flex items-center gap-4 py-3">
              <span className="w-28 shrink-0 rounded-full px-2.5 py-1 text-center text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(term === "read" ? "green" : term === "write" ? "pending" : "red")}>
                {term}
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                {vocabHelp[term]}
                <small className="block text-[12px] font-normal tabular-nums text-(--muted)">
                  dev: {CENTRAL_TABLE[`${term}:development`]} · test: {CENTRAL_TABLE[`${term}:test`]} · staging: {CENTRAL_TABLE[`${term}:staging`]} · prod: {CENTRAL_TABLE[`${term}:production`]}
                </small>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-[1.6] text-(--muted)">Unmapped terms fail closed to denied — never silently allowed.</p>
        </div>
      </details>
      <Card className="flex max-h-[620px] min-h-[360px] flex-col overflow-hidden">
        <CardHeading eyebrow="Per-binding rules" title="Service rules — most specific wins" />
        <p className="mb-2 shrink-0 text-[12px] leading-[1.6] text-(--muted)">Hidden in this build — rule selects are disabled and write nothing. Values below are what is stored.</p>
        <ul className="min-h-0 flex-1 divide-y divide-(--line-soft) overflow-y-auto">
          {projects.flatMap((item) => (item.connections ?? []).map((connection) => ({ item, connection }))).map(({ item, connection }) => {
            const current = connection.serviceOverride ?? connection.override ?? "";
            const effective = resolveOverride({ serviceOverride: current || null, tagOverride: connection.tagOverride ?? null, default: "review-each-time" });
            return (
              <li key={connection.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text)">
                  {item.name} · {connection.provider} → {connection.resource ?? connection.target}
                  <small className="block text-[12px] font-normal tabular-nums text-(--muted)">
                    now: {effective.override === "auto-approve" ? "allowed without asking (still logged)" : effective.override === "always-block" ? "refused — stays connected" : "asks each time"}
                  </small>
                </span>
                <select
                  value={current}
                  onChange={(e) => onSetOverride(item.id, connection.id, e.target.value || null)}
                  disabled
                  title="Guard rules are hidden in this build"
                  aria-label={`Rule for ${item.name} ${connection.provider} (read-only)`}
                  className={selectClass}
                  style={{ maxWidth: 220 }}
                >
                  <option value="">Ask each time (default)</option>
                  <option value="auto-approve">Allow without asking</option>
                  <option value="review-each-time">Ask each time</option>
                  <option value="always-block">Always refuse</option>
                </select>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 shrink-0 text-[12px] leading-[1.6] text-(--muted)">
          Refusing never disconnects the binding — it just says no to that one call. Allowing without asking still writes every call to the audit log. Source: service rule beats tag and default rules.
        </p>
      </Card>
      </div>
      <div className="app-column flex min-h-0 flex-col gap-6 overflow-visible lg:h-full">
      <details className="nx-card shrink-0 !py-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-(--text)">How overrides resolve (reference)</summary>
        <div className="max-h-[30vh] overflow-y-auto pt-2">
        <ol className="divide-y divide-(--line-soft)">
          {(["service", "tag", "default"] as const).map((level, i) => (
            <li key={level} className="flex items-center gap-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--raised) text-[11px] font-semibold tabular-nums text-(--muted)">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[13px] font-medium capitalize text-(--text)">
                {level}
                <small className="block text-[12px] font-normal normal-case tabular-nums text-(--muted)">
                  {level === "service" ? "Highest precedence — one service only" : level === "tag" ? "Middle — a group of services" : `Fallback — currently ${exampleOverride.override} → ${exampleOverride.decision}`}
                </small>
              </span>
              {level === "default" && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle("default")}>
                  {exampleOverride.override}
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-[1.6] text-(--muted)">
          A block decision never tears down the connection. Auto-approve is still audited. Source: {exampleOverride.source}.
        </p>
        </div>
      </details>
      <Card className="flex min-h-[220px] shrink-0 flex-col overflow-hidden">
        <CardHeading
          eyebrow="Recent enforcement"
          title={!desktop ? "Open the desktop app to read the local activity log" : !loaded ? "Loading" : recentBlocks.length === 0 ? "No blocks recorded" : `${recentBlocks.length} recent block${recentBlocks.length === 1 ? "" : "s"}`}
        />
        {recentBlocks.length > 0 && (
          <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto">{recentBlocks.map((entry, index) => <AuditRow key={`${entry.ts}-${index}`} entry={entry} />)}</div>
        )}
        {!desktop && <p className="text-[13px] leading-[1.6] text-(--muted)">The browser preview cannot read workspace files. Enforcement itself happens in the MCP bridge regardless.</p>}
        {desktop && loaded && recentBlocks.length === 0 && (
          <p className="text-[13px] leading-[1.6] text-(--muted)">Nothing blocked. Every mediated call so far was allowed or denied.</p>
        )}
      </Card>
      <Note><strong className="font-semibold text-(--text)">Unmanaged is not protected.</strong> Direct provider CLIs, direct MCP connections, or browser actions outside Nexus are not visible here.</Note>
      </div>
      </div>
    </div>
  );
}
