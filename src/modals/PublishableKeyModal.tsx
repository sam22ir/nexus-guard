import { useState, type FormEvent } from "react";
import { desktopAvailable, removePublishableKey, savePublishableKey } from "../keychain";
import { type Connection, type Project } from "../store";
import { primaryBtn, secondaryBtn, dangerBtn, inputClass } from "../app/styles";
import { Note, Modal } from "../app/common";

export function PublishableKeyModal({ project, connection, saved, onClose, onChanged }: { project: Project; connection: Connection; saved: boolean; onClose: () => void; onChanged: (saved: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const desktop = desktopAvailable();

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await savePublishableKey(project.id, connection.id, value);
      setValue(""); onChanged(true);
    } catch (error) { setMessage("Could not save that key. Check the key value and try again."); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMessage("");
    try { await removePublishableKey(project.id, connection.id); onChanged(false); }
    catch { setMessage("Could not remove this key. Check that the system keychain is available and try again."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Publishable key for ${connection.target}`} description="Saved only in your system keychain. Agents receive tools, never this key." onClose={onClose}>
      {!desktop && <Note>Open the desktop app to save keys. The browser preview never accepts them.</Note>}
      {desktop && (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Supabase publishable key</span>
            <input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="off" placeholder="sb_publishable_..." className={`${inputClass} font-mono`} />
            {message ? <span className="text-[12px] text-(--red)" role="alert">{message}</span> : null}
          </label>
          <Note>Do not enter a secret key, service-role key, database password, or personal access token.</Note>
          <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
            {saved && <button type="button" onClick={() => void remove()} disabled={busy} className={dangerBtn}>Remove saved key</button>}
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={busy || !value.trim().startsWith("sb_publishable_")} className={primaryBtn}>{busy ? "Saving…" : saved ? "Replace key" : "Save key"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
