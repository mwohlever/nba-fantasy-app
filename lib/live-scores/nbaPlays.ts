type Raw = Record<string, any>;

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
  teamId: string | null;
  shooterId: string | null;
  coordinate: { x: number; y: number } | null;
};

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

export function normalizeNbaPlays(input: unknown): NbaPlay[] {
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
      type: typeof raw.type?.text === "string" ? raw.type.text : null,
      teamId: raw.team?.id != null ? String(raw.team.id) : null,
      shooterId: raw.participants?.[0]?.athlete?.id != null ? String(raw.participants[0].athlete.id) : null,
      coordinate: fieldGoal ? { x: Number(raw.coordinate.x), y: Number(raw.coordinate.y) } : null,
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
  return [...plays].reverse().find((play) => !/^end (of )?(game|period)$/i.test(play.text.trim())) ?? plays.at(-1) ?? null;
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
  if (!play) return null;
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
