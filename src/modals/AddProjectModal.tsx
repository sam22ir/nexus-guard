import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "../keychain";
import { type FolderInspection } from "../app/types";
import { primaryBtn, secondaryBtn, ghostLink, inputClass, selectClass } from "../app/styles";
import { StatusDot, Note, Modal } from "../app/common";

export function AddProjectModal({ onClose, onSave, existingNames }: { onClose: () => void; onSave: (input: { name: string; path: string; repo: string; branch: string; environment?: string }) => void; existingNames: string[] }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [environment, setEnvironment] = useState("");
  const [repoAuto, setRepoAuto] = useState(true);
  const [branchAuto, setBranchAuto] = useState(true);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [inspectNonce, setInspectNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const desktop = desktopAvailable();
  const [busyPick, setBusyPick] = useState(false);
  const [error, setError] = useState("");
  const nameUsed = existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase());

  function pickPath(value: string) {
    setPath(value);
    if (!name.trim()) {
      const base = value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
      const cleaned = base.replace(/^~/, "").trim();
      if (cleaned) setName(cleaned);
    }
  }

  async function browseFolder() {
    setBusyPick(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose project folder" });
      if (typeof selected === "string" && selected) pickPath(selected);
    } catch {
      setError("Could not open the folder picker. Type the folder path instead.");
    } finally {
      setBusyPick(false);
    }
  }

  useEffect(() => {
    if (!desktop || !path.trim()) { setInspection(null); return; }
    setChecking(true);
    const timer = window.setTimeout(() => {
      invoke<FolderInspection>("inspect_project_folder", { workspacePath: path.trim() })
        .then((result) => {
          setInspection(result);
          if (result.git_remote && repoAuto) setRepo(result.git_remote);
          if (result.git_branch && branchAuto) setBranch(result.git_branch);
          if (!name.trim() && result.nexus_project) setName(result.nexus_project);
        })
        .catch(() => setInspection(null))
        .finally(() => setChecking(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [path, inspectNonce, desktop, repoAuto, branchAuto, name]);

  const folderMissing = !!inspection && (!inspection.exists || !inspection.is_dir);
  const alreadyRegistered = !!inspection?.nexus_project;
  // Paper: gate saves on inspection completion when desktop — the folder
  // check must finish (not just start) before Nexus accepts the project.
  const inspected = !desktop || !path.trim() || (inspection !== null && !checking);
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !nameUsed && !alreadyRegistered && !folderMissing && inspected;

  async function createFolder() {
    setCreating(true); setError("");
    try {
      if (!desktopAvailable()) throw new Error("Open the desktop app to create folders.");
      await invoke<string>("create_project_folder", { workspacePath: path.trim() });
      setInspectNonce((n) => n + 1);
    } catch (caught) {
      setError("Could not create that folder. Check the path and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title="Add a project" description="Tell Nexus where this project lives. Repo and branch fill in from the folder by themselves." onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ name: name.trim(), path: path.trim(), repo: repo.trim(), branch: branch.trim() || "main", environment: environment || undefined }); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--text)">Project name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Koupa" autoFocus className={inputClass} required />
          {nameUsed ? <span className="text-[12px] text-(--red)" role="alert">A project with this name already exists. Choose another name.</span> : null}
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text)">Project folder</span>
            <input value={path} onChange={(e) => pickPath(e.target.value)} placeholder="~/Projects/Koupa" className={inputClass} required />
          </label>
          {desktop && <button type="button" onClick={() => void browseFolder()} disabled={busyPick} className={secondaryBtn}>{busyPick ? "…" : "Browse"}</button>}
        </div>
        {desktop && path.trim() && (
          <p className="flex flex-wrap items-center gap-2 text-[12px] tabular-nums text-(--muted)">
            <StatusDot tone={checking ? "blue" : inspection ? (inspection.exists && inspection.is_dir ? "green" : "orange") : "orange"} />
            {checking ? "Checking folder…" : inspection ? (inspection.exists && inspection.is_dir
              ? `Folder found${inspection.git_branch ? ` · git: ${inspection.git_branch}` : " · no git — manifest only"}${inspection.nexus_project ? ` · already registered as ${inspection.nexus_project}` : ""}`
              : "That folder does not exist yet.") : ""}
            {desktop && path.trim() && folderMissing && !checking && (
              <button type="button" onClick={() => void createFolder()} disabled={creating} className={ghostLink}>{creating ? "Creating…" : "Create it"}</button>
            )}
          </p>
        )}
        {!desktop && <Note>Open the desktop app and Nexus checks the folder for you.</Note>}
        {inspection?.nexus_project && <p className="text-[12px] text-(--red)" role="alert">This folder already belongs to “{inspection.nexus_project}”. Pick another folder or remove it there first.</p>}
        {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
        <details className="rounded-[8px] border border-(--line) px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-(--muted)">Repo, branch, environment (auto-detected)</summary>
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Git repository</span>
              <input value={repo} onChange={(e) => { setRepo(e.target.value); setRepoAuto(false); }} placeholder="Detected from folder" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Branch</span>
              <input value={branch} onChange={(e) => { setBranch(e.target.value); setBranchAuto(false); }} placeholder="main" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-(--text)">Environment</span>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={selectClass}>
                <option value="">Auto from branch</option>
                <option value="development">Development</option>
                <option value="staging">Staging</option>
                <option value="production">Production</option>
              </select>
            </label>
          </div>
        </details>
        <Note>Only project information is saved. No passwords are requested here.</Note>
        <div className="flex justify-end gap-2 border-t border-(--line) pt-4">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="submit" disabled={!canSave} className={primaryBtn}>Save project</button>
        </div>
      </form>
    </Modal>
  );
}
