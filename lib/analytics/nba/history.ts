import { instant, observationKey, type NbaObservation, type SeasonPhase } from "./types";

export type HistoryPolicy = {
  /** recorded requires a known revision timestamp; retrospective is an explicitly approximate replay. */
  availability: "recorded" | "retrospective";
  /** No completion time: retrospective replay requires this explicit >=24h quarantine from tipoff. */
  unknownCompletionLagHours?: number;
  phases: readonly SeasonPhase[];
  seasons?: readonly number[];
};
export type HistoryScope = {
  provider: NbaObservation["provider"];
  providerPlayerId: string;
  excludeEventIds: readonly string[];
};

function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${fingerprint(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Resolve revisions BEFORE eligibility checks: an incomplete correction must not revive an older score. */
export function observationsAsOf(history: readonly NbaObservation[], asOf: string, scope: HistoryScope, policy: HistoryPolicy) {
  const cutoff = instant(asOf);
  if (cutoff === null) throw new Error("Invalid prediction cutoff");
  if (policy.availability !== "recorded" && policy.availability !== "retrospective") throw new Error("Explicit availability policy required");
  const lag = policy.unknownCompletionLagHours;
  if (lag !== undefined && (!Number.isFinite(lag) || lag < 24)) throw new Error("Retrospective completion quarantine must be >=24 hours");
  const groups = new Map<string, NbaObservation[]>();
  for (const row of history) {
    if (row.sport !== "nba" || row.provider !== scope.provider || row.providerPlayerId !== scope.providerPlayerId
      || scope.excludeEventIds.includes(row.eventId)) continue;
    const known = instant(row.provenance.knownAt), fetched = instant(row.provenance.fetchedAt);
    if (fetched === null || (row.provenance.knownAt !== null && (known === null || known > fetched))) continue;
    if (known !== null && known >= cutoff) continue;
    if (policy.availability === "recorded" && known === null) continue;
    const key = observationKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const observations: NbaObservation[] = [], excluded: { key: string; reason: string }[] = [];
  for (const [key, versions] of groups) {
    // Once recorded evidence exists, a later retrospective payload cannot override that historical revision.
    const recorded = versions.filter(row => row.provenance.knownAt !== null);
    const candidates = recorded.length ? recorded : versions;
    const latest = Math.max(...candidates.map(row => instant(row.provenance.knownAt) ?? instant(row.provenance.fetchedAt)!));
    const winners = candidates.filter(row => (instant(row.provenance.knownAt) ?? instant(row.provenance.fetchedAt)) === latest);
    if (winners.some(row => fingerprint(row) !== fingerprint(winners[0]))) {
      excluded.push({ key, reason: "conflicting-revision" }); continue;
    }
    const row = winners[0], start = instant(row.gameAt), end = instant(row.completedAt);
    let reason: string | null = null;
    if (start === null || start >= cutoff) reason = "invalid-or-future-game-time";
    else if (row.provenance.knownAt !== null && instant(row.provenance.knownAt)! < start) reason = "revision-before-game";
    else if (row.gameStatus !== "final") reason = "not-final";
    else if (!policy.phases.includes(row.phase) || policy.seasons && !policy.seasons.includes(row.season)) reason = "outside-season-policy";
    else if (row.completedAt !== null && (end === null || end < start || end >= cutoff)) reason = "invalid-or-future-completion";
    else if (end !== null && row.provenance.knownAt !== null && instant(row.provenance.knownAt)! < end) reason = "final-revision-before-completion";
    else if (end === null && row.provenance.knownAt === null && (lag === undefined || cutoff - start < lag * 3_600_000)) reason = "completion-time-unknown";
    if (reason) excluded.push({ key, reason });
    else observations.push(structuredClone(row));
  }
  observations.sort((a, b) => instant(a.gameAt)! - instant(b.gameAt)! || observationKey(a).localeCompare(observationKey(b)));
  return { observations, excluded: excluded.sort((a, b) => a.key.localeCompare(b.key)),
    timing: policy.availability === "recorded" ? "recorded-revisions" as const : "retrospective-approximation" as const };
}
