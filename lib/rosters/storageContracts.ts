/** Phase 2 proposal contracts only. No Supabase client, live adapter or consumer. */
import type { PermanentPlayer, ProfessionalTeam, RosterSport } from "./planning";

export type SourceReceipt = { url: string; sha256: string; captured_at: string };
export type RosterEvidenceWrite = {
  id: string;
  sport: RosterSport;
  nba_player_id: number | null;
  nfl_player_id: number | null;
  entity_kind: PermanentPlayer["kind"];
  /** NBA uses the ending year (2027 = 2026–27); NFL uses its calendar year. */
  season: number;
  evidence_type: "snapshot" | "interval";
  effective_from: string | null;
  effective_to: string | null;
  observed_at: string;
  verified_through: string;
  roster_status: "rostered" | "unrostered" | "unresolved";
  confidence: "confirmed" | "uncertain";
  team_provider: ProfessionalTeam["provider"] | null;
  team_provider_id: string | null;
  team_abbreviation: string | null;
  position: string | null;
  sources: SourceReceipt[];
  supersedes_id: string | null;
  // recorded_at and payload_hash are deliberately SERVER-owned, never caller inputs.
};
export type PoolScope = {
  slateId: number; groupId: string; leagueId: string; sport: RosterSport;
};
export type PoolAdmission = PoolScope & {
  season: number;
  eligibilityEffectiveAt: string;
  rosterEvidenceCutoff: string;
  onSlateTeams: Pick<ProfessionalTeam, "provider" | "id">[];
};
export type StoredPoolMember = {
  slate_id: number; sport: RosterSport; player_id: number;
  nba_player_id: number | null; nfl_player_id: number | null;
  entity_kind: PermanentPlayer["kind"]; saved_position: string;
  team_provider: ProfessionalTeam["provider"]; team_provider_id: string;
  saved_team_abbreviation: string | null; on_slate: boolean; roster_evidence_id: string;
};
export type PoolRead = { state: "legacy_requires_review" } | {
  state: "frozen";
  header: {
    slate_id: number; group_id: string; league_id: string; sport: RosterSport;
    professional_season: number; eligibility_effective_at: string;
    roster_evidence_cutoff: string; frozen_at: string; pool_version: 1;
    pool_hash: string; catalog_hash: string; member_count: number;
    rules_snapshot: unknown; on_slate_teams: PoolAdmission["onSlateTeams"];
  };
  players: StoredPoolMember[];
};

/** Future trusted-server adapter must authorize Group/league/sport before invoking
 * owner-only proposals. Admission belongs in the SAME transaction as slate creation
 * or explicit admission; draft mutation must validate membership under that lock.
 * Interface presence does not authorize granting or installing any RPC. */
export interface ProposedRosterRepository {
  appendEvidence(input: RosterEvidenceWrite): Promise<string>;
  admitSlate(input: PoolAdmission): Promise<PoolRead>;
  readSlate(input: PoolScope): Promise<PoolRead | null>;
}

export function rosterIdentityColumns(player: PermanentPlayer) {
  if (!Number.isSafeInteger(player.playerId) || player.playerId < 1 ||
    !["nba", "nfl"].includes(player.sport) || !["athlete", "team_defense"].includes(player.kind) ||
    player.kind === "team_defense" && player.sport !== "nfl") throw new Error("Invalid existing permanent identity");
  return {
    sport: player.sport,
    nba_player_id: player.sport === "nba" ? player.playerId : null,
    nfl_player_id: player.sport === "nfl" ? player.playerId : null,
    entity_kind: player.kind,
  };
}

export function assertFrozenPoolScope(pool: PoolRead, scope: PoolScope) {
  if (pool.state !== "frozen") throw new Error("Legacy eligibility requires explicit compatibility review");
  const h = pool.header;
  if (h.slate_id !== scope.slateId || h.group_id !== scope.groupId || h.league_id !== scope.leagueId || h.sport !== scope.sport ||
    h.pool_version !== 1 || !/^[a-f0-9]{64}$/.test(h.pool_hash) || !/^[a-f0-9]{64}$/.test(h.catalog_hash) ||
    h.member_count !== pool.players.length) throw new Error("Frozen pool scope/version/completeness mismatch");
  const ids = new Set<number>();
  for (const p of pool.players) {
    const identity = rosterIdentityColumns({ sport: p.sport, playerId: p.player_id, kind: p.entity_kind });
    if (p.slate_id !== scope.slateId || p.sport !== scope.sport || p.nba_player_id !== identity.nba_player_id ||
      p.nfl_player_id !== identity.nfl_player_id || ids.has(p.player_id) || typeof p.on_slate !== "boolean" ||
      !p.saved_position || !["nba", "espn"].includes(p.team_provider) || !/^[1-9]\d*$/.test(p.team_provider_id) ||
      !p.roster_evidence_id) throw new Error("Invalid frozen eligible player membership");
    ids.add(p.player_id);
  }
  return pool;
}
