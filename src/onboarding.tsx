import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "./ui";

export const NEXUS_HTTP_URL = "http://localhost:3939/mcp";

/* ---------- Theme (paper §11): system-follow + manual toggle ----------
 *
 * NOTE FOR APP WORKSTREAM: this file owns the theme helpers. Mount
 * <ThemeToggle /> in the App rail when ready (it is already mounted in
 * Home's header and in this modal's footer), and call initTheme() once at
 * boot (e.g. in main.tsx) — index.html's inline script already covers
 * first paint, initTheme() keeps runtime + OS-listener state in sync.
 * Preference order: localStorage "nexus-theme" > prefers-color-scheme >
 * dark. Stored values: "dark" | "light" | "system". */

export type NexusTheme = "dark" | "light";
export type NexusThemeChoice = NexusTheme | "system";

const THEME_KEY = "nexus-theme";

export function getThemeChoice(): NexusThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "system";
}

export function resolveTheme(choice: NexusThemeChoice): NexusTheme {
  if (choice === "dark" || choice === "light") return choice;
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch { /* ignore */ }
  return "dark";
}

/** Currently applied theme (resolved — never "system"). */
export function getTheme(): NexusTheme {
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return resolveTheme(getThemeChoice());
}

function applyTheme(theme: NexusTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#F6F5F1" : "#1A1A1A");
}

/** Persist a choice ("system" follows the OS) and apply it immediately. */
export function setTheme(choice: NexusThemeChoice): NexusTheme {
  try { window.localStorage.setItem(THEME_KEY, choice); } catch { /* ignore */ }
  const resolved = resolveTheme(choice);
  applyTheme(resolved);
  return resolved;
}

/** Apply the stored/OS theme. Call once at boot; returns the applied theme. */
export function initTheme(): NexusTheme {
  const resolved = resolveTheme(getThemeChoice());
  applyTheme(resolved);
  return resolved;
}

/** System-follow + manual toggle. Follows OS changes while on "system". */
export function ThemeToggle() {
  const [choice, setChoice] = useState<NexusThemeChoice>(getThemeChoice);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (getThemeChoice() === "system") applyTheme(resolveTheme("system"));
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const options: { value: NexusThemeChoice; label: string }[] = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];
  return (
    <span className="seg-control" role="group" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={choice === option.value}
          title={option.value === "system" ? "Follow the operating system" : `${option.label} theme`}
          onClick={() => { setTheme(option.value); setChoice(option.value); }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** One icon button that cycles System, Light, Dark. Compact stand-in for
 *  ThemeToggle in the app header; same persistence and OS-follow behavior. */
export function ThemeButton() {
  const [choice, setChoice] = useState<NexusThemeChoice>(getThemeChoice);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (getThemeChoice() === "system") applyTheme(resolveTheme("system"));
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const order: NexusThemeChoice[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(choice) + 1) % order.length];
  const name = (value: NexusThemeChoice) => (value === "system" ? "System" : value === "light" ? "Light" : "Dark");
  const icon = choice === "system" ? "monitor" : choice === "light" ? "sun" : "moon";
  return (
    <Button isIconOnly size="sm" variant="ghost" aria-label={`Theme: ${name(choice)}. Switch to ${name(next)}`} onPress={() => { setTheme(next); setChoice(next); }}>
      <Icon name={icon} size={17} />
    </Button>
  );
}

/** Bind the endpoint to one project. The bridge refuses a request that names no
 *  workspace, so each project gets its own registration against the same
 *  server. The query form works for every agent, including ones with no
 *  custom-header support. */
export function nexusHttpUrlFor(workspace: string) {
  const trimmed = workspace.trim();
  if (!trimmed) return NEXUS_HTTP_URL;
  return `${NEXUS_HTTP_URL}?workspace=${encodeURIComponent(trimmed)}`;
}
export function claudeHttpCommand(workspace: string) {
  return `claude mcp add --transport http nexus "${nexusHttpUrlFor(workspace)}"`;
}
export function codexHttpCommand(workspace: string) {
  return `codex mcp add nexus --url "${nexusHttpUrlFor(workspace)}"`;
}
