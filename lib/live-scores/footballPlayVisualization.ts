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
function penaltyDetails(text: string): FootballPenaltyDetails | null {
  const match = /\bpenalty\s+on\s+([A-Z]{2,5})(?:-([A-Z]\.[A-Za-z'-]+))?\s*,\s*([^,]+)/i.exec(text);
  const hasPenalty = /\bpenalty\b/i.test(text);
  if (!hasPenalty) return null;
  const team = match?.[1]?.toUpperCase() ?? null;
  const player = match?.[2] ? match[2].replace(/^([A-Z])\./i, "$1. ").toUpperCase() : null;
  const type = match?.[3]?.trim() ? match[3].trim().toUpperCase() : null;
  return { team, player, type, firstDown: /\b(?:automatic\s+)?first down\b/i.test(text) };
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
  if (/\bno play\b/.test(lower)) return penalty ? "PENALTY · NO PLAY" : "NO PLAY";
  const administrative = administrativeLabel(type, text);
  if (administrative) return administrative;
  if (penalty?.firstDown) return "PENALTY";
  if (/\bblocked\b.*\b(?:kick|punt|field goal)\b|\b(?:kick|punt|field goal)\b.*\bblocked\b/.test(lower)) return "BLOCKED KICK";
  if (/interception|intercepted/.test(lower)) return "INTERCEPTION";
  if (fumble) return fumble.possessionLost ? "TURNOVER · FUMBLE" : "FUMBLE";
  if (isTurnover) return "TURNOVER";
  if (/kickoff/.test(lower)) return "KICKOFF";
  if (/field goal/.test(lower) && !fieldGoalGood && !fieldGoalMissed) return "FIELD GOAL ATTEMPT";
  if (/^penalty$/i.test(type) || /^penalty\b/i.test(text)) return "PENALTY";
  return null;
}
function puntDetails(text: string, offenseAbbreviation?: string | null): FootballPuntDetails | null {
  const punct = /\bpunts?\s+(\d+)\s+(?:yards|yds)\s+to\s+([A-Z]{2,5})\s+(-?\d+)\b/i.exec(text);
  if (!punct || !offenseAbbreviation) return null;
  const puntYards = Number(punct[1]), targetYard = Number(punct[3]);
  if (!Number.isFinite(puntYards) || !Number.isFinite(targetYard) || targetYard < 0 || targetYard > 100) return null;
  const targetTeam = punct[2].toUpperCase();
  const destination = targetTeam === offenseAbbreviation.toUpperCase() ? targetYard : 100 - targetYard;
  const suffix = text.slice((punct.index ?? 0) + punct[0].length);
  const returned = /\b(?:return(?:ed|s)?|pushed ob|ran ob|to\s+[A-Z]{2,5}\s+\d+\s+for)\b/i.test(suffix);
  const returnMatch = returned ? /\bfor\s+(\d+)\s+(?:yards|yds)\b/i.exec(suffix) : null;
  const lower = text.toLowerCase();
  return { destination, destinationSource: "text-derived", puntYards, returnYards: returnMatch ? Number(returnMatch[1]) : null,
    outcome: /fair catch/.test(lower) ? "fair-catch" : /downed/.test(lower) ? "downed" : /out of bounds|\b(?:pushed|ran) ob\b|\bob\./.test(lower) ? "out-of-bounds" : /touchback/.test(lower) ? "touchback" : null };
}

export function footballPlayId(play: FootballRawPlay, index = 0) {
  return String(play.id ?? play.sequenceNumber ?? `${play.period?.number ?? ""}|${play.clock?.displayValue ?? ""}|${play.text ?? "play"}|${index}`);
}

export function isMeaningfulFootballPlay(play: FootballRawPlay) {
  const type = play.type?.text ?? "";
  return !/^(Timeout|Official Timeout|TV Timeout|Two-minute warning|Two Minute Warning|End Period|End of Half|End of Game|Review)$/i.test(type);
}

export function normalizeFootballVisualizationPlay(play: FootballRawPlay, index = 0, context?: { offenseAbbreviation?: string | null }): FootballVisualizationPlay {
  const text = play.text ?? "Play";
  const type = play.type?.text ?? "";
  const lower = `${type} ${text}`.toLowerCase();
  const admin = administrativeLabel(type, text);
  const startTeam = play.start?.team?.id ? String(play.start.team.id) : null;
  const endTeam = play.end?.team?.id ? String(play.end.team.id) : null;
  const touchdown = play.scoringPlay === true && (/touchdown/.test(lower) || /touchdown/.test(play.scoringType?.name ?? ""));
  const fieldGoalGood = /field goal good/.test(lower) || (/field goal/.test(lower) && play.scoringPlay === true);
  const fieldGoalMissed = /field goal missed|field goal is no good|field goal.*no good/.test(lower);
  const penalty = penaltyDetails(text);
  const possessionChanged = Boolean(startTeam && endTeam && !sameId(startTeam, endTeam));
  const fumble = fumbleDetails(text, possessionChanged, play.isTurnover === true, context?.offenseAbbreviation);
  const semanticLabel = semanticEventLabel(type, text, play.isTurnover === true, fieldGoalGood, fieldGoalMissed, penalty, fumble);
  const semanticSecondaryLabel = semanticLabel?.startsWith("PENALTY") && penalty?.firstDown ? "FIRST DOWN" : null;
  const semanticContextLabel = semanticLabel?.startsWith("PENALTY")
    ? [penalty?.type, penalty?.team ? [penalty.team, penalty.player].filter(Boolean).join(" · ") : null].filter(Boolean).join(" · ") || null
    : null;
  const start = semanticLabel ? null : spot(play.start?.yardsToEndzone);
  // ESPN end.yardsToEndzone is receiver-relative after a possession change.
  const ordinaryEnd = spot(play.end?.yardsToEndzone);
  const end = semanticLabel ? null : touchdown ? 100 : possessionChanged
    ? (number(play.end?.yardsToEndzone) ?? null)
    : ordinaryEnd;
  const family: FootballPlayFamily = admin ? "administrative" : /sack/.test(lower) ? "sack"
    : /scramble/.test(lower) ? "scramble"
    : /pass incomplet|incomplete pass/.test(lower) ? "incomplete"
    : /pass reception|passing touchdown|\bpass (?:short|deep|complete)/.test(lower) ? "pass"
    : /field goal/.test(lower) ? "field-goal" : /punt/.test(lower) ? "punt"
    : /rush|run|kneel/.test(lower) ? "run" : "other";
  const animation: FootballAnimationFamily = semanticLabel ? "none" : family === "run" || family === "scramble" ? "run"
    : family === "sack" ? "sack" : family === "pass" ? "pass" : family === "incomplete" ? "incomplete"
    : family === "field-goal" ? "field-goal" : family === "punt" ? "punt" : "none";
  const canTravel = start !== null && end !== null && (!possessionChanged || family === "punt");
  const animate = animation === "incomplete" || animation === "field-goal" || (animation !== "none" && canTravel);
  const distance = number(play.start?.distance);
  const hasOffensiveDownContext = family === "run" || family === "scramble" || family === "sack" || family === "pass" || family === "incomplete";
  const firstDown = hasOffensiveDownContext && start !== null && distance !== null && distance > 0 && start + distance < 100 ? start + distance : null;
  const staticLabel = family === "other" && end !== null ? /fumble/.test(lower) ? "FUMBLE" : /interception|intercepted/.test(lower) ? "TURNOVER" : /kickoff/.test(lower) ? "KICKOFF" : null : null;
  const renderMode = semanticLabel ? "semantic" as const : animate ? "animated" as const : "static" as const;
  const punt = family === "punt" ? puntDetails(text, context?.offenseAbbreviation) : null;
  return {
    id: footballPlayId(play, index), text, family, animation, offenseTeamId: startTeam,
    period: number(play.period?.number), clock: play.clock?.displayValue ?? null, start, end,
    firstDown, downDistance: play.start?.shortDownDistanceText ?? null,
    scoring: semanticLabel ? null : touchdown ? "touchdown" : fieldGoalGood ? "field-goal-good" : fieldGoalMissed ? "field-goal-missed" : null,
    qualifier: family === "pass" || family === "incomplete" ? passQualifier(text) : null,
    possessionChanged, confidence: possessionChanged ? "result-only" : start !== null && end !== null ? "provider" : "result-only",
    animate, resultOnly: renderMode === "static", renderMode, administrativeLabel: admin, semanticLabel, semanticSecondaryLabel, semanticContextLabel, staticLabel, punt, penalty, fumble,
  };
}
