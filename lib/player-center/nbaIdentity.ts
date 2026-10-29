/** Review preparation only. Candidates never become runtime mappings automatically. */
export type LocalNbaIdentity = {
  id: number; name: string; nba_player_id: number | null;
  team_abbreviation: string | null; is_active: boolean;
};
export type NativeNbaIdentity = { nbaPlayerId: number; name: string; team: string; rostered: boolean };
export type EspnRosterIdentity = { espnPlayerId: string; name: string; team: string; source: string };
export type StoredNbaIdentity = { player_id: number | null; provider_player_id: string; resolution_status: string };

export function normalizeIdentityName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function normalizeIdentityTeam(value: string | null) {
  const team = (value ?? "").trim().toUpperCase();
  return ({ GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" } as Record<string, string>)[team] ?? team;
}

export function reviewNbaIdentityGaps(input: {
  players: LocalNbaIdentity[]; native: NativeNbaIdentity[]; espn: EspnRosterIdentity[];
  stored: StoredNbaIdentity[]; nativeSource: string;
}) {
  return input.players.filter(player => player.is_active).map(player => {
    const existing = input.stored.filter(row => row.player_id === player.id && row.resolution_status === "resolved");
    const native = input.native.filter(row => row.nbaPlayerId === player.nba_player_id);
    const base = { playerId: player.id, name: player.name, nbaPlayerId: player.nba_player_id,
      storedTeam: player.team_abbreviation, native: native.length === 1 ? native[0] : null };
    if (existing.length === 1) return { ...base, category: "already_resolved", candidate: null };
    if (existing.length > 1 || native.length > 1 || input.players.filter(row => row.nba_player_id === player.nba_player_id).length > 1)
      return { ...base, category: "identity_conflict", candidate: null };
    if (!native.length) return { ...base, category: "absent_from_native_season", candidate: null };
    if (!native[0].rostered || !normalizeIdentityTeam(native[0].team))
      return { ...base, category: "not_on_native_current_roster", candidate: null };
    if (normalizeIdentityName(native[0].name) !== normalizeIdentityName(player.name))
      return { ...base, category: "native_name_requires_review", candidate: null };
    const candidates = input.espn.filter(row => normalizeIdentityName(row.name) === normalizeIdentityName(native[0].name));
    if (!candidates.length) return { ...base, category: "no_current_espn_candidate", candidate: null };
    if (candidates.length !== 1 || input.espn.filter(row => row.espnPlayerId === candidates[0].espnPlayerId).length !== 1)
      return { ...base, category: "ambiguous_espn_candidate", candidate: null };
    const athlete = candidates[0];
    if (normalizeIdentityTeam(athlete.team) !== normalizeIdentityTeam(native[0].team))
      return { ...base, category: "current_provider_teams_disagree", candidate: null };
    // A pending/blocked provider row also requires review, even if today's roster agrees.
    if (input.stored.some(row => row.provider_player_id === athlete.espnPlayerId))
      return { ...base, category: "provider_id_already_claimed", candidate: null };
    return { ...base, category: "corroborated_current_rosters", candidate: {
      providerPlayerId: athlete.espnPlayerId,
      evidence: `Native NBA ID ${player.nba_player_id} has a unique matching name and current team ${normalizeIdentityTeam(native[0].team)} in both provider rosters`,
      sources: [input.nativeSource, athlete.source],
      needsApproval: true,
    } };
  });
}

/** Review existing claims too; nothing here applies mappings or changes the active/draft pool. */
export function auditNbaAcquisitionIdentities(input: Parameters<typeof reviewNbaIdentityGaps>[0]) {
  const gaps = reviewNbaIdentityGaps(input);
  return input.players.filter(player => player.is_active).map(player => {
    const gap = gaps.find(row => row.playerId === player.id)!;
    const claims = input.stored.filter(row => row.player_id === player.id && row.resolution_status === "resolved");
    let category = gap.category;
    const issues: string[] = [];
    if (player.nba_player_id === null || input.players.filter(row => row.nba_player_id === player.nba_player_id).length !== 1) issues.push("missing_or_duplicate_native_id");
    if (claims.length > 1) issues.push("multiple_resolved_provider_claims");
    if (claims.length === 1) {
      const claim = claims[0], native = input.native.filter(row => row.nbaPlayerId === player.nba_player_id);
      const provider = input.espn.filter(row => row.espnPlayerId === claim.provider_player_id);
      if (input.stored.filter(row => row.provider_player_id === claim.provider_player_id).length !== 1) issues.push("provider_claim_collision");
      if (native.length !== 1 || provider.length !== 1) issues.push("existing_mapping_missing_current_evidence");
      else {
        if (!native[0].rostered) issues.push("not_on_native_current_roster");
        if (normalizeIdentityName(native[0].name) !== normalizeIdentityName(player.name) || normalizeIdentityName(provider[0].name) !== normalizeIdentityName(native[0].name)) issues.push("existing_mapping_name_disagreement");
        if (!normalizeIdentityTeam(native[0].team) || normalizeIdentityTeam(native[0].team) !== normalizeIdentityTeam(provider[0].team)) issues.push("existing_mapping_team_disagreement");
      }
      category = issues.length ? "existing_mapping_requires_review" : "existing_mapping_corroborated";
    } else if (issues.length) category = "identity_conflict";
    return { ...gap, category, issues, candidate: issues.length ? null : gap.candidate,
      providerPlayerId: claims.length === 1 ? claims[0].provider_player_id : null, requiresApproval: true };
  });
}
