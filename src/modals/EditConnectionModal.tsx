import { useState } from "react";
import { type Account, type Connection } from "../store";
import { primaryBtn, secondaryBtn, smallBtn, inputClass, selectClass } from "../app/styles";
import { Note, Modal } from "../app/common";

export function EditConnectionModal({ connection, accounts, onClose, onSave, onOpenServices }: { connection: Connection; accounts: Account[]; onClose: () => void; onSave: (patch: { target: string; detail: string; tone: Connection["tone"]; projectRef?: string; url?: string; accountId?: string }) => void; onOpenServices?: () => void }) {
  const locked = connection.method === "mcp";
  const [target, setTarget] = useState(connection.target);
  const [detail, setDetail] = useState(connection.detail);
  const [tone, setTone] = useState<Connection["tone"]>(connection.tone);
  const [projectRef, setProjectRef] = useState(connection.projectRef ?? "");
  const [url, setUrl] = useState(connection.url ?? "");
  const [accountId, setAccountId] = useState(connection.accountId ?? connection.account ?? "");
  const [accountTouched, setAccountTouched] = useState(false);
  const matchingAccounts = accounts.filter((a) => a.provider.toLowerCase() === connection.provider.toLowerCase());
  // Display the canonical id; a legacy bare label stays as-is until the developer picks.
  const resolvedAccountId = matchingAccounts.some((a) => a.id === accountId)
    ? accountId
    : (matchingAccounts.find((a) => a.label === accountId)?.id ?? "");
  // Only an explicit pick changes the binding: untouched legacy values are
  // preserved, while picking "Not linked" clears to undefined via updateConnection.
  const accountForSave = accountTouched ? resolvedAccountId : accountId;
  const canSave = target.trim().length > 0 && (!connection.provider.startsWith("Supabase") || locked || (projectRef.trim().length > 0 && url.trim().length > 0));
  const tones = ["green", "violet", "blue", "orange"] as const;

  return (
    <Modal title={`Edit ${connection.provider} connection`} description={locked ? "Label, login, and color — the approved ref and URL stay exactly as Supabase issued them. To change projects, remove and reconnect." : "Update how Nexus labels and reaches this resource."} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ target: target.trim(), detail: detail.trim() || connection.detail, tone, projectRef: projectRef.trim() || undefined, url: url.trim() || undefined, accountId: accountForSave }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Display name</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus className={inputClass} required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Account (from Services)</span>
          {matchingAccounts.length === 0 && (
            <small className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.6] text-(--muted)">
              <span>No {connection.provider} account linked yet — link one under Services first, then pick it here. Saving “Not linked” clears the account.</span>
              {onOpenServices && <button type="button" onClick={onOpenServices} className={smallBtn}>Open Services</button>}
            </small>
          )}
          <select value={resolvedAccountId} onChange={(e) => { setAccountId(e.target.value); setAccountTouched(true); }} className={selectClass}>
            <option value="">Not linked</option>
            {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.id}</option>)}
          </select>
        </label>
        {locked && <Note>Approved ref <strong>{connection.projectRef}</strong> · {connection.url} — read-only while the approval lives.</Note>}
        {!locked && connection.provider === "Supabase" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project reference</span>
              <input value={projectRef} onChange={(e) => setProjectRef(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Project URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} />
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">What it provides</span>
            <input value={detail} onChange={(e) => setDetail(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Color</span>
            <select value={tone} onChange={(e) => setTone(e.target.value as Connection["tone"])} className={selectClass}>
              {tones.map((toneOption) => <option key={toneOption} value={toneOption}>{toneOption[0].toUpperCase() + toneOption.slice(1)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}
