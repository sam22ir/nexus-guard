
/** Paper alignment: Guard is OUT of MVP. Hidden, not removed — the "guard"
 *  View member stays so home.tsx / other files keep compiling. */
export const GUARD_VISIBLE = false;

export const primaryBtn =
  "rounded-[10px] bg-(--text) px-4 py-2 text-[13px] font-medium text-(--canvas) transition-[background-color,transform,opacity] duration-200 hover:opacity-85 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryBtn =
  "rounded-[10px] border border-(--line) bg-(--panel) px-4 py-2 text-[13px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const smallBtn =
  "shrink-0 rounded-[10px] border border-(--line) bg-(--panel) px-3 py-1.5 text-[12px] font-medium text-(--text) transition-[transform,opacity] duration-200 hover:border-(--muted-2) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) disabled:cursor-not-allowed disabled:opacity-50";

export const dangerBtn =
  "shrink-0 rounded-[10px] border border-(--red-bg) bg-(--panel) px-3 py-1.5 text-[12px] font-medium text-(--red) transition-[transform,opacity] duration-200 hover:bg-(--red-bg) active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-(--red) disabled:cursor-not-allowed disabled:opacity-50";

export const ghostLink =
  "rounded-[10px] px-2 py-1 text-[13px] font-medium text-(--muted) transition-[transform,opacity] duration-200 hover:text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus)";

export const inputClass =
  "h-10 w-full rounded-[10px] border border-(--line) bg-(--panel) px-3 text-[13px] text-(--text) placeholder:text-(--muted-2) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-1";

export const selectClass =
  "h-10 w-full rounded-[10px] border border-(--line) bg-(--panel) px-3 text-[13px] text-(--text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--focus) focus-visible:ring-offset-1";

export function badgeStyle(tone: string): { background: string; color: string } {
  if (tone === "green" || tone === "allow" || tone === "connected" || tone === "success" || tone === "folder ok") return { background: "var(--green-bg)", color: "var(--green)" };
  if (tone === "yellow" || tone === "warning" || tone === "pending" || tone === "approval_required" || tone === "shared") return { background: "var(--orange-bg)", color: "var(--orange)" };
  if (tone === "red" || tone === "danger" || tone === "block" || tone === "failed" || tone === "missing") return { background: "var(--red-bg)", color: "var(--red)" };
  if (tone === "blue") return { background: "var(--blue-bg)", color: "var(--blue)" };
  return { background: "var(--raised)", color: "var(--muted)" };
}
