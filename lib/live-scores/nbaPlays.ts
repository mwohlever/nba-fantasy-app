type Raw = Record<string, any>;

export type NbaSemanticEvent = {
  kind: "timeout" | "turnover" | "foul" | "review" | "jump_ball" | "period_end";
  primaryLabel: string;
  teamId?: string;
  chargedPlayerId?: string;
  playerLabel?: string;
  secondaryLabel?: string;
};

type NbaBoxscorePlayer = { teamId: string; shortName: string };

export type NbaPlay = {
  id: string;
  period: number | null;
  clock: string | null;
  text: string;
  shortDescription: string | null;
  awayScore: number | null;
  homeScore: number | null;
  scoringPlay: boolean;
  scoreValue: number;
  pointsAttempted: number | null;
  shootingPlay: boolean;
  isFreeThrow: boolean;
  type: string | null;
  typeId: string | null;
  teamId: string | null;
  shooterId: string | null;
  coordinate: { x: number; y: number } | null;
  semanticEvent?: NbaSemanticEvent;
};

export function nbaBoxscorePlayers(boxscore: unknown): Map<string, NbaBoxscorePlayer> {
  const players = new Map<string, NbaBoxscorePlayer>();
  const ambiguous = new Set<string>();
  for (const team of (boxscore as Raw | null)?.players ?? []) {
    const teamId = team?.team?.id == null ? null : String(team.team.id);
    if (!teamId) continue;
    for (const category of team.statistics ?? []) for (const row of category.athletes ?? []) {
      const id = row?.athlete?.id == null ? null : String(row.athlete.id);
      const shortName = typeof row?.athlete?.shortName === "string" ? row.athlete.shortName.trim() : "";
      if (!id || !shortName) continue;
      const prior = players.get(id);
      if (prior && (prior.teamId !== teamId || prior.shortName !== shortName)) ambiguous.add(id);
      else players.set(id, { teamId, shortName });
    }
  }
  for (const id of ambiguous) players.delete(id);
  return players;
}

function semanticNbaEvent(raw: Raw, players: Map<string, NbaBoxscorePlayer>): NbaSemanticEvent | undefined {
  const typeId = String(raw.type?.id ?? "");
  const teamId = raw.team?.id == null ? undefined : String(raw.team.id);
  const withTeam = (kind: NbaSemanticEvent["kind"], primaryLabel: string): NbaSemanticEvent => ({ kind, primaryLabel, ...(teamId ? { teamId } : {}) });
  if (typeId === "16") return withTeam("timeout", "TIMEOUT");
  if (["62", "63", "65", "70", "84", "87", "90"].includes(typeId)) return withTeam("turnover", "TURNOVER");

  const foulLabels: Record<string, string> = {
    "22": "PERSONAL TAKE FOUL", "29": "DEFENSIVE 3 SECONDS", "30": "DOUBLE TECHNICAL FOUL",
    "32": "FLAGRANT FOUL TYPE 1", "35": "TECHNICAL FOUL", "42": "OFFENSIVE FOUL",
    "44": "SHOOTING FOUL", "45": "PERSONAL FOUL",
  };
  if (foulLabels[typeId]) {
    // Double technicals can charge players on both teams; a single team or player label would mislead.
    if (typeId === "30") return { kind: "foul", primaryLabel: foulLabels[typeId] };
    const event = withTeam("foul", foulLabels[typeId]);
    const participants = Array.isArray(raw.participants) ? raw.participants : [];
    if (teamId && participants.length === 1 && participants[0]?.athlete?.id != null) {
      const id = String(participants[0].athlete.id);
      event.chargedPlayerId = id;
      const player = players.get(id);
      if (player?.teamId === teamId) event.playerLabel = player.shortName.toUpperCase();
    }
    return event;
  }

  if (["213", "214", "215", "216"].includes(typeId)) {
    const event = withTeam("review", "COACH'S CHALLENGE");
    if (typeId === "214") event.secondaryLabel = "SUPPORTED";
    if (typeId === "215") event.secondaryLabel = "OVERTURNED";
    if (typeId === "216") event.secondaryLabel = "STANDS";
    return event;
  }
  if (["278", "279", "280"].includes(typeId)) {
    return { kind: "review", primaryLabel: "REF REVIEW", secondaryLabel: typeId === "278" ? "SUPPORTED" : typeId === "279" ? "OVERTURNED" : "STANDS" };
  }
  if (typeId === "615") return { kind: "jump_ball", primaryLabel: "JUMP BALL" };
  if (typeId === "402") return { kind: "period_end", primaryLabel: "END OF GAME" };
  if (typeId === "412") {
    const period = numberOrNull(raw.period?.number);
    return { kind: "period_end", primaryLabel: period === 2 ? "HALFTIME" : period && period <= 4 ? `END OF Q${period}` : period ? `END OF ${nbaPeriodLabel(period)}` : "END OF PERIOD" };
  }
  return undefined;
}

const coordinateInDomain = (coordinate: unknown): coordinate is { x: number; y: number } => {
  const value = coordinate as { x?: unknown; y?: unknown } | null;
  const x = Number(value?.x);
  const y = Number(value?.y);
  // ESPN's observed field-goal coordinate grid is a 0..50 half-court plane.
  // Fail closed for free-throw sentinels and any unverified future domain.
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 50 && y >= 0 && y <= 50;
};

const numberOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

// ESPN identifies free throws with structured shooting metadata and a typed play
// label. Their coordinate values are sentinels, not floor locations.
const isStructuredFreeThrow = (raw: Raw) => raw.shootingPlay === true
  && Number(raw.pointsAttempted) === 1
  && typeof raw.type?.text === "string"
  && /\bfree throw\b/i.test(raw.type.text);

export function normalizeNbaPlays(input: unknown, players = new Map<string, NbaBoxscorePlayer>()): NbaPlay[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const plays: NbaPlay[] = [];
  for (const raw of input as Raw[]) {
    const key = String(raw.id ?? `${raw.sequenceNumber ?? ""}|${raw.period?.number ?? ""}|${raw.clock?.displayValue ?? ""}|${raw.text ?? ""}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isFreeThrow = isStructuredFreeThrow(raw);
    const fieldGoal = raw.shootingPlay === true && Number(raw.pointsAttempted) !== 1 && coordinateInDomain(raw.coordinate);
    plays.push({
      id: key, period: numberOrNull(raw.period?.number), clock: typeof raw.clock?.displayValue === "string" ? raw.clock.displayValue : null,
      text: typeof raw.text === "string" ? raw.text : "Game event", shortDescription: typeof raw.shortDescription === "string" ? raw.shortDescription : null,
      awayScore: numberOrNull(raw.awayScore), homeScore: numberOrNull(raw.homeScore), scoringPlay: raw.scoringPlay === true,
      scoreValue: numberOrNull(raw.scoreValue) ?? 0, pointsAttempted: numberOrNull(raw.pointsAttempted), shootingPlay: raw.shootingPlay === true, isFreeThrow,
      type: typeof raw.type?.text === "string" ? raw.type.text : null, typeId: raw.type?.id != null ? String(raw.type.id) : null,
      teamId: raw.team?.id != null ? String(raw.team.id) : null,
      shooterId: raw.participants?.[0]?.athlete?.id != null ? String(raw.participants[0].athlete.id) : null,
      coordinate: fieldGoal ? { x: Number(raw.coordinate.x), y: Number(raw.coordinate.y) } : null,
      semanticEvent: semanticNbaEvent(raw, players),
    });
  }
  return plays;
}

export function nbaPlayPeriods(plays: NbaPlay[]) { return [...new Set(plays.flatMap((play) => play.period && play.period > 0 ? [play.period] : []))].sort((a, b) => a - b); }

export function defaultNbaPlayPeriod(plays: NbaPlay[], isLive: boolean, currentPeriod: number | null) {
  const periods = nbaPlayPeriods(plays);
  return isLive && currentPeriod && periods.includes(currentPeriod) ? currentPeriod : periods.at(-1) ?? null;
}

export function latestMeaningfulNbaPlay(plays: NbaPlay[]) {
  return [...plays].reverse().find((play) => play.semanticEvent?.kind !== "period_end" && !/^end (?:of )?(?:the )?(?:game|period|\d+(?:st|nd|rd|th) quarter)$/i.test(play.text.trim())) ?? null;
}

export function nbaPeriodLabel(period: number | null) {
  if (!period) return "Game";
  return period <= 4 ? `Q${period}` : period === 5 ? "OT" : `${period - 4}OT`;
}

export type NbaShotMarker = { left: number; top: number; basket: "left" | "right"; made: boolean };

export function nbaPlayBasket(play: NbaPlay, context: { awayTeamId?: string; homeTeamId?: string }): "left" | "right" | null {
  if (!play.teamId || !context.homeTeamId || !context.awayTeamId || context.homeTeamId === context.awayTeamId) return null;
  return play.teamId === context.homeTeamId ? "left" : play.teamId === context.awayTeamId ? "right" : null;
}

export function nbaPlayAttackIndicator(play: NbaPlay | null, context: { awayTeamId?: string; homeTeamId?: string; awayTeamAbbreviation?: string | null; homeTeamAbbreviation?: string | null }) {
  if (!play || play.semanticEvent) return null;
  const basket = nbaPlayBasket(play, context);
  const abbreviation = basket === "left" ? context.homeTeamAbbreviation?.trim() : basket === "right" ? context.awayTeamAbbreviation?.trim() : null;
  return abbreviation ? basket === "left" ? `← ${abbreviation}` : `${abbreviation} →` : null;
}

/**
 * ESPN's x/y is a shooting-basket-relative plane: x is 0..50 lateral (rim at 25),
 * y runs outward from the rim. ESPN does not include arena-end metadata, so 111 Sports
 * deliberately displays home shots at the left basket and away shots at the right.
 */
export function nbaFullCourtMarker(play: NbaPlay, context: { awayTeamId?: string; homeTeamId?: string }): NbaShotMarker | null {
  if (play.semanticEvent) return null;
  if (!play.shootingPlay) return null;
  const basket = nbaPlayBasket(play, context);
  if (!basket) return null;
  // These are the regulation free-throw-line centers already drawn by CourtEnd.
  // They deliberately bypass ESPN's free-throw coordinate sentinels.
  if (play.isFreeThrow) return { left: basket === "left" ? 19 : 75, top: 25, basket, made: play.scoreValue > 0 };
  if (!play.coordinate || play.pointsAttempted === 1) return null;
  const { x, y } = play.coordinate;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 50 || y < 0 || y > 50) return null;
  const hoopX = basket === "left" ? 5.25 : 88.75;
  return { left: hoopX + (basket === "left" ? y : -y), top: x, basket, made: play.scoreValue > 0 };
}
