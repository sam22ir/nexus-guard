import { useState, type FormEvent } from "react";
import { desktopAvailable, removePublishableKey, savePublishableKey, unlockVault } from "../vault";
import { type Connection, type Project } from "../store";
import { primaryBtn, secondaryBtn, dangerBtn, inputClass } from "../app/styles";
import { Note, Modal } from "../app/common";

export function PublishableKeyModal({ project, connection, saved, vaultUnlocked, onUnlocked, onClose, onChanged }: { project: Project; connection: Connection; saved: boolean; vaultUnlocked: boolean; onUnlocked: () => void; onClose: () => void; onChanged: (saved: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const desktop = desktopAvailable();

  async function unlockFirst(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await unlockVault(password);
      setPassword("");
      onUnlocked();
    } catch (error) { setMessage("Could not unlock the vault. Check the password and try again."); }
    finally { setBusy(false); }
  }

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
    catch { setMessage("Could not remove this key. Unlock the vault and try again."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Publishable key for ${connection.target}`} description="Saved only in this desktop vault. Agents receive tools, never this key." onClose={onClose}>
      {!desktop && <Note>Open the desktop app to save keys. The browser preview never accepts them.</Note>}
      {desktop && !vaultUnlocked && (
        <form className="flex flex-col gap-4" onSubmit={unlockFirst}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Vault password — unlocks here, no detour</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" placeholder="At least 12 characters" minLength={12} className={inputClass} required />
            {message ? <span className="text-[12px] text-(--red)" role="alert">{message}</span> : null}
          </label>
          <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={busy || password.length < 12} className={primaryBtn}>{busy ? "Unlocking…" : "Unlock and continue"}</button>
          </div>
        </form>
      )}
      {desktop && vaultUnlocked && (
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
