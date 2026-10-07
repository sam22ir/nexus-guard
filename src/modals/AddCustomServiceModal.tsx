import { useState } from "react";
import { Button } from "@heroui/react";
import { Modal } from "../app/common";
import { inputClass } from "../app/styles";

/** Add a service Nexus does not list: a name and the address of its MCP server.
 *  Nexus then signs in to it the same way as the built-in ones. */
export function AddCustomServiceModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, mcpUrl: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSave = name.trim().length >= 2 && url.trim().length > 8 && confirmed && !busy;

  async function save() {
    setBusy(true); setError("");
    try {
      await onSave(name.trim(), url.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this service. Check the name and address, then try again.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a service" description="Any service with a remote MCP server. Nexus signs in to it the same way as the built-in ones." onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (canSave) void save(); }}>
        <label className="nx-field">
          Name
          <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus placeholder="Acme" className={inputClass} />
          <span className="text-[11.5px] text-(--muted-2)">Letters, numbers and hyphens, no spaces. For example Acme or my-crm.</span>
        </label>
        <label className="nx-field">
          MCP server address
          <input value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} placeholder="https://mcp.acme.io/mcp" className={`${inputClass} nx-mono`} />
          <span className="text-[11.5px] text-(--muted-2)">The full https address from the service&apos;s MCP docs. Only public https addresses work.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-(--raised) p-3 text-[12px] leading-[1.55] text-(--muted)">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-(--text)" />
          <span>I trust this address. Nexus has not reviewed it. You will sign in to it, and Nexus sends it your sign-in token. Agents can only run tools it labels read-only, and anything that changes data needs you to allow it.</span>
        </label>
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-(--line-soft) pt-3">
          <Button size="sm" variant="outline" isDisabled={busy} onPress={onClose}>Cancel</Button>
          <Button size="sm" type="submit" isDisabled={!canSave}>{busy ? "Adding…" : "Add service"}</Button>
        </div>
      </form>
    </Modal>
  );
}
