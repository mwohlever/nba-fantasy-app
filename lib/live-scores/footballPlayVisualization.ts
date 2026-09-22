/** A deliberately conservative adapter for ESPN NFL and college-football PBP. */
export type FootballPlayFamily = "run" | "scramble" | "sack" | "pass" | "incomplete" | "field-goal" | "punt" | "administrative" | "other";
export type FootballAnimationFamily = "run" | "sack" | "pass" | "incomplete" | "field-goal" | "punt" | "none";
export type FootballRawPlay = {
  id?: string; sequenceNumber?: string | number; text?: string; statYardage?: number; scoringPlay?: boolean; isTurnover?: boolean; awayScore?: number; homeScore?: number;
  type?: { id?: string; text?: string; abbreviation?: string }; period?: { number?: number }; clock?: { displayValue?: string };
  start?: { team?: { id?: string }; yardsToEndzone?: number; down?: number; distance?: number; shortDownDistanceText?: string };
  end?: { team?: { id?: string }; yardsToEndzone?: number; down?: number; distance?: number; shortDownDistanceText?: string };
  scoringType?: { name?: string; displayName?: string }; pointAfterAttempt?: unknown; isPenalty?: boolean;
};
export type FootballPuntDetails = {
  destination: number | null;
  /** Explicit "TEAM 47" prose before conversion into the kicking team's display space. */
  destinationAbsolute?: number | null;
  destinationSource: "text-derived" | null;
  puntYards: number | null;
  returnYards: number | null;
  outcome: "fair-catch" | "downed" | "out-of-bounds" | "touchback" | null;
};
export type FootballPenaltyDetails = {
  team: string | null;
  player: string | null;
  type: string | null;
  firstDown: boolean;
  outcome: "NO PLAY" | "FIRST DOWN" | "DECLINED" | "OFFSETTING" | `${number} YARDS` | null;
  declined: boolean;
};
export type FootballFumbleDetails = {
  recoveryTeam: string | null;
  possessionLost: boolean;
  possessionLossSource: "structured" | "text-derived" | null;
};
export type FootballVisualizationPlay = {
  id: string; text: string; family: FootballPlayFamily; animation: FootballAnimationFamily; offenseTeamId: string | null;
  period: number | null; clock: string | null; start: number | null; end: number | null; firstDown: number | null;
  downDistance: string | null; scoring: "touchdown" | "field-goal-good" | "field-goal-missed" | null;
  qualifier: string | null; possessionChanged: boolean; confidence: "provider" | "derived" | "result-only"; animate: boolean; resultOnly: boolean;
  renderMode: "animated" | "static" | "semantic"; administrativeLabel: string | null; semanticLabel: string | null; semanticSecondaryLabel: string | null; semanticContextLabel: string | null; staticLabel: string | null;
  punt: FootballPuntDetails | null;
  penalty: FootballPenaltyDetails | null;
  fumble: FootballFumbleDetails | null;
};
export type FootballFieldTeam = { id?: string | null; abbreviation?: string | null };
export type FootballAttackDirection = "left" | "right";
export type FootballResultingState = { teamId: string; downDistance: string };

/** Presentation-only convention: the home team attacks left; the away team attacks right. */
export function footballTeamAttackDirection(offenseTeamId: string | null | undefined, homeTeamId: string | null | undefined, awayTeamId: string | null | undefined): FootballAttackDirection | null {
  if (!offenseTeamId) return null;
  if (homeTeamId && String(offenseTeamId) === String(homeTeamId)) return "left";
  if (awayTeamId && String(offenseTeamId) === String(awayTeamId)) return "right";
  return null;
}

/** Converts offense-relative provider coordinates into the stable matchup presentation. */
export function orientFootballVisualizationPlay(play: FootballVisualizationPlay, direction: FootballAttackDirection | null): FootballVisualizationPlay {
  return { ...play, start: footballStablePosition(play.start, direction), end: footballStablePosition(play.end, direction), firstDown: footballStablePosition(play.firstDown, direction), punt: play.punt ? { ...play.punt, destination: play.punt.destinationAbsolute ?? footballStablePosition(play.punt.destination, direction) } : null };
}

/** Converts provider-relative coordinates only for callers that still own raw provider space. */
export function footballStablePosition(yard: number | null, direction: FootballAttackDirection | null) {
  return yard === null ? null : direction === "left" ? 100 - yard : yard;
}

/** A named yardline is absolute on the matchup field: home occupies 0..50; away occupies 50..100. */
export function namedYardlineToMatchupPosition(teamAbbreviation: string, yard: number, homeAbbreviation?: string | null, awayAbbreviation?: string | null) {
  if (!Number.isFinite(yard) || yard < 0 || yard > 100) return null;
  const team = teamAbbreviation.toUpperCase();
  if (team === homeAbbreviation?.toUpperCase()) return yard;
  if (team === awayAbbreviation?.toUpperCase()) return 100 - yard;
  return null;
}

export function footballEndZoneLabels(homeTeam?: FootballFieldTeam, awayTeam?: FootballFieldTeam) {
  return { left: homeTeam?.abbreviation || "END", right: awayTeam?.abbreviation || "END" };
}

export function footballSelectedPlayContext(play: FootballVisualizationPlay | null, offense: string | null | undefined, direction: FootballAttackDirection | null) {
  const possession = offense ? direction === "left" ? `← ${offense}` : direction === "right" ? `${offense} →` : offense : null;
  return [possession, play?.downDistance?.toUpperCase(), play?.period ? `Q${play.period}` : null, play?.clock].filter(Boolean).join(" · ");
}

/** The parsed punt landing spot is the kick endpoint; a structured end is only a return endpoint. */
export function footballPuntCoordinates(play: FootballVisualizationPlay) {
  const destination = play.punt?.destination ?? null;
  const returnEnd = destination !== null && play.punt?.returnYards !== null && play.punt?.returnYards !== undefined && play.end !== null && Math.abs(destination - play.end) >= 1 ? play.end : null;
  return { kickEnd: destination ?? play.end, returnEnd };
}

/** Shared SVG geometry for the punt arc and its animated ball; x increases to the right. */
export function footballPuntSvgGeometry(start: number, end: number, progress: number) {
  const clamped = Math.max(0, Math.min(progress, 1));
  const svgStartX = 18 + start * 2.84;
  const svgEndX = 18 + end * 2.84;
  const controlX = (svgStartX + svgEndX) / 2;
  const renderedBallX = (1 - clamped) * (1 - clamped) * svgStartX + 2 * (1 - clamped) * clamped * controlX + clamped * clamped * svgEndX;
  const renderedBallY = 33 - Math.sin(clamped * Math.PI) * 20;
  return { svgStartX, svgEndX, controlX, renderedBallX, renderedBallY, pathD: `M ${svgStartX} 33 Q ${controlX} 10 ${svgEndX} 33` };
}

export function withFootballResultingState(play: FootballVisualizationPlay, state: FootballResultingState | null, teamAbbreviation?: string | null): FootballVisualizationPlay {
  if (!state || !play.semanticLabel || play.administrativeLabel) return play;
  return { ...play, semanticSecondaryLabel: `${state.downDistance.toUpperCase()}${teamAbbreviation ? ` · ${teamAbbreviation}` : ""}` };
}

/** Finds the next structured scrimmage state without crossing a period boundary. */
export function nextFootballResultingState(plays: FootballRawPlay[], selectedId: string, context?: { offenseAbbreviation?: string | null; teamAbbreviations?: string[] }): FootballResultingState | null {
  const index = plays.findIndex(play => footballPlayId(play) === selectedId);
  const selected = plays[index];
  if (!selected) return null;
  for (const candidate of plays.slice(index + 1)) {
    if (candidate.period?.number !== selected.period?.number) return null;
    const normalized = normalizeFootballVisualizationPlay(candidate, 0, { teamAbbreviations: context?.teamAbbreviations });
    const teamId = candidate.start?.team?.id ? String(candidate.start.team.id) : null;
    const down = candidate.start?.shortDownDistanceText ?? (candidate.start?.down && number(candidate.start.distance) !== null ? `${candidate.start.down === 1 ? "1st" : candidate.start.down === 2 ? "2nd" : candidate.start.down === 3 ? "3rd" : `${candidate.start.down}th`} & ${candidate.start.distance}` : null);
    if (teamId && down && !normalized.administrativeLabel && normalized.family !== "field-goal" && !/kickoff/i.test(`${candidate.type?.text ?? ""} ${candidate.text ?? ""}`)) return { teamId, downDistance: down };
  }
  return null;
}

const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const spot = (yardsToEndzone: unknown) => { const value = number(yardsToEndzone); return value !== null && value >= 0 && value <= 100 ? 100 - value : null; };
const sameId = (a?: string, b?: string) => Boolean(a && b && String(a) === String(b));

function passQualifier(text: string) {
  const match = /\bpass\s+(?:complete\s+)?(short|deep)\s+(left|middle|right)\b/i.exec(text);
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : null;
}
function administrativeLabel(type: string, text: string) {
  const value = `${type} ${text}`.toLowerCase();
  if (/timeout/.test(value)) return "TIMEOUT";
  if (/two[- ]minute/.test(value)) return "TWO-MINUTE WARNING";
  if (/end (of )?(quarter|period)/.test(value)) return "END QUARTER";
  if (/end of half|end quarter 2/.test(value)) return "END HALF";
  if (/end (of )?game/.test(value)) return "END GAME";
  if (/review/.test(value)) return "REVIEW";
  return null;
}
function penaltyDetails(text: string, teamAbbreviations: string[] = []): FootballPenaltyDetails | null {
  const match = /\bpenalty\s+on\s+([A-Z]{2,5})(?:-([A-Z]\.[A-Za-z'-]+))?\s*,\s*([^,]+)/i.exec(text);
  const hasPenalty = /\bpenalty\b/i.test(text);
  if (!hasPenalty) return null;
  const parsedTeam = match?.[1]?.toUpperCase() ?? null;
  const candidates = [...new Set(teamAbbreviations.map(value => value.toUpperCase()).filter(Boolean))];
  const matchedTeams = parsedTeam ? candidates.filter(candidate => candidate === parsedTeam || candidate.startsWith(parsedTeam) || parsedTeam.startsWith(candidate)) : [];
  const team = matchedTeams.length === 1 ? matchedTeams[0] : parsedTeam;
  const player = match?.[2] ? match[2].replace(/^([A-Z])\./i, "$1. ").toUpperCase() : null;
  const type = match?.[3]?.split(/\s+-\s+(?:no play|declined|offsetting)\b/i)[0]?.trim().replace(/[.]+$/, "").toUpperCase() || null;
  const declined = /\bdeclined\b/i.test(text);
  const noPlay = /\bno play\b/i.test(text);
  // Defensive pass interference awards a first down in both NFL and NCAA rules; keep this deliberately narrow.
  const firstDown = !declined && (/\b(?:automatic\s+)?first down\b/i.test(text) || type === "DEFENSIVE PASS INTERFERENCE");
  const yards = /\b(\d+)\s+yards?\b/i.exec(match?.[0] ?? text)?.[1];
  const outcome = firstDown ? "FIRST DOWN" : noPlay ? "NO PLAY" : declined ? "DECLINED" : /\boffsetting\b/i.test(text) ? "OFFSETTING" : yards ? `${Number(yards)} YARDS` as const : null;
  return { team, player, type, firstDown, outcome, declined };
}
function fumbleDetails(text: string, possessionChanged: boolean, isTurnover: boolean, offenseAbbreviation?: string | null): FootballFumbleDetails | null {
  if (!/\bfumble/.test(text.toLowerCase())) return null;
  const recovery = /\brecovered\s+by\s+([A-Z]{2,5})(?:-|\b)/i.exec(text)?.[1]?.toUpperCase() ?? null;
  if (possessionChanged || isTurnover) return { recoveryTeam: recovery, possessionLost: true, possessionLossSource: "structured" };
  if (recovery && offenseAbbreviation) return { recoveryTeam: recovery, possessionLost: recovery !== offenseAbbreviation.toUpperCase(), possessionLossSource: "text-derived" };
  return { recoveryTeam: recovery, possessionLost: false, possessionLossSource: null };
}
function semanticEventLabel(type: string, text: string, isTurnover: boolean, fieldGoalGood: boolean, fieldGoalMissed: boolean, penalty: FootballPenaltyDetails | null, fumble: FootballFumbleDetails | null) {
  const lower = `${type} ${text}`.toLowerCase();
  // The official ruling nullifies any apparent action that may precede it in ESPN prose.
  if (/\bno play\b/.test(lower)) return penalty ? penaltyLabel(penalty) : "NO PLAY";
  const administrative = administrativeLabel(type, text);
  if (administrative) return administrative;
  if (penalty?.firstDown) return penaltyLabel(penalty);
  if (/\bblocked\b.*\b(?:kick|punt|field goal)\b|\b(?:kick|punt|field goal)\b.*\bblocked\b/.test(lower)) return "BLOCKED KICK";
  if (/interception|intercepted/.test(lower)) return "INTERCEPTION";
  if (fumble) return fumble.possessionLost ? "TURNOVER · FUMBLE" : "FUMBLE";
  if (isTurnover) return "TURNOVER";
  if (/kickoff/.test(lower)) return "KICKOFF";
  if (/field goal/.test(lower) && !fieldGoalGood && !fieldGoalMissed) return "FIELD GOAL ATTEMPT";
  if ((/^penalty$/i.test(type) || /^penalty\b/i.test(text)) && !penalty?.declined) return penalty ? penaltyLabel(penalty) : "PENALTY";
  return null;
}
function penaltyLabel(penalty: FootballPenaltyDetails) {
  const base = penalty.type ? penalty.type : "PENALTY";
  return penalty.team ? `${base} ON ${penalty.team}` : base;
}
function puntDetails(text: string, context?: { offenseAbbreviation?: string | null; homeAbbreviation?: string | null; awayAbbreviation?: string | null }): FootballPuntDetails | null {
  const punct = /\bpunts?\s+(\d+)\s+(?:yards|yds)\s+to\s+([A-Z]{2,5})\s+(-?\d+)\b/i.exec(text);
  const lower = text.toLowerCase();
  const touchback = /\btouchback\b/.test(lower);
  const puntYards = punct ? Number(punct[1]) : Number(/\bpunts?\s+(\d+)\s+(?:yards|yds)\b/i.exec(text)?.[1]);
  if (touchback && Number.isFinite(puntYards)) return { destination: 100, destinationSource: "text-derived", puntYards, returnYards: null, outcome: "touchback" };
  if (!punct || !context?.offenseAbbreviation) return null;
  const targetYard = Number(punct[3]);
  if (!Number.isFinite(puntYards) || !Number.isFinite(targetYard) || targetYard < 0 || targetYard > 100) return null;
  const targetTeam = punct[2].toUpperCase();
  const destination = targetTeam === context.offenseAbbreviation.toUpperCase() ? targetYard : 100 - targetYard;
  const absolute = namedYardlineToMatchupPosition(targetTeam, targetYard, context.homeAbbreviation, context.awayAbbreviation);
  const destinationAbsolute = absolute === null ? undefined : absolute;
  const suffix = text.slice((punct.index ?? 0) + punct[0].length);
  const returned = /\b(?:return(?:ed|s)?|pushed ob|ran ob|to\s+[A-Z]{2,5}\s+\d+\s+for)\b/i.test(suffix);
  const returnMatch = returned ? /\bfor\s+(\d+)\s+(?:yards|yds)\b/i.exec(suffix) : null;
  return { destination, ...(destinationAbsolute !== undefined ? { destinationAbsolute } : {}), destinationSource: "text-derived", puntYards, returnYards: returnMatch ? Number(returnMatch[1]) : null,
    outcome: /fair catch/.test(lower) ? "fair-catch" : /downed/.test(lower) ? "downed" : /out of bounds|\b(?:pushed|ran) ob\b|\bob\./.test(lower) ? "out-of-bounds" : /touchback/.test(lower) ? "touchback" : null };
}

export function footballPlayId(play: FootballRawPlay, index = 0) {
  return String(play.id ?? play.sequenceNumber ?? `${play.period?.number ?? ""}|${play.clock?.displayValue ?? ""}|${play.text ?? "play"}|${index}`);
}

export function isMeaningfulFootballPlay(play: FootballRawPlay) {
  const type = play.type?.text ?? "";
  return !/^(Timeout|Official Timeout|TV Timeout|Two-minute warning|Two Minute Warning|End Period|End of Half|End of Game|Review)$/i.test(type);
}

export function normalizeFootballVisualizationPlay(play: FootballRawPlay, index = 0, context?: { offenseAbbreviation?: string | null; teamAbbreviations?: string[]; homeAbbreviation?: string | null; awayAbbreviation?: string | null; homeTeamId?: string | null; awayTeamId?: string | null }): FootballVisualizationPlay {
  const text = play.text ?? "Play";
  const type = play.type?.text ?? "";
  const lower = `${type} ${text}`.toLowerCase();
  const admin = administrativeLabel(type, text);
  const startTeam = play.start?.team?.id ? String(play.start.team.id) : null;
  const endTeam = play.end?.team?.id ? String(play.end.team.id) : null;
  const touchdown = play.scoringPlay === true && (/touchdown/.test(lower) || /touchdown/.test(play.scoringType?.name ?? ""));
  const fieldGoalGood = /field goal good/.test(lower) || (/field goal/.test(lower) && play.scoringPlay === true);
  const fieldGoalMissed = /field goal missed|field goal is no good|field goal.*no good/.test(lower);
  const penalty = penaltyDetails(text, context?.teamAbbreviations);
  const possessionChanged = Boolean(startTeam && endTeam && !sameId(startTeam, endTeam));
  const fumble = fumbleDetails(text, possessionChanged, play.isTurnover === true, context?.offenseAbbreviation);
  const semanticLabel = semanticEventLabel(type, text, play.isTurnover === true, fieldGoalGood, fieldGoalMissed, penalty, fumble);
  const semanticSecondaryLabel = penalty && semanticLabel === penaltyLabel(penalty) ? penalty.outcome : null;
  const semanticContextLabel = penalty && semanticLabel === penaltyLabel(penalty)
    ? penalty.player ? penalty.player : null
    : null;
  const family: FootballPlayFamily = admin ? "administrative" : /sack/.test(lower) ? "sack"
    : /scramble/.test(lower) ? "scramble"
    : /pass incomplet|incomplete pass/.test(lower) ? "incomplete"
    : /pass reception|passing touchdown|\bpass (?:short|deep|complete)/.test(lower) ? "pass"
    : /field goal/.test(lower) ? "field-goal" : /punt/.test(lower) ? "punt"
    : /rush|run|kneel/.test(lower) ? "run" : "other";
  const direction = footballTeamAttackDirection(startTeam, context?.homeTeamId, context?.awayTeamId);
  // ESPN scrimmage yardsToEndzone is offense-relative. Convert it exactly once
  // to the stable home-left / away-right presentation. Punt starts are a
  // separate provider shape: their structured value is already matchup-oriented.
  const structuredPosition = (value: unknown) => footballStablePosition(spot(value), direction);
  const start = semanticLabel ? null : family === "punt" ? spot(play.start?.yardsToEndzone) : structuredPosition(play.start?.yardsToEndzone);
  // ESPN end.yardsToEndzone is receiver-relative after a possession change.
  const ordinaryEnd = family === "punt" ? spot(play.end?.yardsToEndzone) : structuredPosition(play.end?.yardsToEndzone);
  const end = semanticLabel ? null : touchdown ? direction === "left" ? 0 : 100 : possessionChanged
    ? (number(play.end?.yardsToEndzone) ?? null)
    : ordinaryEnd;
  const animation: FootballAnimationFamily = semanticLabel ? "none" : family === "run" || family === "scramble" ? "run"
    : family === "sack" ? "sack" : family === "pass" ? "pass" : family === "incomplete" ? "incomplete"
    : family === "field-goal" ? "field-goal" : family === "punt" ? "punt" : "none";
  const canTravel = start !== null && end !== null && (!possessionChanged || family === "punt");
  const animate = animation === "incomplete" || animation === "field-goal" || (animation !== "none" && canTravel);
  const distance = number(play.start?.distance);
  const hasOffensiveDownContext = family === "run" || family === "scramble" || family === "sack" || family === "pass" || family === "incomplete";
  const firstDown = hasOffensiveDownContext && start !== null && distance !== null && distance > 0
    ? direction === "left" ? start - distance >= 0 ? start - distance : null : start + distance < 100 ? start + distance : null
    : null;
  const staticLabel = family === "other" && end !== null ? /fumble/.test(lower) ? "FUMBLE" : /interception|intercepted/.test(lower) ? "TURNOVER" : /kickoff/.test(lower) ? "KICKOFF" : null : null;
  const renderMode = semanticLabel ? "semantic" as const : animate ? "animated" as const : "static" as const;
  const parsedPunt = family === "punt" ? puntDetails(text, context) : null;
  // Named punt landings are parsed as matchup-absolute first, then converted
  // once into the same team-relative presentation space as the kick start.
  const punt = parsedPunt?.destinationAbsolute !== undefined
    ? { ...parsedPunt, destination: footballStablePosition(parsedPunt.destinationAbsolute, direction) }
    : parsedPunt;
  return {
    id: footballPlayId(play, index), text, family, animation, offenseTeamId: startTeam,
    period: number(play.period?.number), clock: play.clock?.displayValue ?? null, start, end,
    firstDown, downDistance: semanticLabel ? null : play.start?.shortDownDistanceText ?? (play.start?.down && distance !== null ? `${play.start.down === 1 ? "1st" : play.start.down === 2 ? "2nd" : play.start.down === 3 ? "3rd" : `${play.start.down}th`} & ${distance}` : null),
    scoring: semanticLabel ? null : touchdown ? "touchdown" : fieldGoalGood ? "field-goal-good" : fieldGoalMissed ? "field-goal-missed" : null,
    qualifier: family === "pass" || family === "incomplete" ? passQualifier(text) : null,
    possessionChanged, confidence: possessionChanged ? "result-only" : start !== null && end !== null ? "provider" : "result-only",
    animate, resultOnly: renderMode === "static", renderMode, administrativeLabel: admin, semanticLabel, semanticSecondaryLabel, semanticContextLabel, staticLabel, punt, penalty, fumble,
  };
}
