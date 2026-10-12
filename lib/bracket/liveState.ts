import type { ImplicationSelection, ImplicationSubject } from "./gameImplications.server";

export type BracketGameCenterTab = "summary" | "pbp" | "stats" | "implications";

export function parseBracketLiveState(search: string) {
  const params = new URLSearchParams(search);
  const value = params.get("tab");
  const tab: BracketGameCenterTab = value === "pbp" || value === "stats" || value === "implications" ? value : "summary";
  const entryId = Number(params.get("entryId"));
  const entrantId = params.get("entrantId");
  const bracketNumber = Number(params.get("bracket") ?? params.get("bracketNumber"));
  const selectionRequested = ["entryId", "entrantId", "bracket", "bracketNumber"].some((key) => params.has(key));
  let selection: ImplicationSelection | null = null;
  if (params.has("entryId")) {
    if (Number.isSafeInteger(entryId) && entryId > 0 && !entrantId) selection = { entryId };
  } else if (entrantId && Number.isSafeInteger(bracketNumber) && bracketNumber > 0) selection = { entrantId, bracketNumber };
  return { gameId: params.get("gameId"), devEventId: params.get("devEventId"), tab, selection, selectionRequested };
}

/** Patch only CFP detail keys; subject and unrelated navigation context survive Back to games. */
export function bracketLiveSearch(search: string, change: {
  gameId?: string | null; devEventId?: string | null; tab?: BracketGameCenterTab;
  subject?: ImplicationSubject | null;
}) {
  const params = new URLSearchParams(search);
  for (const key of ["gameId", "devEventId", "tab"] as const) {
    if (!(key in change)) continue;
    const value = change[key];
    if (value === null) params.delete(key); else if (value !== undefined) params.set(key, value);
  }
  if ("subject" in change) {
    for (const key of ["entryId", "entrantId", "bracket", "bracketNumber"]) params.delete(key);
    const subject = change.subject;
    if (subject) {
      if (subject.snapshotStatus !== "draft" && subject.entryId !== null) params.set("entryId", String(subject.entryId));
      else { params.set("entrantId", subject.entrantId); params.set("bracket", String(subject.bracketNumber)); }
    }
  }
  return params.toString();
}

export function resolveImplicationSubject(subjects: ImplicationSubject[], selection: ImplicationSelection | null, selectionRequested: boolean) {
  if (selectionRequested) return selection ? subjects.find((subject) => selection.entryId !== undefined
    ? subject.entryId === selection.entryId : subject.entrantId === selection.entrantId && subject.bracketNumber === selection.bracketNumber) ?? null : null;
  const personal = subjects.filter((subject) => subject.isAccountOwner);
  return personal.length === 1 ? personal[0] : null;
}

export function selectionForSubject(subject: ImplicationSubject): ImplicationSelection {
  return subject.snapshotStatus !== "draft" && subject.entryId !== null ? { entryId: subject.entryId }
    : { entrantId: subject.entrantId, bracketNumber: subject.bracketNumber };
}
