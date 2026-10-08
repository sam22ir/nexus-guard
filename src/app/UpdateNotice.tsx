import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "@heroui/react";
import { desktopAvailable } from "../keychain";
import { Notice } from "../ui";

/** Checks once at start. Offline or unsigned builds stay silent; only an
 *  available update shows, and only the desktop app can install it. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!desktopAvailable()) return;
    let cancelled = false;
    check()
      .then((found) => { if (!cancelled && found) setUpdate(found); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!update) return null;

  async function install() {
    if (!update) return;
    setBusy(true);
    setFailed(false);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <Notice tone="success" onDismiss={busy ? undefined : () => setUpdate(null)}>
      Nexus Guard {update.version} is available.{" "}
      {failed && "The update did not install. Try again later. "}
      <Button size="sm" isDisabled={busy} onPress={install}>
        {busy ? "Updating…" : "Install and restart"}
      </Button>
    </Notice>
  );
}
