import { useEffect, useState } from "react";
import { tierForProvider, PROVIDER_CATALOG } from "../store";
import { primaryBtn, secondaryBtn, inputClass, selectClass, badgeStyle } from "../app/styles";
import { Modal } from "../app/common";

export function AddAccountModal({ initialProvider, onClose, onSave }: { initialProvider?: string; onClose: () => void; onSave: (input: { provider: string; label: string }) => void }) {
  const [provider, setProvider] = useState(initialProvider ?? "Supabase");
  const [customProvider, setCustomProvider] = useState("");
  const [label, setLabel] = useState("personal");
  const catalogProviders = [...PROVIDER_CATALOG.map((p) => p.provider), "Other…"];
  const effectiveProvider = provider === "Other…" ? customProvider.trim() : provider;
  const tier = effectiveProvider ? tierForProvider(effectiveProvider) : "self-added";
  // Paper: self-added services need an explicit 2-step confirm — fail-closed
  // restated, explicit confirm click before save.
  const [selfAddedConfirm, setSelfAddedConfirm] = useState(false);
  useEffect(() => { setSelfAddedConfirm(false); }, [effectiveProvider]);
  const canSave = effectiveProvider.length > 0 && (tier !== "self-added" || selfAddedConfirm);

  return (
    <Modal title="Link a new login" description="Link a provider login once, then bind it to projects under Bindings." onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave({ provider: effectiveProvider, label: label.trim() || "personal" });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Service</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={selectClass}>
              {catalogProviders.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Account label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="personal" className={inputClass} />
          </label>
        </div>
        {provider === "Other…" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Custom service name</span>
            <input value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} placeholder="Acme API" className={inputClass} />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.05em]" style={badgeStyle(tier === "native" ? "green" : tier === "curated" ? "blue" : "pending")}>
            {tier}
          </span>
          {tier === "self-added" && <small className="text-[12px] text-(--muted)">This service hasn&apos;t been reviewed by Nexus — every action stays fail-closed (denied until you allow it) until you reclassify it.</small>}
        </div>
        {tier === "self-added" && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-(--line) bg-(--canvas) p-3 text-[12px] leading-[1.6] text-(--muted)">
            <input type="checkbox" checked={selfAddedConfirm} onChange={(e) => setSelfAddedConfirm(e.target.checked)} className="mt-1 accent-(--text)" />
            <span>I understand this login is unreviewed and fail-closed — agents get nothing from it until I bind it and explicitly allow calls.</span>
          </label>
        )}
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Add account</button>
        </div>
      </form>
    </Modal>
  );
}
