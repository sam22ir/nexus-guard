import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@heroui/react";

export type GithubRepoChoice = { full_name: string; private: boolean };
type GithubStart = { connectionId: string; userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number };

/** What the dialog needs from the app to connect the user's own GitHub account. */
export type GithubApi = {
  configured: boolean;
  install_url?: string | null;
  start: () => Promise<GithubStart>;
  wait: (start: GithubStart, signal: AbortSignal) => Promise<{ login: string | null; repos: GithubRepoChoice[] }>;
  repos: (connectionId: string) => Promise<GithubRepoChoice[]>;
  confirm: (projectId: string, connectionId: string, repo: string, login: string | null) => Promise<void>;
};

/** Connect GitHub with the person's own account: Nexus shows a short code, they
 *  approve it on github.com, then pick the repository this project uses. */
export function GithubConnectPanel({ github, projectId, onDiscard, onClose }: { github: GithubApi; projectId: string; onDiscard: (connectionId: string) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<"intro" | "code" | "pick">("intro");
  const [start, setStart] = useState<GithubStart | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepoChoice[]>([]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  // Set while a repository is being chosen. If the dialog closes in that state the pending binding is discarded.
  const discardId = useRef<string | null>(null);
  const discardRef = useRef(onDiscard);
  discardRef.current = onDiscard;

  // Closing mid-approval stops the wait, which removes the pending binding itself.
  useEffect(() => () => {
    abort.current?.abort();
    if (discardId.current) discardRef.current(discardId.current);
  }, []);

  async function connect() {
    setBusy(true); setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const started = await github.start();
      setStart(started);
      setPhase("code");
      const result = await github.wait(started, controller.signal);
      setLogin(result.login);
      setRepos(result.repos);
      setPicked(result.repos.length === 1 ? result.repos[0].full_name : "");
      discardId.current = started.connectionId;
      setPhase("pick");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Could not connect GitHub. Try again.");
      setPhase("intro");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    if (!start) return;
    setBusy(true); setError("");
    try {
      const found = await github.repos(start.connectionId);
      setRepos(found);
      if (found.length === 1) setPicked(found[0].full_name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your repositories. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!start || !picked) return;
    setBusy(true); setError("");
    discardId.current = null;
    try {
      await github.confirm(projectId, start.connectionId, picked, login);
    } catch (caught) {
      discardId.current = start.connectionId;
      setError(caught instanceof Error ? caught.message : "Could not link that repository. Try again.");
      setBusy(false);
    }
  }

  function cancel() {
    onClose();
  }

  return (
    <div className="flex flex-col gap-3">
      {phase === "intro" && (
        <div className="rounded-[12px] border border-(--line) px-3.5 py-3 text-[12.5px] leading-[1.7] text-(--muted)">
          <p className="text-(--text)">You connect your own GitHub account.</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>Nexus shows a short code and opens GitHub</li>
            <li>You enter the code and approve</li>
            <li>You pick the repository this project uses</li>
          </ol>
          <p className="mt-1.5">Nexus only reads. It never gets write access, and only to the repositories you choose.</p>
        </div>
      )}

      {phase === "code" && start && (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-(--line) px-3.5 py-4 text-center">
          <span className="text-[12px] text-(--muted)">Enter this code on GitHub</span>
          <strong className="nx-mono text-[28px] font-semibold tracking-[0.12em] text-(--text)" aria-live="polite">{start.userCode}</strong>
          <Button size="sm" variant="outline" onPress={() => void openUrl(start.verificationUri).catch(() => undefined)}>Open GitHub</Button>
          <span className="text-[12px] text-(--muted)" role="status">Waiting for your approval. This updates by itself.</span>
        </div>
      )}

      {phase === "pick" && (
        <>
          <p className="text-[12.5px] text-(--muted)">{login ? <>Connected as <span className="font-medium text-(--text)">{login}</span>. </> : null}Pick the repository for this project.</p>
          {repos.length > 0 ? (
            <div className="max-h-[260px] overflow-y-auto rounded-[12px] border border-(--line)" role="radiogroup" aria-label="GitHub repository">
              {repos.map((repo, index) => (
                <label key={repo.full_name} className="flex cursor-pointer items-center gap-3 px-3 py-2.5" style={{ ...(index > 0 ? { borderTop: "1px solid var(--line-soft)" } : {}), ...(picked === repo.full_name ? { background: "var(--raised)" } : {}) }}>
                  <input type="radio" name="github-repo" value={repo.full_name} checked={picked === repo.full_name} onChange={() => setPicked(repo.full_name)} className="accent-(--text)" />
                  <span className="nx-mono min-w-0 flex-1 truncate text-(--text)">{repo.full_name}</span>
                  {repo.private && <span className="nx-badge">private</span>}
                </label>
              ))}
            </div>
          ) : (
            <div className="rounded-[12px] bg-(--orange-bg) px-3.5 py-3 text-[12.5px] leading-[1.6] text-(--orange)">
              No repositories yet. Install the Nexus GitHub App on the repository this project uses, then check again.
              <div className="mt-2 flex gap-2">
                {github.install_url && <Button size="sm" variant="outline" onPress={() => void openUrl(github.install_url as string).catch(() => undefined)}>Install on GitHub</Button>}
                <Button size="sm" variant="outline" isDisabled={busy} onPress={() => void checkAgain()}>{busy ? "Checking…" : "Check again"}</Button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-(--line-soft) pt-3">
        <Button size="sm" variant="outline" onPress={cancel}>Cancel</Button>
        {phase === "intro" && <Button size="sm" isDisabled={busy} onPress={() => void connect()}>{busy ? "Starting…" : "Connect GitHub"}</Button>}
        {phase === "pick" && <Button size="sm" isDisabled={busy || !picked} onPress={() => void confirm()}>{busy ? "Linking…" : "Link this repository"}</Button>}
      </div>
    </div>
  );
}
