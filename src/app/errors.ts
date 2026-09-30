import { makeId } from "../store";
import { type ErrorRecord } from "./types";

/** Stable identity for one kept error: the id when present, else the full
 *  composite so two distinct errors sharing a timestamp never collapse. */
export function errorIdentity(record: ErrorRecord): string {
  if (record.id) return record.id;
  return [record.ts, record.where, record.message, record.retry?.projectId ?? "", record.retry?.connectionId ?? "", record.retry?.kind ?? ""].join("|");
}

export function loadErrorLog(): ErrorRecord[] {
  try {
    const saved = window.localStorage.getItem("nexus-guard.errors");
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    // Backfill ids for logs kept before stable ids existed.
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Partial<ErrorRecord>;
      if (typeof record.ts !== "string" || typeof record.where !== "string" || typeof record.message !== "string") return [];
      return [{ id: typeof record.id === "string" && record.id ? record.id : makeId("error"), ts: record.ts, where: record.where, message: record.message, debug: typeof record.debug === "string" ? record.debug : undefined, retry: record.retry }];
    });
  } catch {
    return [];
  }
}
