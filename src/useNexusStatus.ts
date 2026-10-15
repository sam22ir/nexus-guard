import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopAvailable } from "./keychain";

type ServerStatus = { running: boolean; needs_node?: boolean; detail: string };

const POLL_MS = 5_000;

/** Whether Nexus's local server is running, re-checked every few seconds while
 *  the component using it is mounted. Only the desktop app can start the server;
 *  in the browser preview `running` stays null. */
export type NexusStatus = {
  running: boolean | null;
  detail: string;
  restart: () => Promise<void>;
  needsNode: boolean;
  starting: boolean;
};

/** Call once, in App, and pass the result down: each call starts its own poller. */
export function useNexusStatus(): NexusStatus {
  const desktop = desktopAvailable();
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setServer(await invoke<ServerStatus>("ensure_nexus_server"));
    } catch {
      setServer({ running: false, detail: "Nexus could not start its local server. Restart the app." });
    }
  }, []);

  const restart = useCallback(async () => {
    setStarting(true);
    try {
      await refresh();
    } finally {
      setStarting(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [desktop, refresh]);

  return {
    running: desktop && server ? server.running : null,
    detail: server?.detail ?? "",
    restart,
    needsNode: server?.needs_node ?? false,
    starting,
  };
}
