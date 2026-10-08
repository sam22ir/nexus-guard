import { useState } from "react";
import { desktopAvailable } from "../keychain";
import { type Project } from "../store";
import { primaryBtn, secondaryBtn, inputClass, selectClass } from "../app/styles";
import { Note, Modal } from "../app/common";

export function EditProjectModal({ project, onClose, onSave, existingNames }: { project: Project; onClose: () => void; onSave: (patch: { name: string; path: string; repo: string; branch: string; environment: string }) => void; existingNames: string[] }) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [repo, setRepo] = useState(project.repo === "Not connected" ? "" : project.repo);
  const [branch, setBranch] = useState(project.branch);
  const [environment, setEnvironment] = useState(project.environment);
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !nameUsed;

  async function browse() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose project folder" });
      if (typeof selected === "string" && selected) setPath(selected);
    } catch { /* keep typed path */ }
  }

  const environments = ["development", "staging", "production"];

  return (
    <Modal title={`Edit ${project.name}`} description="Rename, move, or retarget this project. Agents resolve the new details after you re-verify the folder." onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ name: name.trim(), path: path.trim(), repo: repo.trim(), branch: branch.trim() || "main", environment }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} required />
          {nameUsed ? <span className="text-[12px] text-(--red)" role="alert">Another project already uses this name. Choose another name.</span> : null}
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Project folder</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} className={inputClass} required />
          </label>
          {desktopAvailable() && <button type="button" onClick={() => void browse()} className={secondaryBtn}>Browse</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Git repository</span>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/you/repo" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Branch</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Environment</span>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={selectClass}>
            {environments.map((env) => <option key={env} value={env}>{env[0].toUpperCase() + env.slice(1)}</option>)}
          </select>
        </label>
        <Note>Only project information is saved. Saved approvals stay linked by their IDs.</Note>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}
