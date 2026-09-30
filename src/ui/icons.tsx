// Nexus icon set: 24px grid, 1.7 stroke, currentColor. One place for every glyph.
const PATHS = {
  home: "M4 11 12 4l8 7m-9 8v-5m-6 5H5v-7m14 7h-4v-7",
  folder: "M3.5 6.5h6l1.7 2H20.5v9.5h-17z",
  agents: "M12 4v2.5M7.5 9h9a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15.5v-4A2.5 2.5 0 0 1 7.5 9ZM9.5 13v1m5-1v1M3 13v2m18-2v2",
  link: "M9.5 14.5 8 16a3.2 3.2 0 0 1-4.5-4.5L6 9m8.5.5L16 8a3.2 3.2 0 0 1 4.5 4.5L18 15M8 12h8",
  services: "M4 7h16v3H4zM4 14h16v3H4zM8 7v10",
  activity: "M3.5 12h3l2-5 3.3 10 2.1-5h6.6",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  shield: "M12 3.5 19 6v5.2c0 4.2-2.8 7.4-7 9.3-4.2-1.9-7-5.1-7-9.3V6zM9.2 12l1.8 1.8 3.8-4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  back: "m14 6-6 6 6 6",
  forward: "m10 6 6 6-6 6",
  down: "m6 10 6 6 6-6",
  up: "m6 14 6-6 6 6",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9 15.5-3.8-3.8",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v4.2l2.8 1.8",
  play: "M8 5.5v13l10.5-6.5z",
  download: "M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14",
  alert: "M12 4 3.5 19h17zM12 10v4m0 2.5v.01",
  lock: "M7 11V8.5a5 5 0 0 1 10 0V11M6 11h12v8.5H6z",
  unlock: "M7 11V8.5a5 5 0 0 1 9.5-2M6 11h12v8.5H6z",
  key: "M14.5 9.5a4 4 0 1 0-3 3.9L13 15l1.5-.5 1 1.5L17 15.5l.5-1.5 2-2zM8 10h.01",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
  moon: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z",
  branch: "M7 5v9m0 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0-9a2 2 0 1 0 0-.01M17 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 0c0 4-10 2-10 6",
  database: "M5 6c0-1.4 3.1-2.5 7-2.5S19 4.6 19 6s-3.1 2.5-7 2.5S5 7.4 5 6Zm0 0v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5",
  message: "M5 6.5h14v9H10l-4 3.5v-3.5H5z",
  spark: "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18 16l.7 1.8 1.8.7-1.8.7L18 21l-.7-1.8-1.8-.7 1.8-.7z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  external: "M14 5h5v5m0-5-8 8M17 14v4.5H5.5V7H10",
  trash: "M5 7h14M10 4h4M7 7l.8 12h8.4L17 7m-6 3.5v6m2-6v6",
  monitor: "M4 5h16v11H4zM9 20h6m-3-4v4",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  refresh: "M19 11a7 7 0 0 0-12.5-3.5L5 9m0-4v4h4M5 13a7 7 0 0 0 12.5 3.5L19 15m0 4v-4h-4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
