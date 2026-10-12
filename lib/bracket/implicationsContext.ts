import type { ImplicationSelection, ImplicationsResponse } from "./gameImplications.server";

export function implicationSelectionQuery(selection: ImplicationSelection) {
  return selection.entryId !== undefined ? new URLSearchParams({ entryId: String(selection.entryId) })
    : new URLSearchParams({ entrantId: selection.entrantId ?? "", bracketNumber: String(selection.bracketNumber ?? "") });
}

export function matchesImplicationContext(response: ImplicationsResponse, contestId: string, gameId: string, selection: ImplicationSelection) {
  const subject = response.subject;
  return implicationLockConsistent(response) && response.contestId === contestId && response.game?.gameId === gameId && subject?.contestId === contestId &&
    response.competitionId === subject.competitionId && (selection.entryId !== undefined
      ? subject.entryId === selection.entryId
      : subject.entrantId === selection.entrantId && subject.bracketNumber === selection.bracketNumber);
}

export function implicationLockConsistent(response: ImplicationsResponse) {
  // Older isolated fixtures have no context. Real server/simulation responses always include it.
  return !response.contestLock || (response.contestLock.scope === "contest" &&
    (response.contestLock.locked ? response.poolState !== "pre_lock" : response.poolState === "pre_lock"));
}

export function implicationReadStamp(response: ImplicationsResponse) {
  return response.contestLock?.evaluatedAt ?? response.freshness?.readAt ?? "";
}
