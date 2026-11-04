/** Offline roster/eligibility proposal only. No database client or live consumer imports this module. */
import { canPlayerFillRosterSlot } from "../rules/leagueRules";

export type RosterSport = "nba" | "nfl";
export type PermanentPlayer = { sport: RosterSport; playerId: number; kind: "athlete" | "team_defense" };
export type ProfessionalTeam = { provider: "nba" | "espn"; id: string; abbreviation: string | null };
export type RosterEvidence = PermanentPlayer & {
  evidenceId: string; season: number; type: "interval" | "snapshot";
  effectiveFrom: string | null; effectiveTo: string | null;
  observedAt: string; verifiedThrough: string; confidence: "confirmed" | "uncertain";
  status: "rostered" | "unrostered"; team: ProfessionalTeam | null; position: string | null;
  sources: string[];
};
export type RosterResolution = {
  state: "rostered" | "unrostered" | "unknown" | "conflict";
  team: ProfessionalTeam | null; position: string | null; evidenceIds: string[]; issues: string[];
};
const instant = (value: string) => {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Roster evidence requires a timezone-qualified instant");
  return Date.parse(value);
};
function assertPlayer(player: PermanentPlayer) {
  if (!["nba", "nfl"].includes(player.sport) || !Number.isSafeInteger(player.playerId) || player.playerId < 1 ||
    !["athlete", "team_defense"].includes(player.kind) || player.kind === "team_defense" && player.sport !== "nfl") throw new Error("Invalid permanent player identity");
}
function assertTeam(team: ProfessionalTeam) {
  if (!["nba", "espn"].includes(team.provider) || !/^[1-9]\d*$/.test(team.id) ||
    team.abbreviation !== null && (typeof team.abbreviation !== "string" || !team.abbreviation.trim())) throw new Error("Invalid namespaced professional team");
}
const samePlayer = (a: PermanentPlayer, b: PermanentPlayer) => a.sport === b.sport && a.playerId === b.playerId && a.kind === b.kind;
const teamKey = (team: ProfessionalTeam | null) => team ? `${team.provider}:${team.id}` : "unrostered";
function assertEvidence(e: RosterEvidence) {
  assertPlayer(e);
  if (!e.evidenceId || !Number.isInteger(e.season) || e.season < 2000 || e.season > 2100 ||
    !["confirmed", "uncertain"].includes(e.confidence) || !["rostered", "unrostered"].includes(e.status) ||
    !Array.isArray(e.sources) || !e.sources.length || e.sources.some(s => typeof s !== "string" || !s.startsWith("https://"))) throw new Error("Invalid roster provenance");
  const observed = instant(e.observedAt), through = instant(e.verifiedThrough);
  if (through > observed) throw new Error("Roster verification cannot claim future evidence");
  if (e.type === "interval") {
    if (e.effectiveFrom === null || instant(e.effectiveFrom) > through ||
      e.effectiveTo !== null && instant(e.effectiveTo) <= instant(e.effectiveFrom)) throw new Error("Invalid half-open roster interval");
  } else if (e.type !== "snapshot" || e.effectiveFrom !== null || e.effectiveTo !== null || through !== observed) throw new Error("A roster snapshot is a point observation, not an inferred transaction date");
  if (e.status === "unrostered" && e.team !== null || e.status === "rostered" && e.team === null) throw new Error("Roster status/team conflict");
  if (e.team) assertTeam(e.team);
  if (e.kind === "team_defense" && (e.position !== "D/ST" || e.status === "unrostered") || e.kind === "athlete" && e.position === "D/ST") throw new Error("D/ST is a permanent team entity, not an athlete transaction");
}

/** Does not infer roster status from catalog is_active, appearances, or today's team. */
export function resolveRosterAt(player: PermanentPlayer, season: number, at: string, evidence: readonly RosterEvidence[]): RosterResolution {
  assertPlayer(player); const time = instant(at);
  if (!Number.isInteger(season) || season < 2000 || season > 2100 || evidence.length > 20000) throw new Error("Invalid/capped roster scope");
  const seen = new Set<string>();
  for (const e of evidence) { assertEvidence(e); if (seen.has(e.evidenceId)) throw new Error("Duplicate roster evidence ID"); seen.add(e.evidenceId); }
  const relevant = evidence.filter(e => samePlayer(e, player) && e.season === season && (e.type === "snapshot"
    ? time === instant(e.observedAt)
    : time >= instant(e.effectiveFrom!) && time <= instant(e.verifiedThrough) && (e.effectiveTo === null || time < instant(e.effectiveTo))));
  const base = { team: null, position: null, evidenceIds: relevant.map(e => e.evidenceId).sort() };
  if (!relevant.length) return { ...base, state: "unknown", issues: ["no_effective_roster_evidence"] };
  if (relevant.some(e => e.confidence !== "confirmed")) return { ...base, state: "unknown", issues: ["uncertain_transaction_evidence"] };
  const claims = new Set(relevant.map(e => `${e.status}:${teamKey(e.team)}:${e.position}`));
  if (claims.size !== 1) return { ...base, state: "conflict", issues: ["conflicting_effective_roster_evidence"] };
  const chosen = relevant[0];
  return { ...base, state: chosen.status, team: chosen.team ? { ...chosen.team } : null, position: chosen.position, issues: [] };
}

export type GameTeamEvidence = PermanentPlayer & {
  season: number; eventId: string; gameAt: string; team: ProfessionalTeam; source: string;
};
/** Explicit game evidence is historical truth; current catalog metadata is intentionally absent. */
export function resolveHistoricalGameTeam(player: PermanentPlayer, season: number, eventId: string, gameAt: string,
  gameEvidence: readonly GameTeamEvidence[], rosterEvidence: readonly RosterEvidence[] = []) {
  assertPlayer(player); const at = instant(gameAt);
  if (!/^[1-9]\d*$/.test(eventId) || gameEvidence.length > 20000) throw new Error("Invalid/capped game-team scope");
  const claims = gameEvidence.filter(e => samePlayer(e, player) && e.season === season && e.eventId === eventId && instant(e.gameAt) === at);
  for (const e of claims) { assertTeam(e.team); if (!e.source.startsWith("https://")) throw new Error("Game-team provenance required"); }
  if (claims.length) {
    if (new Set(claims.map(e => teamKey(e.team))).size !== 1) return { team: null, source: "unresolved" as const, issues: ["conflicting_game_team_evidence"] };
    return { team: { ...claims[0].team }, source: "game" as const, issues: [] as string[] };
  }
  const roster = resolveRosterAt(player, season, gameAt, rosterEvidence);
  return roster.state === "rostered" ? { team: roster.team, source: "interval" as const, issues: [] as string[] }
    : { team: null, source: "unresolved" as const, issues: roster.issues.length ? roster.issues : ["no_game_team_evidence"] };
}

export type PlannedPoolMember = PermanentPlayer & { position: string; team: ProfessionalTeam; onSlate: boolean };
export type PlannedSlate = { slateId: number; groupId: string; leagueId: string; sport: RosterSport; season: number; eligibilityAt: string; evidenceAsOf: string; locked: boolean };
export type FrozenEligibility = Omit<PlannedSlate, "locked"> & { capturedAt: string; players: PlannedPoolMember[] };

/** Proposal-only contract. Existing live drafts/RPCs are deliberately not wired to it. */
export function planSlateEligibility(slate: PlannedSlate, players: readonly PermanentPlayer[], evidence: readonly RosterEvidence[],
  onSlateTeams: readonly ProfessionalTeam[], slotPositions: readonly string[], frozen?: FrozenEligibility) {
  instant(slate.eligibilityAt);
  const knowledgeCutoff = instant(slate.evidenceAsOf);
  if (!Number.isSafeInteger(slate.slateId) || slate.slateId < 1 || !slate.groupId || !slate.leagueId ||
    !["nba", "nfl"].includes(slate.sport) || !Number.isInteger(slate.season) || !slotPositions.length || players.length > 3000) throw new Error("Invalid/capped slate scope");
  if (frozen) {
    if (["slateId", "groupId", "leagueId", "sport", "season", "eligibilityAt", "evidenceAsOf"].some(key => frozen[key as keyof FrozenEligibility] !== slate[key as keyof PlannedSlate]) ||
      instant(frozen.capturedAt) < knowledgeCutoff || frozen.players.length > 3000) throw new Error("Frozen eligibility scope/cutoff mismatch");
    const ids = new Set<number>();
    for (const p of frozen.players) { assertPlayer(p); assertTeam(p.team); if (p.sport !== slate.sport || ids.has(p.playerId) || !p.position || typeof p.onSlate !== "boolean") throw new Error("Invalid frozen pool member"); ids.add(p.playerId); }
    return { state: "frozen" as const, players: structuredClone(frozen.players), unresolved: [] as number[], issues: [] as string[] };
  }
  if (slate.locked) return { state: "requires_review" as const, players: [] as PlannedPoolMember[], unresolved: [] as number[], issues: ["legacy_locked_slate_has_no_pool_snapshot"] };
  const teams = new Set(onSlateTeams.map(t => { assertTeam(t); return teamKey(t); }));
  const pool: PlannedPoolMember[] = [], unresolved: number[] = [], ids = new Set<number>();
  for (const player of players) {
    assertPlayer(player);
    if (player.sport !== slate.sport || ids.has(player.playerId)) throw new Error("Ambiguous/cross-sport player pool"); ids.add(player.playerId);
    const resolved = resolveRosterAt(player, slate.season, slate.eligibilityAt, evidence.filter(e => instant(e.observedAt) <= knowledgeCutoff));
    if (resolved.state === "unknown" || resolved.state === "conflict" || resolved.state === "rostered" && !resolved.position) { unresolved.push(player.playerId); continue; }
    // Existing On Slate is a display filter, not a new prohibition on otherwise
    // eligible picks. Freeze its evidence alongside the complete eligible pool.
    if (resolved.state === "rostered" && resolved.team && resolved.position &&
      slotPositions.some(slot => canPlayerFillRosterSlot(slate.sport, resolved.position!, slot))) pool.push({ ...player, position: resolved.position,
        team: resolved.team, onSlate: teams.has(teamKey(resolved.team)) });
  }
  return { state: unresolved.length ? "requires_review" as const : "proposed" as const, players: pool, unresolved, issues: unresolved.length ? ["incomplete_effective_eligibility"] : [] };
}
