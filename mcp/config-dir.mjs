// The app's own settings folder (write grants, binding scopes, custom services).
// It must match `nexus_config_dir` in src-tauri/src/lib.rs, and the app passes
// its choice to the server it starts through NEXUS_CONFIG_DIR, so the two
// always agree.
//   Linux:   $XDG_CONFIG_HOME/nexus-guard, else ~/.config/nexus-guard
//   macOS:   ~/Library/Application Support/nexus-guard
//   Windows: %APPDATA%\nexus-guard
import os from "node:os";
import path from "node:path";

const set = (value) => typeof value === "string" && value.trim() !== "";

/** The user's home folder: HOME, then USERPROFILE (Windows), then the OS answer. */
export function homeDir(env = process.env) {
  if (set(env.HOME)) return env.HOME;
  if (set(env.USERPROFILE)) return env.USERPROFILE;
  return os.homedir();
}

export function nexusConfigDir(env = process.env, platform = process.platform) {
  if (set(env.NEXUS_CONFIG_DIR)) return path.resolve(env.NEXUS_CONFIG_DIR.trim());
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "win32") {
    return join(set(env.APPDATA) ? env.APPDATA : join(homeDir(env), "AppData", "Roaming"), "nexus-guard");
  }
  if (platform === "darwin") return join(homeDir(env), "Library", "Application Support", "nexus-guard");
  if (set(env.XDG_CONFIG_HOME) && path.posix.isAbsolute(env.XDG_CONFIG_HOME)) return join(env.XDG_CONFIG_HOME, "nexus-guard");
  return join(homeDir(env), ".config", "nexus-guard");
}
