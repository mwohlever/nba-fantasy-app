import { possessionTeamId } from "./possession";

type Spot = { down?: number; distance?: number; yardsToEndzone?: number; possessionText?: string; shortDownDistanceText?: string; team?: { id?: string } };
export type FootballPlay = { id?: string; text?: string; type?: { id?: string; text?: string; abbreviation?: string }; scoringPlay?: boolean; isTurnover?: boolean; isPenalty?: boolean; pointAfterAttempt?: boolean; scoringType?: string; period?: { number?: number }; clock?: { displayValue?: string }; start?: Spot; end?: Spot };
type Drive = { team?: { id?: string }; plays?: FootballPlay[] };
export type NflFieldInput = { header?: { competitions?: Array<{ status?: { type?: { state?: string; completed?: boolean; name?: string; description?: string } }; competitors?: Array<{ id?: string; possession?: boolean; team?: { id?: string; abbreviation?: string; color?: string } }> }> }; drives?: { current?: Drive; previous?: Drive[] } };
export type FootballEvent = { id: string | null; text: string; type: string; period: number | null; clock: string };
export type FootballEventEmphasis = { kind: "touchdown" | "field-goal" | "interception" | "turnover"; team: string | null; secondary?: "interception-return" };
export type NflFieldState = { offense: string; defense: string; color: string | null; ball: number | null; firstDown: number | null; downDistance: string; position: string; clock: string; latestPlay: string; stateLabel?: string; latestEvent: FootballEvent | null; lastFootballPlay: FootballEvent | null; fieldStatePlay: FootballEvent | null; eventEmphasis: FootballEventEmphasis | null };

const ADMIN_TYPES = new Set(["Timeout", "Official Timeout", "TV Timeout", "Two-minute warning", "Two Minute Warning", "End Period", "End of Half", "End of Game", "Review"]);
const SCORE_FOLLOW_UP_TYPES = new Set(["Extra Point Good", "Extra Point No Good", "Two-Point Conversion", "Two-Point Conversion Good", "Two-Point Conversion No Good"]);
const TRANSITION_TYPES = new Set(["Punt", "Kickoff"]);
const typeText = (play: FootballPlay) => play.type?.text ?? "";
const isAdministrative = (play: FootballPlay) => ADMIN_TYPES.has(typeText(play));
const isScoreFollowUp = (play: FootballPlay) => Boolean(play.pointAfterAttempt) || SCORE_FOLLOW_UP_TYPES.has(typeText(play));

function eventFrom(play: FootballPlay | undefined): FootballEvent | null {
  return play ? { id: play.id ?? null, text: play.text ?? "", type: typeText(play), period: Number.isInteger(play.period?.number) ? play.period!.number! : null, clock: play.clock?.displayValue ?? "" } : null;
}

function hasUsableEndSpot(play: FootballPlay, possession: string) {
  const yards = play.end?.yardsToEndzone;
  if (isAdministrative(play) || play.scoringPlay || isScoreFollowUp(play)) return false;
  if (play.isTurnover && String(play.start?.team?.id ?? "") === String(play.end?.team?.id ?? "")) return false;
  return String(play.end?.team?.id ?? "") === possession && typeof yards === "number" && Number.isFinite(yards) && yards > 0 && yards < 100;
}

function unresolvedTransition(play: FootballPlay) {
  return Boolean(play.isTurnover || TRANSITION_TYPES.has(typeText(play)) || play.scoringPlay) &&
    (!play.end?.team?.id || (play.isTurnover && String(play.start?.team?.id ?? "") === String(play.end?.team?.id)));
}

function teamAbbreviation(teamId: string | undefined, teams: Array<{ id?: string; team?: { id?: string; abbreviation?: string } }>) {
  return teamId ? teams.find((team) => String(team.team?.id ?? team.id) === String(teamId))?.team?.abbreviation ?? null : null;
}

function emphasisFor(play: FootballPlay, possession: string, teams: Array<{ id?: string; team?: { id?: string; abbreviation?: string } }>): FootballEventEmphasis | null {
  const typeId = play.type?.id;
  if (play.scoringPlay && (typeId === "67" || typeId === "68")) return { kind: "touchdown", team: teamAbbreviation(play.end?.team?.id, teams) };
  if (play.scoringPlay && typeId === "59") return { kind: "field-goal", team: teamAbbreviation(play.end?.team?.id, teams) };
  if (!play.isTurnover) return null;
  if (typeId === "26" || typeId === "63") return { kind: "interception", team: teamAbbreviation(possession, teams) };
  return { kind: "turnover", team: teamAbbreviation(possession, teams) };
}

/** Shared NFL/college resolver. ESPN history, not browser memory, is authoritative. */
export function normalizeNflField(summary: NflFieldInput): NflFieldState | null {
  const competition = summary.header?.competitions?.[0];
  if (competition?.status?.type?.state !== "in" || competition.status.type.completed || competition.status.type.name === "STATUS_HALFTIME") return null;
  const possession = possessionTeamId(competition);
  const teams = competition.competitors ?? [];
  if (!possession || teams.length !== 2) return null;
  const offense = teams.find((team) => String(team.team?.id ?? team.id) === possession)?.team;
  const defense = teams.find((team) => String(team.team?.id ?? team.id) !== possession)?.team;
  if (!offense?.abbreviation || !defense?.abbreviation) return null;

  const drives = [...(summary.drives?.previous ?? []), ...(summary.drives?.current ? [summary.drives.current] : [])];
  const plays = drives.flatMap((drive) => drive.plays ?? []).slice(-50);
  const latest = plays.at(-1);
  if (!latest) return null;
  let lastFootball: FootballPlay | undefined;
  let fieldPlay: FootballPlay | undefined;
  let unsafeTransition = false;
  for (let index = plays.length - 1; index >= 0; index--) {
    const play = plays[index];
    if (!lastFootball && !isAdministrative(play) && !isScoreFollowUp(play)) lastFootball = play;
    if (!fieldPlay && hasUsableEndSpot(play, possession)) fieldPlay = play;
    if (!fieldPlay && unresolvedTransition(play)) unsafeTransition = true;
  }
  if (!fieldPlay || unsafeTransition) return null;

  let emphasisPlay: FootballPlay | undefined;
  for (let index = plays.length - 1; index >= 0; index--) {
    const play = plays[index];
    if (!isAdministrative(play) && !isScoreFollowUp(play)) { emphasisPlay = play; break; }
  }
  const spot = fieldPlay.end!;
  const yards = spot.yardsToEndzone!;
  const ball = 100 - yards;
  const down = spot.down;
  const distance = spot.distance;
  const validDown = Number.isInteger(down) && down! >= 1 && down! <= 4;
  const validDistance = typeof distance === "number" && Number.isFinite(distance) && distance > 0;
  const goal = validDistance && distance! >= yards;
  const period = fieldPlay.period?.number;
  const playClock = fieldPlay.clock?.displayValue;
  const validClock = Number.isInteger(period) && period! > 0 && playClock && /^\d{1,2}:[0-5]\d$/.test(playClock) && !/^0+:00$/.test(playClock);
  return {
    offense: offense.abbreviation, defense: defense.abbreviation, color: /^[a-f\d]{6}$/i.test(offense.color ?? "") ? `#${offense.color}` : null,
    ball, firstDown: validDown && validDistance && !goal ? Math.min(100, ball + distance!) : null,
    downDistance: validDown && validDistance ? `${["", "1st", "2nd", "3rd", "4th"][down!]} & ${goal ? "Goal" : distance}` : spot.shortDownDistanceText ?? "",
    position: yards === 50 ? "50" : yards < 50 ? `${defense.abbreviation} ${yards}` : `${offense.abbreviation} ${100 - yards}`,
    clock: validClock ? `${playClock} ${period! <= 4 ? `Q${period}` : `OT${period! - 4}`}` : "", stateLabel: fieldPlay === latest ? "After latest play" : "Retained field state",
    latestPlay: lastFootball?.text ?? "", latestEvent: eventFrom(latest), lastFootballPlay: eventFrom(lastFootball), fieldStatePlay: eventFrom(fieldPlay), eventEmphasis: emphasisPlay ? emphasisFor(emphasisPlay, possession, teams) : null,
  };
}
