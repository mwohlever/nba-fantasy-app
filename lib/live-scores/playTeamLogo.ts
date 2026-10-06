import type { FootballRawPlay } from "./footballPlayVisualization";
import type { NbaPlay } from "./nbaPlays";

export type PlayLogoTeam = {
  id: string;
  logo: string | null;
};

export type FootballLogoPlay = FootballRawPlay & {
  teamParticipants?: Array<{ id?: string; type?: string }>;
};

const providerTeamId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d*$/.test(value);

/** Resolve only against this game's two distinct provider teams. */
export function resolvePlayLogoTeam(teamId: unknown, teams: readonly PlayLogoTeam[]): PlayLogoTeam | null {
  if (!providerTeamId(teamId) || !Array.isArray(teams) || teams.length !== 2 ||
      !teams.every(team => team && providerTeamId(team.id)) || teams[0].id === teams[1].id) return null;
  return teams.find(team => team.id === teamId) ?? null;
}

const footballTypes = new Map([
  ["3", "Pass Incompletion"], ["5", "Rush"], ["7", "Sack"],
  ["9", "Fumble Recovery (Own)"], ["14", "Punt Return"], ["18", "Blocked Field Goal"],
  ["24", "Pass Reception"], ["26", "Pass Interception Return"],
  ["29", "Fumble Recovery (Opponent)"], ["30", "Muffed Punt Recovery (Opponent)"],
  ["36", "Interception Return Touchdown"], ["39", "Fumble Return Touchdown"],
  ["52", "Punt"], ["59", "Field Goal Good"], ["60", "Field Goal Missed"],
  ["63", "Interception"], ["67", "Passing Touchdown"], ["68", "Rushing Touchdown"],
  ["80", "Sack Opp Fumble Recovery"],
]);

/** Logo identity is start-of-play offense, independent of result, scoring and replay. */
export function footballDisplayTeamId(play: FootballLogoPlay, teams: readonly PlayLogoTeam[]): string | null {
  const type = play.type;
  const expectedType = typeof type?.id === "string" ? footballTypes.get(type.id) : undefined;
  if (!expectedType || expectedType !== type?.text) return null;
  // A kickoff-return fumble can be typed as an ordinary fumble. Require a
  // structured scrimmage down rather than interpreting its description.
  const down = play.start?.down;
  if (typeof down !== "number" || !Number.isInteger(down) || down < 1 || down > 4) return null;
  const team = resolvePlayLogoTeam(play.start?.team?.id, teams);
  if (!team) return null;
  if (play.teamParticipants !== undefined) {
    if (!Array.isArray(play.teamParticipants)) return null;
    const offense = play.teamParticipants.filter(participant => participant?.type === "offense");
    if (offense.length !== 1 || offense[0].id !== team.id) return null;
    if (play.teamParticipants.some(participant => !participant ||
        !resolvePlayLogoTeam(participant.id, teams) ||
        (participant.type !== "offense" && participant.type !== "defense") ||
        (participant.type === "defense" && participant.id === team.id))) return null;
  }
  return team.id;
}

/** ESPN's event team is preserved; only logo eligibility is decided here. */
export function nbaDisplayTeamId(play: NbaPlay, teams: readonly PlayLogoTeam[]): string | null {
  if (typeof play.type !== "string") return null;
  const type = play.type.replace(/\s+/g, " ").trim();
  if (!type || /^(?:Jump\s*ball|Ref-Initiated Review|Start (?:Period|Game)|End (?:Period|Game))/i.test(type)) return null;
  const eligible = play.shootingPlay === true || /(?:Rebound|Foul|Turnover)$/.test(type) ||
    /^(?:Substitution|Full Timeout|Short Timeout|Traveling|Kicked Ball|Defensive Goaltending|Offensive Charge)$/.test(type) ||
    /^Coach's Challenge \((?:Supported|Overturned|Stands)\)$/.test(type);
  return eligible ? resolvePlayLogoTeam(play.teamId, teams)?.id ?? null : null;
}
