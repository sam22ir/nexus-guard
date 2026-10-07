import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";

/** What the dialog needs from the app to sign in to a remote MCP service. */
export type RemoteServiceApi = {
  /** False outside the desktop app. */
  available: boolean;
  /** Sign in and save the binding. Resolves when the binding is saved; rejects with a plain-language message. */
  connect: (provider: string, accountId: string | undefined, signal: AbortSignal) => Promise<void>;
};

/** One generic panel for every service on the list: Nexus finds the service's
 *  sign-in on its own, opens the browser, and waits for the person to approve. */
export function ServiceConnectPanel({ provider, remote, resolveAccountId, onClose }: { provider: string; remote: RemoteServiceApi; resolveAccountId: () => string | undefined; onClose: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  // Closing the dialog mid-approval stops the wait and removes the pending binding.
  useEffect(() => () => abort.current?.abort(), []);

  async function connect() {
    setError(""); setWaiting(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await remote.connect(provider, resolveAccountId(), controller.signal);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : `Could not connect ${provider}. Try again.`);
      setWaiting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[12px] border border-(--line) px-3.5 py-3 text-[12.5px] leading-[1.7] text-(--muted)">
        {waiting ? (
          <p className="text-(--text)" role="status">Waiting for you to approve {provider} in your browser. This updates by itself.</p>
        ) : (
          <>
            <p className="text-(--text)">Nexus opens {provider} in your browser.</p>
            <ol className="mt-1 list-decimal pl-5">
              <li>Sign in to {provider} and approve Nexus</li>
              <li>Come back here, and the binding is saved</li>
            </ol>
            <p className="mt-1.5">Nexus asks for read-only access where {provider} allows it. Anything that could change data needs your approval first. Access covers your whole {provider} account, not a single project.</p>
          </>
        )}
      </div>
      {error && <p className="text-[12px] text-(--red)" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-(--line-soft) pt-3">
        <Button size="sm" variant="outline" onPress={onClose}>Cancel</Button>
        <Button size="sm" isDisabled={waiting || !remote.available} onPress={() => void connect()}>{waiting ? "Waiting for browser…" : remote.available ? `Connect ${provider}` : "Needs the desktop app"}</Button>
      </div>
    </div>
  );
}
