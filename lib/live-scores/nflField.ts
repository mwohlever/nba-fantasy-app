import { possessionTeamId } from "./possession";

type Spot = { down?: number; distance?: number; yardsToEndzone?: number; possessionText?: string; shortDownDistanceText?: string; team?: { id?: string } };
type Play = { text?: string; type?: { text?: string }; scoringPlay?: boolean; isTurnover?: boolean; period?: { number?: number }; clock?: { displayValue?: string }; end?: Spot };
export type NflFieldInput = {
  header?: { competitions?: Array<{
    status?: { type?: { state?: string; completed?: boolean; name?: string; description?: string } };
    competitors?: Array<{ id?: string; possession?: boolean; team?: { id?: string; abbreviation?: string; color?: string } }>;
  }> };
  drives?: { current?: { team?: { id?: string }; plays?: Play[] } };
};
export type NflFieldState = {
  offense: string; defense: string; color: string | null; ball: number | null; firstDown: number | null;
  downDistance: string; position: string; clock: string; latestPlay: string; stateLabel?: string;
};

/** Shared ESPN NFL/college structured end spot, never a previous drive.
 * yardsToEndzone is offense-relative; yardLine is NOT (and is intentionally unused).
 * This is a normalized offense-left-to-right field, not stadium/broadcast direction.
 */
export function normalizeNflField(summary: NflFieldInput): NflFieldState | null {
  const competition = summary.header?.competitions?.[0];
  const status = competition?.status;
  if (status?.type?.name !== "STATUS_IN_PROGRESS") return null;
  const possession = possessionTeamId(competition);
  const teams = competition?.competitors ?? [];
  if (!possession || teams.length !== 2) return null;
  const offense = teams.find(team => String(team.team?.id ?? team.id) === possession)?.team;
  const defense = teams.find(team => String(team.team?.id ?? team.id) !== possession)?.team;
  const drive = summary.drives?.current;
  const plays = drive?.plays ?? [];
  let play = plays.at(-1);
  let reused = false;
  // Skip only provider-typed events that cannot move the ball. Never cross a
  // snap, penalty, score, punt, turnover, period boundary, or drive boundary.
  for (let i = plays.length - 1; i > 0 && play &&
    ["Timeout", "Official Timeout", "TV Timeout", "Two Minute Warning", "Two-Minute Warning"].includes(play.type?.text ?? "") &&
    !play.scoringPlay && !play.isTurnover; i--) {
    const previous = plays[i - 1];
    if (play.period?.number != null && previous.period?.number != null && play.period.number !== previous.period.number) break;
    play = previous; reused = true;
  }
  // No inference from play text, completed drives, or stale scoring/turnover spots.
  if (!offense?.abbreviation || !defense?.abbreviation || String(drive?.team?.id) !== possession ||
      !play || play.scoringPlay || play.isTurnover ||
      !["Rush", "Pass Reception", "Pass Incompletion", "Sack", "Penalty"].includes(play.type?.text ?? "")) return null;
  const spot = play.end;
  if (String(spot?.team?.id) !== possession) return null;
  const yards = spot?.yardsToEndzone;
  const down = spot?.down;
  const distance = spot?.distance;
  const validYards = typeof yards === "number" && Number.isFinite(yards) && yards > 0 && yards < 100;
  const validDown = Number.isInteger(down) && down! >= 1 && down! <= 4;
  const validDistance = typeof distance === "number" && Number.isFinite(distance) && distance > 0;
  const period = play.period?.number;
  const clock = play.clock?.displayValue;
  const validClock = Number.isInteger(period) && period! > 0 && clock && /^\d{1,2}:[0-5]\d$/.test(clock) && !/^0+:00$/.test(clock);
  const ball = validYards ? 100 - yards! : null;
  const goal = validYards && validDistance && distance! >= yards!;
  const position = !validYards ? "" : yards === 50 ? "50" : yards! < 50 ? `${defense.abbreviation} ${yards}` : `${offense.abbreviation} ${100 - yards!}`;
  return {
    offense: offense.abbreviation, defense: defense.abbreviation,
    color: /^[a-f\d]{6}$/i.test(offense.color ?? "") ? `#${offense.color}` : null,
    ball, firstDown: ball !== null && validDown && validDistance && !goal ? ball + distance! : null,
    downDistance: validDown && validDistance ? `${["", "1st", "2nd", "3rd", "4th"][down!]} & ${goal ? "Goal" : distance}` : "",
    position, clock: validClock ? `${clock} ${period! <= 4 ? `Q${period}` : `OT${period! - 4}`}` : "",
    stateLabel: reused ? "Last structured spot" : "After latest play",
    latestPlay: play.text ?? "",
  };
}
