import type { NcaaEspnOdds as FootballOdds } from "@/lib/providers/ncaa";

function finiteOddsNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

export function selectFootballOdds(
  oddsInput: unknown,
  teams?: { away: string; home: string },
): FootballOdds | null {
  if (!Array.isArray(oddsInput)) {
    return null;
  }

  const odds = oddsInput.find(
    (entry: any) =>
      entry &&
      (
        finiteOddsNumber(entry.spread) !== null ||
        finiteOddsNumber(entry.overUnder) !== null
      ),
  ) as any;

  if (!odds) {
    return null;
  }

  let favoriteTeamId =
    odds?.awayTeamOdds?.favorite === true &&
    odds?.awayTeamOdds?.team?.id != null
      ? String(odds.awayTeamOdds.team.id)
      : odds?.homeTeamOdds?.favorite === true &&
          odds?.homeTeamOdds?.team?.id != null
        ? String(odds.homeTeamOdds.team.id)
        : null;

  const rawSpread =
    finiteOddsNumber(odds.spread);

  if (!favoriteTeamId && teams && rawSpread !== null && rawSpread !== 0) {
    favoriteTeamId = odds?.awayTeamOdds?.favorite === true ? teams.away
      : odds?.homeTeamOdds?.favorite === true ? teams.home
      : rawSpread < 0 ? teams.home : teams.away;
  }

  const spread =
    rawSpread !== null && favoriteTeamId
      ? -Math.abs(rawSpread)
      : rawSpread;

  const overUnder =
    finiteOddsNumber(odds.overUnder);

  const provider =
    typeof odds?.provider?.name === "string"
      ? odds.provider.name
      : null;

  return {
    favoriteTeamId,
    spread,
    overUnder,
    provider,
  };
}
