import { auditNbaAcquisitionIdentities, normalizeIdentityName, normalizeIdentityTeam,
  type LocalNbaIdentity, type NativeNbaIdentity, type EspnRosterIdentity, type StoredNbaIdentity } from "../player-center/nbaIdentity";

export type NbaRosterPlanningSnapshot = {
  version: 1; season: number; evidenceAt: string; nativeSource: string;
  completeNativeRoster: boolean; completeEspnTeams: number;
  players: LocalNbaIdentity[]; native: NativeNbaIdentity[]; espn: EspnRosterIdentity[]; identities: StoredNbaIdentity[];
  appearances: { playerId: number; season: number; games: number }[];
};

/** Evidence-only reconciliation. Never emits SQL, new local IDs, or approved mutations. */
export function planNbaRosterReconciliation(snapshot: NbaRosterPlanningSnapshot) {
  const { players, native, espn, identities, appearances } = snapshot;
  if (snapshot.version !== 1 || !Number.isInteger(snapshot.season) || snapshot.season < 2000 || snapshot.season > 2100 ||
    !Number.isFinite(Date.parse(snapshot.evidenceAt)) || !snapshot.nativeSource.startsWith("https://stats.nba.com/") ||
    snapshot.completeNativeRoster !== true || snapshot.completeEspnTeams !== 30) throw new Error("Complete dated NBA roster evidence required");
  for (const rows of [players, native, espn, identities, appearances]) if (!Array.isArray(rows) || rows.length > 5000) throw new Error("Invalid/capped reconciliation snapshot");
  if (new Set(players.map(p => p.id)).size !== players.length || players.some(p => !Number.isSafeInteger(p.id) || p.id < 1) ||
    new Set(native.map(n => n.nbaPlayerId)).size !== native.length || native.some(n => !Number.isSafeInteger(n.nbaPlayerId) || n.nbaPlayerId < 1) ||
    new Set(espn.map(p => p.espnPlayerId)).size !== espn.length || espn.some(p => !/^[1-9]\d*$/.test(p.espnPlayerId))) throw new Error("Ambiguous permanent/provider roster identities");
  const nativeIds = players.flatMap(p => p.nba_player_id === null ? [] : [p.nba_player_id]);
  if (new Set(nativeIds).size !== nativeIds.length) throw new Error("Duplicate catalog native identity; never merge by name");
  const counts = new Map<string, number>();
  for (const a of appearances) {
    const key = `${a.playerId}:${a.season}`;
    if (!players.some(p => p.id === a.playerId) || !Number.isSafeInteger(a.games) || a.games < 1 ||
      !Number.isInteger(a.season) || a.season < 2000 || a.season > 2100 || counts.has(key)) throw new Error("Invalid/duplicate appearance evidence");
    counts.set(key, a.games);
  }
  const currentNative = native.filter(n => n.rostered);
  const gaps = auditNbaAcquisitionIdentities({ players, native, espn, stored: identities, nativeSource: snapshot.nativeSource });
  const providerReview = (n: NativeNbaIdentity, localId: number | null) => {
    const sameName = espn.filter(e => normalizeIdentityName(e.name) === normalizeIdentityName(n.name));
    const match = sameName.length === 1 && native.filter(other => normalizeIdentityName(other.name) === normalizeIdentityName(n.name)).length === 1 &&
      normalizeIdentityTeam(n.team) && normalizeIdentityTeam(sameName[0].team) === normalizeIdentityTeam(n.team) ? sameName[0] : null;
    if (!match) return { state: "uncertain" as const, providerCandidate: null, reason: "missing_or_ambiguous_corroboration" };
    if (identities.some(i => i.provider_player_id === match.espnPlayerId && i.player_id !== localId)) return { state: "uncertain" as const, providerCandidate: null, reason: "provider_identity_already_claimed" };
    return { state: "corroborated_review_candidate" as const, providerCandidate: match.espnPlayerId, reason: "native_id_and_unique_current_provider_rosters_agree" };
  };
  const additions = currentNative.flatMap(n => {
    const p = players.find(p => p.nba_player_id === n.nbaPlayerId);
    if (p?.is_active) return [];
    const differentIdentityWithSameName = players.some(p => p.nba_player_id !== n.nbaPlayerId && normalizeIdentityName(p.name) === normalizeIdentityName(n.name));
    return [{ nativePlayerId: n.nbaPlayerId, name: n.name, existingPlayerId: p?.id ?? null,
      category: p ? "existing_identity_currently_inactive" : "current_roster_addition_requires_identity_review",
      team: n.team, effectiveAt: null,
      identity: differentIdentityWithSameName ? { state: "uncertain" as const, providerCandidate: null, reason: "name_matches_different_native_identity" } : providerReview(n, p?.id ?? null) }];
  });
  const removals = players.filter(p => p.is_active && !currentNative.some(n => n.nbaPlayerId === p.nba_player_id))
    .map(p => ({ playerId: p.id, name: p.name, nativePlayerId: p.nba_player_id, category: "current_roster_absence_requires_review",
      effectiveAt: null, transactionType: "unknown", deactivatePlayer: false }));
  const teamChanges = players.filter(p => p.is_active).flatMap(p => {
    const n = currentNative.find(n => n.nbaPlayerId === p.nba_player_id);
    return n && normalizeIdentityTeam(n.team) !== normalizeIdentityTeam(p.team_abbreviation)
      ? [{ playerId: p.id, nativePlayerId: p.nba_player_id, name: p.name, catalogTeam: p.team_abbreviation, currentEvidenceTeam: n.team,
        category: "team_difference_transaction_date_unknown", transactionType: "unknown", effectiveAt: null,
        evidenceAt: snapshot.evidenceAt, identity: providerReview(n, p.id) }] : [];
  });
  const historicalOnly = players.filter(p => !currentNative.some(n => n.nbaPlayerId === p.nba_player_id) &&
    appearances.some(a => a.playerId === p.id && a.season < snapshot.season))
    .map(p => ({ playerId: p.id, name: p.name, category: "historical_statistics_without_current_roster_evidence",
      seasons: appearances.filter(a => a.playerId === p.id).map(a => a.season).sort(), preserveIdentityAndRecords: true }));
  const noCurrentSeasonObservations = players.filter(p => !counts.has(`${p.id}:${snapshot.season}`)).map(p => ({
    playerId: p.id, name: p.name, currentRosterEvidence: currentNative.some(n => n.nbaPlayerId === p.nba_player_id),
    observationState: "no_stored_observations", verifiedGamesPlayed: null, rosterStatusFromObservations: false,
  }));
  return { version: 1, mode: "review_only", databaseWrites: 0, changesApplied: 0, season: snapshot.season, evidenceAt: snapshot.evidenceAt,
    requiresFreshEvidenceAndSeparateApproval: true, liveDraftEligibilityChanged: false,
    summary: { activeCatalog: players.filter(p => p.is_active).length, currentNativeRoster: currentNative.length,
      rosterAdditions: additions.length, newNativeIdentities: additions.filter(a => a.existingPlayerId === null).length,
      inactiveExistingIdentities: additions.filter(a => a.existingPlayerId !== null).length, rosterAbsences: removals.length,
      teamDifferences: teamChanges.length, unresolvedActiveMappings: gaps.filter(g => !g.providerPlayerId).length,
      existingMappingsNeedingEvidence: gaps.filter(g => g.category === "existing_mapping_requires_review").length,
      historicalOnly: historicalOnly.length, noCurrentSeasonObservations: noCurrentSeasonObservations.length,
      rosteredWithoutStoredAppearances: noCurrentSeasonObservations.filter(p => p.currentRosterEvidence).length },
    additions, removals, teamChanges, historicalOnly, noCurrentSeasonObservations,
    identityReview: gaps.filter(g => g.category !== "existing_mapping_corroborated"),
    preservation: { allExistingPlayerIds: players.map(p => p.id).sort((a,b) => a-b),
      historicalDraftReferences: "not_in_snapshot_preserve_all", inferTransactionDates: false,
      notes: ["A roster absence is not a release date or permission to deactivate.",
        "A team difference is not proof of a trade or its effective instant.",
        "No observations does not establish zero GP, DNP, or roster absence.",
        "Saved picks, locked slates, memberships and immutable observations must retain their existing IDs."] } };
}
